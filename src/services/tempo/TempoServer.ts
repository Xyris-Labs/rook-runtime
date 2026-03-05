import { connect, NatsConnection, JSONCodec, KV } from 'nats';
import * as cron from 'node-cron';
import { 
  ServiceType, 
  HandshakeRequest, 
  HandshakeResponse, 
  StatusEntry,
  FSScope,
  FSReadRequest,
  FSResponse
} from '../../types';

const jc = JSONCodec();

interface ScheduleEntry {
  agent_id: string;
  type: 'interval' | 'cron';
  value: string | number;
  enabled: boolean;
  label?: string;
}

export class TempoServer {
  private nc!: NatsConnection;
  private uuid!: string;
  private statusKv!: KV;
  
  private intervals: NodeJS.Timeout[] = [];
  private cronTasks: cron.ScheduledTask[] = [];

  async start() {
    console.log('Starting Tempo Server...');
    const natsUrl = process.env.NATS_URL || 'nats://localhost:4222';
    
    try {
      this.nc = await connect({ servers: natsUrl });
      console.log(`Tempo Server connected to NATS at ${natsUrl}`);
      
      const js = this.nc.jetstream();
      this.statusKv = await js.views.kv('ROOK_STATUS');

      await this.handshake();
      this.startHeartbeat();
      
      // Start the non-blocking loop to load schedules
      this.initScheduleLoop();
      
      console.log('Tempo Server ready.');
    } catch (err) {
      console.error('Tempo Server failed to start:', err);
      process.exit(1);
    }
  }

  private async handshake() {
    const req: HandshakeRequest = { type: ServiceType.TEMPO, name: 'primary' };
    try {
      const msg = await this.nc.request('registry.handshake', jc.encode(req), { timeout: 5000 });
      const res = jc.decode(msg.data) as HandshakeResponse;
      this.uuid = res.uuid;
      console.log(`Tempo Server acquired UUID: ${this.uuid}`);
    } catch (err) {
      console.error('Tempo Server failed handshake:', err);
      throw err;
    }
  }

  private startHeartbeat() {
    const sendStatus = async () => {
      const status: StatusEntry = {
        status: 'online',
        load: this.intervals.length + this.cronTasks.length,
        capabilities: ['schedule', 'tick'],
        alerts: [],
        last_seen: new Date().toISOString()
      };
      try {
        await this.statusKv.put(this.uuid, jc.encode(status));
      } catch (err) {
        console.error('Tempo Server failed to put status:', err);
      }
    };
    
    sendStatus();
    setInterval(sendStatus, 10000);
  }

  private async initScheduleLoop() {
    // Initial load
    await this.loadSchedulesWithRetry();
    
    // Periodically reload to catch updates (every 60s for now, though a dedicated NATS reload signal would be better long term)
    setInterval(() => {
      this.loadSchedules();
    }, 60000);
  }

  private async loadSchedulesWithRetry() {
    let success = false;
    while (!success) {
      success = await this.loadSchedules();
      if (!success) {
        console.log('[Tempo] Librarian not ready or file missing. Retrying in 5s...');
        await new Promise(r => setTimeout(r, 5000));
      }
    }
  }

  private async loadSchedules(): Promise<boolean> {
    try {
      const req: FSReadRequest = {
        scope: FSScope.SYSTEM,
        path: 'schedules.json'
      };
      
      const msg = await this.nc.request('service.fs.read', jc.encode(req), { timeout: 2000 });
      const res = jc.decode(msg.data) as FSResponse;

      if (res.status === 'success' && res.content) {
        const schedules: ScheduleEntry[] = JSON.parse(res.content);
        this.applySchedules(schedules);
        return true;
      } else {
        if (res.error === 'File not found') {
          console.log('[Tempo] schedules.json not found. Proceeding with empty schedule.');
          this.applySchedules([]);
          return true; // The file intentionally doesn't exist, this is a success state for the retry loop
        }
        return false;
      }
    } catch (e) {
      // Timeout or NATS error (Librarian might be down)
      return false;
    }
  }

  private clearSchedules() {
    for (const id of this.intervals) clearInterval(id);
    for (const task of this.cronTasks) task.stop();
    this.intervals = [];
    this.cronTasks = [];
  }

  private applySchedules(schedules: ScheduleEntry[]) {
    this.clearSchedules();
    let loadedCount = 0;

    for (const s of schedules) {
      if (!s.enabled) continue;

      if (s.type === 'interval') {
        const ms = Number(s.value) * 1000;
        if (isNaN(ms) || ms <= 0) continue;

        const intervalId = setInterval(() => {
          this.nc.publish(`agent.${s.agent_id}.tick`, jc.encode({
            type: 'interval',
            ts: new Date().toISOString()
          }));
        }, ms);
        
        this.intervals.push(intervalId);
        loadedCount++;
      } 
      else if (s.type === 'cron') {
        if (typeof s.value !== 'string') continue;
        
        if (cron.validate(s.value)) {
          const task = cron.schedule(s.value, () => {
            this.nc.publish(`agent.${s.agent_id}.cron`, jc.encode({
              type: 'cron',
              ts: new Date().toISOString()
            }));
          });
          this.cronTasks.push(task);
          loadedCount++;
        } else {
          console.warn(`[Tempo] Invalid cron expression for agent ${s.agent_id}: ${s.value}`);
        }
      }
    }
    
    console.log(`[Tempo] Loaded ${loadedCount} active schedules.`);
  }
}
