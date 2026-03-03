import * as fs from 'fs';
import * as path from 'path';
import { connect, NatsConnection, JSONCodec, KV } from 'nats';
import { 
  ServiceType, 
  HandshakeRequest, 
  HandshakeResponse, 
  StatusEntry, 
  FSScope, 
  FSReadRequest, 
  FSWriteRequest, 
  FSListRequest, 
  FSResponse 
} from '../../types';

const jc = JSONCodec();
const DATA_ROOT = '/data';

export class Librarian {
  private nc!: NatsConnection;
  private uuid!: string;
  private statusKv!: KV;

  async start() {
    console.log('Starting Librarian service...');
    const natsUrl = process.env.NATS_URL || 'nats://localhost:4222';
    
    try {
      this.nc = await connect({ servers: natsUrl });
      console.log(`Librarian connected to NATS at ${natsUrl}`);
      
      const js = this.nc.jetstream();
      this.statusKv = await js.views.kv('ROOK_STATUS');

      await this.handshake();
      this.startHeartbeat();
      this.setupHandlers();
      
      console.log('Librarian service ready.');
    } catch (err) {
      console.error('Librarian failed to start:', err);
      process.exit(1);
    }
  }

  private async handshake() {
    const req: HandshakeRequest = { type: ServiceType.FS, name: 'primary' };
    try {
      const msg = await this.nc.request('registry.handshake', jc.encode(req), { timeout: 5000 });
      const res = jc.decode(msg.data) as HandshakeResponse;
      this.uuid = res.uuid;
      console.log(`Librarian acquired UUID: ${this.uuid}`);
    } catch (err) {
      console.error('Librarian failed handshake:', err);
      throw err;
    }
  }

  private startHeartbeat() {
    const sendStatus = async () => {
      const status: StatusEntry = {
        status: 'online',
        load: 0,
        capabilities: ['read', 'write', 'list'],
        alerts: [],
        last_seen: new Date().toISOString()
      };
      try {
        await this.statusKv.put(this.uuid, jc.encode(status));
      } catch (err) {
        console.error('Librarian failed to put status:', err);
      }
    };
    
    sendStatus();
    setInterval(sendStatus, 10000);
  }

  private resolvePath(req: FSReadRequest): string {
    if (req.path.includes('..') || req.path.startsWith('/')) {
      throw new Error('Path traversal detected');
    }

    let basePath = '';
    switch (req.scope) {
      case FSScope.SYSTEM:
        basePath = path.join(DATA_ROOT, 'system');
        break;
      case FSScope.AGENT:
        if (!req.agent_id) throw new Error('agent_id required for agent scope');
        basePath = path.join(DATA_ROOT, 'system/agents', req.agent_id);
        break;
      case FSScope.ARTIFACT:
        basePath = path.join(DATA_ROOT, 'artifacts');
        break;
      default:
        throw new Error('Invalid scope');
    }

    const resolvedPath = path.join(basePath, req.path);
    if (!resolvedPath.startsWith(basePath)) {
      throw new Error('Path traversal detected');
    }

    return resolvedPath;
  }

  private setupHandlers() {
    this.nc.subscribe('service.fs.read', {
      callback: (err, msg) => {
        if (err) return;
        const req = jc.decode(msg.data) as FSReadRequest;
        let response: FSResponse;
        
        try {
          const resolvedPath = this.resolvePath(req);
          if (fs.existsSync(resolvedPath)) {
            const content = fs.readFileSync(resolvedPath, 'utf8');
            response = { status: 'success', content };
          } else {
            response = { status: 'error', error: 'File not found' };
          }
        } catch (e: any) {
          response = { status: 'error', error: e.message };
        }
        
        msg.respond(jc.encode(response));
      }
    });

    this.nc.subscribe('service.fs.write', {
      callback: (err, msg) => {
        if (err) return;
        const req = jc.decode(msg.data) as FSWriteRequest;
        let response: FSResponse;
        
        try {
          const resolvedPath = this.resolvePath(req);
          const tempPath = `${resolvedPath}.tmp`;
          
          if (!fs.existsSync(path.dirname(resolvedPath))) {
            fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
          }
          
          fs.writeFileSync(tempPath, req.content);
          fs.renameSync(tempPath, resolvedPath);
          
          response = { status: 'success' };
        } catch (e: any) {
          // Cleanup tmp if needed
          try {
             const resolvedPath = this.resolvePath(req);
             const tempPath = `${resolvedPath}.tmp`;
             if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
          } catch(cleanupErr) {}
          
          response = { status: 'error', error: e.message };
        }
        
        msg.respond(jc.encode(response));
      }
    });

    this.nc.subscribe('service.fs.list', {
      callback: (err, msg) => {
        if (err) return;
        const req = jc.decode(msg.data) as FSListRequest;
        let response: FSResponse;
        
        try {
          const resolvedPath = this.resolvePath(req);
          if (fs.existsSync(resolvedPath) && fs.statSync(resolvedPath).isDirectory()) {
            const files = fs.readdirSync(resolvedPath);
            response = { status: 'success', files };
          } else {
             response = { status: 'error', error: 'Directory not found' };
          }
        } catch (e: any) {
          response = { status: 'error', error: e.message };
        }
        
        msg.respond(jc.encode(response));
      }
    });
  }
}
