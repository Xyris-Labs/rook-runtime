import { connect, NatsConnection, JSONCodec, KV, StringCodec } from 'nats';
import { 
  ServiceType, 
  HandshakeRequest, 
  HandshakeResponse, 
  StatusEntry,
  InferenceRequest,
  InferenceResponse
} from '../../types';

const jc = JSONCodec();
const sc = StringCodec();

export class Broker {
  private nc!: NatsConnection;
  private uuid!: string;
  private statusKv!: KV;
  private registryKv!: KV;

  async start() {
    console.log('Starting LLM Broker service...');
    const natsUrl = process.env.NATS_URL || 'nats://localhost:4222';
    
    try {
      this.nc = await connect({ servers: natsUrl });
      console.log(`Broker connected to NATS at ${natsUrl}`);
      
      const js = this.nc.jetstream();
      this.statusKv = await js.views.kv('ROOK_STATUS');
      this.registryKv = await js.views.kv('ROOK_REGISTRY');

      await this.handshake();
      this.startHeartbeat();
      this.setupHandlers();
      
      console.log('LLM Broker service ready.');
    } catch (err) {
      console.error('Broker failed to start:', err);
      process.exit(1);
    }
  }

  private async handshake() {
    const req: HandshakeRequest = { type: ServiceType.LLM_BROKER, name: 'primary' };
    try {
      const msg = await this.nc.request('registry.handshake', jc.encode(req), { timeout: 5000 });
      const res = jc.decode(msg.data) as HandshakeResponse;
      this.uuid = res.uuid;
      console.log(`Broker acquired UUID: ${this.uuid}`);
    } catch (err) {
      console.error('Broker failed handshake:', err);
      throw err;
    }
  }

  private startHeartbeat() {
    const sendStatus = async () => {
      const status: StatusEntry = {
        status: 'online',
        load: 0,
        capabilities: ['route'],
        alerts: [],
        last_seen: new Date().toISOString()
      };
      try {
        await this.statusKv.put(this.uuid, jc.encode(status));
      } catch (err) {
        console.error('Broker failed to put status:', err);
      }
    };
    
    sendStatus();
    setInterval(sendStatus, 10000);
  }

  private setupHandlers() {
    this.nc.subscribe('service.llm.inference', {
      callback: async (err, msg) => {
        if (err) return;
        
        try {
          const req = jc.decode(msg.data) as InferenceRequest;
          let selectedAdapterName = 'copilot'; // fallback default for v0

          // Scan ROOK_STATUS for online adapters with the requested model
          const statusKeysIter = await this.statusKv.keys();
          const statusKeys: string[] = [];
          for await (const k of statusKeysIter) { statusKeys.push(k); }

          for (const k of statusKeys) {
            const entry = await this.statusKv.get(k);
            if (entry) {
              const status = jc.decode(entry.value) as StatusEntry;
              if (status.status === 'online' && status.capabilities.includes(req.model)) {
                // Find matching registry entry to get adapter name
                const regKeysIter = await this.registryKv.keys();
                const regKeys: string[] = [];
                for await (const rk of regKeysIter) { regKeys.push(rk); }

                for (const rk of regKeys) {
                  const regEntry = await this.registryKv.get(rk);
                  if (regEntry) {
                    const regUuid = sc.decode(regEntry.value);
                    if (regUuid === k && rk.startsWith(ServiceType.LLM_ADAPTER)) {
                      selectedAdapterName = rk.split('.')[3]; // service.llm.adapter.<name>
                      break;
                    }
                  }
                }
              }
            }
          }

          console.log(`[Broker] Routing inference for model '${req.model}' to adapter '${selectedAdapterName}'`);
          const targetSubject = `provider.${selectedAdapterName}.inference`;

          const adapterResMsg = await this.nc.request(targetSubject, msg.data, { timeout: 60000 });
          msg.respond(adapterResMsg.data);

        } catch (e: any) {
          console.error(`[Broker] Inference routing failed:`, e.message);
          const errorRes: InferenceResponse = { status: 'error', error: e.message };
          msg.respond(jc.encode(errorRes));
        }
      }
    });
  }
}
