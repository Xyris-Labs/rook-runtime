import { connect, NatsConnection, JSONCodec, KV } from 'nats';
import { 
  ServiceType, 
  HandshakeRequest, 
  HandshakeResponse, 
  StatusEntry,
  InferenceRequest,
  InferenceResponse
} from '../../../types';

const jc = JSONCodec();
const LM_STUDIO_URL = 'http://host.docker.internal:1234/v1/chat/completions';

export class OpenAIAdapter {
  private nc!: NatsConnection;
  private uuid!: string;
  private statusKv!: KV;

  async start() {
    console.log('Starting OpenAI Adapter service...');
    const natsUrl = process.env.NATS_URL || 'nats://localhost:4222';
    
    try {
      this.nc = await connect({ servers: natsUrl });
      console.log(`OpenAI Adapter connected to NATS at ${natsUrl}`);
      
      const js = this.nc.jetstream();
      this.statusKv = await js.views.kv('ROOK_STATUS');

      await this.handshake();
      this.startHeartbeat();
      this.setupHandlers();
      
      console.log('OpenAI Adapter service initialized.');
    } catch (err) {
      console.error('OpenAI Adapter failed to start:', err);
      process.exit(1);
    }
  }

  private async handshake() {
    const req: HandshakeRequest = { type: ServiceType.LLM_ADAPTER, name: 'openai' };
    try {
      const msg = await this.nc.request('registry.handshake', jc.encode(req), { timeout: 5000 });
      const res = jc.decode(msg.data) as HandshakeResponse;
      this.uuid = res.uuid;
      console.log(`OpenAI Adapter acquired UUID: ${this.uuid}`);
    } catch (err) {
      console.error('OpenAI Adapter failed handshake:', err);
      throw err;
    }
  }

  private startHeartbeat() {
    const sendStatus = async () => {
      const status: StatusEntry = {
        status: 'online',
        load: 0,
        capabilities: ['local-model'],
        alerts: [],
        last_seen: new Date().toISOString()
      };
      try {
        await this.statusKv.put(this.uuid, jc.encode(status));
      } catch (err) {
        console.error('OpenAI Adapter failed to put status:', err);
      }
    };
    
    sendStatus();
    setInterval(sendStatus, 10000);
  }

  private setupHandlers() {
    this.nc.subscribe('provider.openai.inference', {
      callback: async (err, msg) => {
        if (err) return;
        
        const req = jc.decode(msg.data) as InferenceRequest;
        let response: InferenceResponse;
        
        try {
          const openAiReq: any = {
            model: req.model,
            temperature: req.temperature,
            messages: req.messages,
          };

          if (req.tools && req.tools.length > 0) {
            openAiReq.tools = req.tools;
          }

          const infRes = await fetch(LM_STUDIO_URL, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Accept': 'application/json'
            },
            body: JSON.stringify(openAiReq)
          });

          if (!infRes.ok) {
            throw new Error(`OpenAI API error: ${infRes.status} ${infRes.statusText}`);
          }

          const infData: any = await infRes.json();
          
          const message = infData.choices && infData.choices[0] ? infData.choices[0].message : null;
          
          response = { 
            status: 'success', 
            content: message && message.content ? message.content : '',
            tool_calls: message && message.tool_calls ? message.tool_calls : []
          };

        } catch (e: any) {
          console.error(`[OpenAI Adapter] Inference error:`, e.message);
          let errorMsg = e.message;
          if (e.message.includes('ECONNREFUSED')) {
            errorMsg = 'Local LLM unreachable';
          }
          response = { status: 'error', error: errorMsg };
        }
        
        msg.respond(jc.encode(response));
      }
    });
  }
}
