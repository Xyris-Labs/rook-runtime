import { connect, NatsConnection, JSONCodec, KV } from 'nats';
import { ServiceType, StatusEntry, FSWriteRequest, FSScope, FSReadRequest, InferenceRequest } from '../../../types';

const jc = JSONCodec();

// Official VS Code Copilot OAuth Client ID
const CLIENT_ID = '01ab8ac9400c4e429b23'; 

export class CopilotAdapter {
  private nc!: NatsConnection;
  private uuid!: string;
  private statusKv!: KV;
  private authState: 'online' | 'auth_required' | 'error' | 'offline' = 'offline';
  private authAlerts: any[] = [];
  private token: string | null = null;
  private deviceCode: string | null = null;
  private pollTimeout: NodeJS.Timeout | null = null;

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
      
      console.log('Copilot Adapter service initialized.');
      
      await this.checkAuthStatus();
    } catch (err) {
      console.error('Copilot Adapter failed to start:', err);
      process.exit(1);
    }
  }
  
  private async handshake() {
    try {
      const msg = await this.nc.request('registry.handshake', jc.encode({ type: ServiceType.LLM_ADAPTER, name: 'copilot' }), { timeout: 5000 });
      const res = jc.decode(msg.data) as any;
      this.uuid = res.uuid;
      console.log(`Copilot Adapter acquired UUID: ${this.uuid}`);
    } catch (err) {
      console.error('Adapter failed handshake:', err);
      throw err;
    }
  }
  
  private startHeartbeat() {
    const sendStatus = async () => {
      const status: StatusEntry = {
        status: this.authState,
        load: 0,
        capabilities: ['gpt-4o', 'claude-3.5-sonnet'],
        alerts: this.authAlerts,
        last_seen: new Date().toISOString()
      };
      try {
        await this.statusKv.put(this.uuid, jc.encode(status));
      } catch (err) {
        // Ignore KV write failures in the background
      }
    };
    sendStatus();
    setInterval(sendStatus, 5000);
  }
  
  private async checkAuthStatus() {
     try {
        const req: FSReadRequest = { scope: FSScope.SYSTEM, path: 'llm/copilot.json' };
        const msg = await this.nc.request('service.fs.read', jc.encode(req), { timeout: 5000 });
        const res = jc.decode(msg.data) as any;
        
        if (res.status === 'success' && res.content) {
            const data = JSON.parse(res.content);
            if (data.access_token) {
                this.token = data.access_token;
                this.authState = 'online';
                this.authAlerts = [];
                console.log('[Copilot] Loaded existing token from Vault.');
                return;
            }
        }
     } catch (e) {
         console.log('[Copilot] No existing token found or error reading Vault.');
     }
     
     // If we reach here, we need to authorize.
     this.initiateDeviceFlow();
  }

  private async initiateDeviceFlow() {
     console.log('[Copilot] Initiating GitHub Device Flow...');
     try {
         const res = await fetch('https://github.com/login/device/code', {
             method: 'POST',
             headers: {
                 'Accept': 'application/json',
                 'Content-Type': 'application/json'
             },
             body: JSON.stringify({
                 client_id: CLIENT_ID,
                 scope: 'user:email'
             })
         });
         const data = await res.json();
         
         if (data.device_code && data.user_code) {
             this.deviceCode = data.device_code;
             this.authState = 'auth_required';
             this.authAlerts = [{
                 type: 'AUTH_REQUIRED',
                 provider: 'github-copilot',
                 code: data.user_code,
                 url: data.verification_uri,
                 message: 'Please authorize GitHub Copilot. The UI will unlock automatically.'
             }];
             
             console.log(`[Copilot] Auth required: Please visit ${data.verification_uri} and enter code ${data.user_code}`);
             
             // Begin recursive polling
             this.pollForToken(data.interval || 5);
         }
     } catch (e) {
         console.error('[Copilot] Failed to initiate device flow', e);
         this.authState = 'error';
     }
  }
  
  private pollForToken(intervalSeconds: number) {
     const poll = async () => {
         if (!this.deviceCode) return;
         
         try {
             const res = await fetch('https://github.com/login/oauth/access_token', {
                 method: 'POST',
                 headers: {
                     'Accept': 'application/json',
                     'Content-Type': 'application/json'
                 },
                 body: JSON.stringify({
                     client_id: CLIENT_ID,
                     device_code: this.deviceCode,
                     grant_type: 'urn:ietf:params:oauth:grant-type:device_code'
                 })
             });
             
             const data = await res.json();
             
             if (data.access_token) {
                 console.log('[Copilot] Token acquired successfully!');
                 this.token = data.access_token;
                 this.authState = 'online';
                 this.authAlerts = [];
                 this.deviceCode = null;
                 
                 // Save token via Librarian to physical disk
                 const writeReq: FSWriteRequest = {
                     scope: FSScope.SYSTEM,
                     path: 'llm/copilot.json',
                     content: JSON.stringify({ access_token: this.token })
                 };
                 this.nc.request('service.fs.write', jc.encode(writeReq), { timeout: 5000 }).catch(() => {});
                 return; // Break the recursion
             } 
             else if (data.error === 'authorization_pending') {
                 // Normal waiting state, do nothing but poll again
             } 
             else if (data.error === 'slow_down') {
                 intervalSeconds += 5; // Crucial GitHub API requirement
                 console.log(`[Copilot] Slow down requested. Increasing interval to ${intervalSeconds}s`);
             } 
             else if (data.error === 'expired_token') {
                 console.error('[Copilot] Device code expired. Restarting flow.');
                 this.initiateDeviceFlow();
                 return; // Break recursion
             } 
             else if (data.error) {
                 console.error('[Copilot] Polling error:', data.error);
             }
         } catch (e) {
             console.error('[Copilot] Fetch error during polling:', e);
         }
         
         // Queue next poll recursively based on the dynamically updated interval
         this.pollTimeout = setTimeout(poll, intervalSeconds * 1000);
     };
     
     this.pollTimeout = setTimeout(poll, intervalSeconds * 1000);
  }

  private setupHandlers() {
     this.nc.subscribe('provider.copilot.inference', {
        callback: async (err, msg) => {
            if (err) return;
            const req = jc.decode(msg.data) as InferenceRequest;
            
            if (this.authState !== 'online' || !this.token) {
                msg.respond(jc.encode({ status: 'error', error: 'Adapter is offline or unauthenticated' }));
                return;
            }
            
            try {
                // 1. Exchange OAuth token for an internal Copilot token
                const tokenRes = await fetch('https://api.github.com/copilot_internal/v2/token', {
                    headers: {
                        'Authorization': `Bearer ${this.token}`,
                        'Accept': 'application/json'
                    }
                });
                
                if (tokenRes.status === 401) throw new Error('auth failed');
                
                const tokenData = await tokenRes.json();
                const copilotToken = tokenData.token;
                
                // 2. Execute standard Chat Completions
                const infRes = await fetch('https://api.githubcopilot.com/chat/completions', {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${copilotToken}`,
                        'Content-Type': 'application/json',
                        'Accept': 'application/json'
                    },
                    body: JSON.stringify({
                        model: req.model,
                        temperature: req.temperature,
                        messages: req.messages,
                        tools: req.tools
                    })
                });
                
                if (!infRes.ok) {
                    if (infRes.status === 401) throw new Error('auth failed');
                    throw new Error(`Copilot API Error: ${infRes.status}`);
                }
                
                const infData = await infRes.json();
                const message = infData.choices?.[0]?.message;
                
                msg.respond(jc.encode({
                    status: 'success',
                    content: message?.content || '',
                    tool_calls: message?.tool_calls || []
                }));
                
            } catch (e: any) {
                console.error('[Copilot] Inference failed:', e.message);
                msg.respond(jc.encode({ status: 'error', error: e.message }));
                
                // If token is dead, wipe memory and start over
                if (e.message.includes('auth failed')) {
                    this.token = null;
                    this.authState = 'auth_required';
                    this.initiateDeviceFlow();
                }
            }
        }
     });
  }
}