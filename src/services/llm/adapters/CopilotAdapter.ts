import { connect, NatsConnection, JSONCodec, KV } from 'nats';
import { 
  ServiceType, 
  HandshakeRequest, 
  HandshakeResponse, 
  StatusEntry,
  InferenceRequest,
  InferenceResponse,
  FSScope,
  FSReadRequest,
  FSWriteRequest,
  FSResponse
} from '../../../types';

const jc = JSONCodec();
const CLIENT_ID = 'Iv1.b507a08c87ecfe98'; // Known Copilot Client ID

export class CopilotAdapter {
  private nc!: NatsConnection;
  private uuid!: string;
  private statusKv!: KV;
  
  private token: string | null = null;
  private authState: 'initializing' | 'auth_required' | 'polling' | 'online' | 'error' = 'initializing';
  private authAlerts: any[] = [];
  private pollingInterval: any = null;

  async start() {
    console.log('Starting Copilot Adapter service...');
    const natsUrl = process.env.NATS_URL || 'nats://localhost:4222';
    
    try {
      this.nc = await connect({ servers: natsUrl });
      console.log(`Copilot Adapter connected to NATS at ${natsUrl}`);
      
      const js = this.nc.jetstream();
      this.statusKv = await js.views.kv('ROOK_STATUS');

      await this.handshake();
      this.startHeartbeat();
      this.setupHandlers();
      
      await this.checkAuth();
      
      console.log('Copilot Adapter service initialized.');
    } catch (err) {
      console.error('Copilot Adapter failed to start:', err);
      process.exit(1);
    }
  }

  private async handshake() {
    const req: HandshakeRequest = { type: ServiceType.LLM_ADAPTER, name: 'copilot' };
    try {
      const msg = await this.nc.request('registry.handshake', jc.encode(req), { timeout: 5000 });
      const res = jc.decode(msg.data) as HandshakeResponse;
      this.uuid = res.uuid;
      console.log(`Copilot Adapter acquired UUID: ${this.uuid}`);
    } catch (err) {
      console.error('Copilot Adapter failed handshake:', err);
      throw err;
    }
  }

  private startHeartbeat() {
    const sendStatus = async () => {
      const status: StatusEntry = {
        status: this.authState === 'online' ? 'online' : (this.authState === 'auth_required' || this.authState === 'polling' ? 'auth_required' : 'error'),
        load: 0,
        capabilities: this.authState === 'online' ? ['gpt-4o', 'claude-3.5-sonnet'] : [],
        alerts: this.authAlerts,
        last_seen: new Date().toISOString()
      };
      try {
        await this.statusKv.put(this.uuid, jc.encode(status));
      } catch (err) {
        console.error('Copilot Adapter failed to put status:', err);
      }
    };
    
    sendStatus();
    setInterval(sendStatus, 10000);
  }

  private async checkAuth() {
    try {
      const req: FSReadRequest = { scope: FSScope.SYSTEM, path: 'llm/copilot.json' };
      const resMsg = await this.nc.request('service.fs.read', jc.encode(req), { timeout: 5000 });
      const res = jc.decode(resMsg.data) as FSResponse;

      if (res.status === 'success' && res.content) {
        const data = JSON.parse(res.content);
        if (data.access_token) {
          this.token = data.access_token;
          this.authState = 'online';
          this.authAlerts = [];
          console.log('[Copilot] Loaded existing token, status is online.');
          return;
        }
      }
    } catch (err) {
      console.log('[Copilot] No existing token found or read error:', err);
    }

    // No token, initiate device flow
    await this.initiateDeviceFlow();
  }

  private async initiateDeviceFlow() {
    this.authState = 'auth_required';
    console.log('[Copilot] Initiating GitHub Device Flow...');
    
    try {
      const res = await fetch('https://github.com/login/device/code', {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ client_id: CLIENT_ID, scope: 'read:user' })
      });
      
      const data: any = await res.json();
      
