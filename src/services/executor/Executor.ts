import { spawn, ChildProcess } from 'child_process';
import { connect, NatsConnection, JSONCodec, KV } from 'nats';
import { 
  ServiceType, 
  HandshakeRequest, 
  HandshakeResponse, 
  StatusEntry,
  SpawnRequest,
  KillRequest
} from '../../types';

const jc = JSONCodec();

export class Executor {
  private nc!: NatsConnection;
  private uuid!: string;
  private statusKv!: KV;
  private workers: Map<string, ChildProcess> = new Map();
  private startTimes: Map<string, number> = new Map();

  async start() {
    console.log('Starting Executor service...');
    const natsUrl = process.env.NATS_URL || 'nats://localhost:4222';
    
    try {
      this.nc = await connect({ servers: natsUrl });
      console.log(`Executor connected to NATS at ${natsUrl}`);
      
      const js = this.nc.jetstream();
      this.statusKv = await js.views.kv('ROOK_STATUS');

      await this.handshake();
      this.startHeartbeat();
      this.setupHandlers();
      
      console.log('Executor service ready.');
    } catch (err) {
      console.error('Executor failed to start:', err);
      process.exit(1);
    }
  }

  private async handshake() {
    const req: HandshakeRequest = { type: ServiceType.EXECUTOR, name: 'primary' };
    try {
      const msg = await this.nc.request('registry.handshake', jc.encode(req), { timeout: 5000 });
      const res = jc.decode(msg.data) as HandshakeResponse;
      this.uuid = res.uuid;
      console.log(`Executor acquired UUID: ${this.uuid}`);
    } catch (err) {
      console.error('Executor failed handshake:', err);
      throw err;
    }
  }

  private startHeartbeat() {
    const sendStatus = async () => {
      // Calculate load (basic implementation based on number of active processes, bounded 0-100)
      const maxLoadWorkers = 10;
      const load = Math.min(100, Math.floor((this.workers.size / maxLoadWorkers) * 100));

      const status: StatusEntry = {
        status: 'online',
        load,
        capabilities: ['spawn', 'kill'],
        alerts: [],
        last_seen: new Date().toISOString()
      };
      
      try {
        await this.statusKv.put(this.uuid, jc.encode(status));
      } catch (err) {
        console.error('Executor failed to put status:', err);
      }
    };
    
    sendStatus();
    setInterval(sendStatus, 10000);
  }

  private setupHandlers() {
    // Handler A: service.executor.spawn
    this.nc.subscribe('service.executor.spawn', {
      callback: (err, msg) => {
        if (err) return;
        
        try {
          const req = jc.decode(msg.data) as SpawnRequest;
          
          if (this.workers.has(req.agent_id)) {
            msg.respond(jc.encode({ status: 'error', error: 'Already running' }));
            return;
          }

          const natsUrl = process.env.NATS_URL || 'nats://localhost:4222';
          
          // Fallback to -r if --loader causes issues, but following WO instructions 
          // with a safe robust array setup. Prior codebase used -r ts-node/register.
          const child = spawn('node', ['-r', 'ts-node/register', req.entrypoint], {
            env: {
              ...process.env,
              ...req.env,
              NATS_URL: natsUrl,
              AGENT_ID: req.agent_id,
              AGENT_NAME: req.agent_id // For backwards compatibility if needed
            }
          });

          this.workers.set(req.agent_id, child);
          this.startTimes.set(req.agent_id, Date.now());

          child.stdout?.on('data', (data) => {
            process.stdout.write(`[Agent: ${req.agent_id}] ${data}`);
          });

          child.stderr?.on('data', (data) => {
            process.stderr.write(`[Agent: ${req.agent_id}] ${data}`);
          });

          child.on('exit', (code) => {
            if (code !== 0 && code !== null) {
              console.error(`[Executor] Agent ${req.agent_id} exited with non-zero code: ${code}`);
            } else {
              console.log(`[Executor] Agent ${req.agent_id} exited cleanly.`);
            }
            this.workers.delete(req.agent_id);
            this.startTimes.delete(req.agent_id);
          });

          msg.respond(jc.encode({ status: 'success', pid: child.pid }));

        } catch (e: any) {
          msg.respond(jc.encode({ status: 'error', error: e.message }));
        }
      }
    });

    // Handler B: service.executor.kill
    this.nc.subscribe('service.executor.kill', {
      callback: (err, msg) => {
        if (err) return;
        
        try {
          const req = jc.decode(msg.data) as KillRequest;
          
          const child = this.workers.get(req.agent_id);
          if (!child) {
            msg.respond(jc.encode({ status: 'error', error: 'Process not found' }));
            return;
          }

          const signal = req.signal || 'SIGTERM';
          child.kill(signal);

          // Brutal fallback
          if (signal === 'SIGTERM') {
            setTimeout(() => {
              if (this.workers.has(req.agent_id)) {
                console.log(`[Executor] Agent ${req.agent_id} did not exit after SIGTERM, sending SIGKILL.`);
                const uncooperativeChild = this.workers.get(req.agent_id);
                if (uncooperativeChild) {
                  uncooperativeChild.kill('SIGKILL');
                }
              }
            }, 5000);
          }

          msg.respond(jc.encode({ status: 'success' }));
        } catch (e: any) {
          msg.respond(jc.encode({ status: 'error', error: e.message }));
        }
      }
    });

    // Handler C: service.executor.list
    this.nc.subscribe('service.executor.list', {
      callback: (err, msg) => {
        if (err) return;
        
        try {
          const list = Array.from(this.workers.entries()).map(([agent_id, child]) => ({
            agent_id,
            pid: child.pid,
            uptime: Date.now() - (this.startTimes.get(agent_id) || Date.now())
          }));

          msg.respond(jc.encode({ status: 'success', agents: list }));
        } catch (e: any) {
          msg.respond(jc.encode({ status: 'error', error: e.message }));
        }
      }
    });
  }
}