      if (data.device_code && data.user_code && data.verification_uri) {
        this.authAlerts = [{
          type: 'AUTH_REQUIRED',
          provider: 'copilot',
          code: data.user_code,
          url: data.verification_uri,
          message: 'Please authenticate with GitHub to enable Copilot inference.'
        }];
        this.authState = 'polling';
        
        console.log(`[Copilot] Auth required: Please visit ${data.verification_uri} and enter code ${data.user_code}`);
        
        // Start polling
        this.startPolling(data.device_code, data.interval || 5);
      } else {
        throw new Error('Invalid response from GitHub Device Code API');
      }
    } catch (e: any) {
      console.error('[Copilot] Device Flow Error:', e.message);
      this.authState = 'error';
    }
  }

  private startPolling(deviceCode: string, intervalSeconds: number) {
    if (this.pollingInterval) clearInterval(this.pollingInterval);
    
    this.pollingInterval = setInterval(async () => {
      console.log('[Copilot] Polling for token...');
      try {
        const res = await fetch('https://github.com/login/oauth/access_token', {
          method: 'POST',
          headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            client_id: CLIENT_ID,
            device_code: deviceCode,
            grant_type: 'urn:ietf:params:oauth:grant-type:device_code'
          })
        });
        
        const data: any = await res.json();
        
        if (data.access_token) {
          console.log('[Copilot] Successfully acquired token!');
          clearInterval(this.pollingInterval);
          this.pollingInterval = null;
          this.token = data.access_token;
          this.authState = 'online';
          this.authAlerts = [];
          
          // Save token via Librarian
          const writeReq: FSWriteRequest = {
            scope: FSScope.SYSTEM,
            path: 'llm/copilot.json',
            content: JSON.stringify({ access_token: this.token })
          };
          await this.nc.request('service.fs.write', jc.encode(writeReq), { timeout: 5000 });
        } else if (data.error && data.error !== 'authorization_pending' && data.error !== 'slow_down') {
          console.error('[Copilot] Polling error:', data.error);
          clearInterval(this.pollingInterval);
          this.pollingInterval = null;
          this.authState = 'error';
        } else if (data.error === 'slow_down') {
           // Ignore and just wait for next poll
           console.log('[Copilot] Polling slow down requested...');
        }
      } catch (e) {
        console.error('[Copilot] Polling exception:', e);
      }
    }, intervalSeconds * 1000);
  }

  private setupHandlers() {
    this.nc.subscribe('provider.copilot.inference', {
      callback: async (err, msg) => {
        if (err) return;
        
        const req = jc.decode(msg.data) as InferenceRequest;
        let response: InferenceResponse;
        
        if (this.authState !== 'online' || !this.token) {
          response = { status: 'error', error: 'Adapter is not online or missing token' };
          msg.respond(jc.encode(response));
          return;
        }

        try {
          // Copilot token exchange (usually OAuth token is exchanged for a copilot token)
          // For simplicity in this v0 adapter, we will attempt direct chat completions.
          // Note: Full Copilot integration requires hitting https://api.github.com/copilot_internal/v2/token first.
          
          const tokenRes = await fetch('https://api.github.com/copilot_internal/v2/token', {
             headers: {
               'Authorization': `Bearer ${this.token}`,
               'Accept': 'application/json'
             }
          });
          
          if (tokenRes.status === 401) {
             throw new Error('Copilot auth token expired or invalid');
          }
          
          const tokenData: any = await tokenRes.json();
          const copilotToken = tokenData.token;

          const copilotReq = {
            model: req.model,
            temperature: req.temperature,
            messages: req.messages,
            tools: req.tools
          };

          const infRes = await fetch('https://api.githubcopilot.com/chat/completions', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${copilotToken}`,
              'Content-Type': 'application/json',
              'Accept': 'application/json'
            },
            body: JSON.stringify(copilotReq)
          });

          if (infRes.status === 401) {
            throw new Error('Copilot chat completion auth failed');
          }

          if (!infRes.ok) {
            throw new Error(`Copilot API error: ${infRes.status} ${infRes.statusText}`);
          }

          const infData: any = await infRes.json();
          
          const message = infData.choices && infData.choices[0] ? infData.choices[0].message : null;
          
          response = { 
            status: 'success', 
            content: message ? message.content : '',
            tool_calls: message && message.tool_calls ? message.tool_calls : []
          };

        } catch (e: any) {
          console.error(`[Copilot] Inference error:`, e.message);
          response = { status: 'error', error: e.message };
          
          if (e.message.includes('expired') || e.message.includes('auth failed')) {
             this.token = null;
             this.authState = 'auth_required';
             // Wipe token
             const writeReq: FSWriteRequest = {
               scope: FSScope.SYSTEM,
               path: 'llm/copilot.json',
               content: '{}'
             };
             this.nc.request('service.fs.write', jc.encode(writeReq), { timeout: 5000 }).catch(()=>{});
             this.initiateDeviceFlow();
          }
        }
        
        msg.respond(jc.encode(response));
      }
    });
  }
}
