import * as fs from 'fs';
import * as path from 'path';
import { connect, NatsConnection, JSONCodec, Msg } from 'nats';
import { fork, ChildProcess } from 'child_process';
import { v4 as uuidv4 } from 'uuid';
import * as cron from 'node-cron';
import * as http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { Envelope, AgentConfig, ScheduleEntry, SUBJECTS } from '../types';

const DATA_ROOT = '/data';
const SYSTEM_DIR = path.join(DATA_ROOT, 'system');
const UI_DIR = path.join(DATA_ROOT, 'ui');
const AGENTS_DIR = path.join(SYSTEM_DIR, 'agents');
const SESSIONS_DIR = path.join(SYSTEM_DIR, 'sessions');
const ARTIFACTS_DIR = path.join(DATA_ROOT, 'artifacts');
const CACHE_DIR = path.join(DATA_ROOT, 'cache');

const jc = JSONCodec();

class RuntimeController {
  private nc!: NatsConnection;
  private agents: Map<string, AgentConfig> = new Map();
  private workers: Map<string, ChildProcess> = new Map();
  private schedules: ScheduleEntry[] = [];
  private cronTasks: Map<string, cron.ScheduledTask> = new Map();
  private intervalTasks: Map<string, NodeJS.Timeout> = new Map();
  private startTime: number = Date.now();
  private heartbeatInterval?: NodeJS.Timeout;

  async start() {
    try {
      console.log('Starting v0 Runtime...');
      this.startTime = Date.now();
      this.validateDataMount();
      this.ensureDirectories();
      this.ensureDefaultFiles();

      const natsUrl = process.env.NATS_URL || 'nats://localhost:4222';
      this.nc = await connect({ servers: natsUrl });
      console.log(`Connected to NATS at ${natsUrl}`);

      this.loadConfig();
      this.setupToolHandlers();
      this.setupIngressHandlers();
      this.setupWatchers();
      this.startScheduler();
      this.spawnEnabledAgents();
      this.startHeartbeat();
      this.startHttpServer();

      this.publish(SUBJECTS.RUNTIME.READY, {
        id: uuidv4(),
        ts: new Date().toISOString(),
        type: 'RuntimeReady',
        from: 'runtime',
        to: SUBJECTS.RUNTIME.READY,
        payload: { status: 'ready' }
      });

      console.log('Runtime ready.');
    } catch (err) {
      console.error('Boot failed:', err);
      process.exit(1);
    }
  }

  private startHeartbeat() {
    this.heartbeatInterval = setInterval(() => {
      const uptime = Math.floor((Date.now() - this.startTime) / 1000);
      const agentsActive = Array.from(this.workers.keys()).length;
      
      this.publish('egress.ui.heartbeat', {
        id: uuidv4(),
        ts: new Date().toISOString(),
        type: 'Heartbeat',
        from: 'runtime',
        to: 'egress.ui.heartbeat',
        payload: {
          status: 'ok',
          uptime,
          lastBoot: new Date(this.startTime).toISOString(),
          agentsActive
        }
      });
    }, 5000);
  }

  private validateDataMount() {
    if (!fs.existsSync(DATA_ROOT)) {
      throw new Error(`/data mount not found!`);
    }
  }

  private ensureDirectories() {
    [SYSTEM_DIR, UI_DIR, AGENTS_DIR, SESSIONS_DIR, ARTIFACTS_DIR, CACHE_DIR].forEach(dir => {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
        console.log(`Created directory: ${dir}`);
      }
    });
  }

  private ensureDefaultFiles() {
    const defaults = {
      'system.json': {},
      'runtime.json': { http_port: 7070, nats_port: 4222 },
      'agents.json': [],
      'routing.json': {},
      'schedules.json': []
    };

    Object.entries(defaults).forEach(([file, content]) => {
      const filePath = path.join(SYSTEM_DIR, file);
      if (!fs.existsSync(filePath)) {
        fs.writeFileSync(filePath, JSON.stringify(content, null, 2));
        console.log(`Created default file: ${filePath}`);
      }
    });
  }

  private loadConfig() {
    const agentsPath = path.join(SYSTEM_DIR, 'agents.json');
    if (fs.existsSync(agentsPath)) {
      const agentList: AgentConfig[] = JSON.parse(fs.readFileSync(agentsPath, 'utf8'));
      this.agents.clear();
      agentList.forEach(a => this.agents.set(a.name, a));
    }

    const schedulesPath = path.join(SYSTEM_DIR, 'schedules.json');
    if (fs.existsSync(schedulesPath)) {
      this.schedules = JSON.parse(fs.readFileSync(schedulesPath, 'utf8'));
    }
  }

  private setupWatchers() {
    fs.watch(SYSTEM_DIR, (eventType, filename) => {
      if (filename && filename.endsWith('.json') && !filename.endsWith('.tmp')) {
        console.log(`System state updated on disk (${filename}). Reloading config...`);
        this.loadConfig();
        this.updateScheduler();
      }
    });

    fs.watch(UI_DIR, (eventType, filename) => {
      if (filename) {
        console.log(`UI asset updated on disk (${filename}).`);
      }
    });
  }

  private publish(subject: string, envelope: Envelope) {
    this.nc.publish(subject, jc.encode(envelope));
  }

  private setupToolHandlers() {
    this.nc.subscribe('tool.fs.*', {
      callback: (err, msg) => {
        if (err) return;
        const envelope = jc.decode(msg.data) as Envelope;
        const subject = msg.subject;
        let result: any;

        try {
          const { path: filePath, content } = envelope.payload;
          const safePath = path.resolve(DATA_ROOT, filePath.startsWith('/') ? filePath.slice(1) : filePath);
          
          if (!safePath.startsWith(DATA_ROOT)) throw new Error('Path traversal detected');

          switch (subject) {
            case SUBJECTS.TOOL.FS.READ:
              result = fs.readFileSync(safePath, 'utf8');
              break;
            case SUBJECTS.TOOL.FS.WRITE:
              fs.mkdirSync(path.dirname(safePath), { recursive: true });
              fs.writeFileSync(safePath, content);
              result = { status: 'success' };
              break;
            case SUBJECTS.TOOL.FS.LIST:
              result = fs.readdirSync(safePath);
              break;
          }
        } catch (e: any) {
          result = { error: e.message };
        }

        msg.respond(jc.encode({
          id: uuidv4(),
          ts: new Date().toISOString(),
          type: 'ToolResult',
          from: 'runtime',
          to: msg.reply || '',
          correlation_id: envelope.id,
          payload: result
        }));
      }
    });

    this.nc.subscribe('tool.agent.*', {
      callback: (err, msg) => {
        if (err) return;
        const envelope = jc.decode(msg.data) as Envelope;
        const subject = msg.subject;
        let result: any;

        try {
          switch (subject) {
            case SUBJECTS.TOOL.AGENT.LIST:
              result = Array.from(this.agents.values()).map(a => ({
                ...a,
                isRunning: this.workers.has(a.name)
              }));
              break;
            case SUBJECTS.TOOL.AGENT.CREATE:
              const newAgent = envelope.payload as AgentConfig;
              this.agents.set(newAgent.name, newAgent);
              this.saveAgents();
              this.materializeAgentFolder(newAgent.name);
              if (newAgent.enabled) this.spawnAgent(newAgent);
              result = { status: 'success' };
              break;
            case SUBJECTS.TOOL.AGENT.ENABLE:
              const agentToEnable = this.agents.get(envelope.payload.name);
              if (agentToEnable) {
                agentToEnable.enabled = true;
                this.saveAgents();
                this.spawnAgent(agentToEnable);
                result = { status: 'success' };
              }
              break;
            case SUBJECTS.TOOL.AGENT.DISABLE:
              const agentToDisable = this.agents.get(envelope.payload.name);
              if (agentToDisable) {
                agentToDisable.enabled = false;
                this.saveAgents();
                this.stopAgent(agentToDisable.name);
                result = { status: 'success' };
              }
              break;
            case 'tool.agent.delete':
              const nameToDelete = envelope.payload.name;
              this.stopAgent(nameToDelete);
              this.agents.delete(nameToDelete);
              this.saveAgents();
              result = { status: 'success' };
              break;
          }
        } catch (e: any) {
          result = { error: e.message };
        }

        msg.respond(jc.encode({
          id: uuidv4(),
          ts: new Date().toISOString(),
          type: 'ToolResult',
          from: 'runtime',
          to: msg.reply || '',
          correlation_id: envelope.id,
          payload: result
        }));
      }
    });

    this.nc.subscribe('tool.schedule.*', {
      callback: (err, msg) => {
        if (err) return;
        const envelope = jc.decode(msg.data) as Envelope;
        const subject = msg.subject;
        let result: any;

        try {
          switch (subject) {
            case SUBJECTS.TOOL.SCHEDULE.LIST:
              result = this.schedules;
              break;
            case SUBJECTS.TOOL.SCHEDULE.CREATE:
              const newSchedule = envelope.payload as ScheduleEntry;
              this.schedules.push(newSchedule);
              this.saveSchedules();
              this.updateScheduler();
              result = { status: 'success' };
              break;
          }
        } catch (e: any) {
          result = { error: e.message };
        }

        msg.respond(jc.encode({
          id: uuidv4(),
          ts: new Date().toISOString(),
          type: 'ToolResult',
          from: 'runtime',
          to: msg.reply || '',
          correlation_id: envelope.id,
          payload: result
        }));
      }
    });
  }

  private setupIngressHandlers() {
    this.nc.subscribe(SUBJECTS.INGRESS.MESSAGE, {
      callback: (err, msg) => {
        if (err) return;
        const envelope = jc.decode(msg.data) as Envelope;
        if (envelope.agent) {
          this.publish(SUBJECTS.AGENT.INBOX(envelope.agent), envelope);
        }
      }
    });
  }

  private startScheduler() {
    this.updateScheduler();
  }

  private updateScheduler() {
    // Clear existing
    this.cronTasks.forEach(t => t.stop());
    this.cronTasks.clear();
    this.intervalTasks.forEach(t => clearInterval(t));
    this.intervalTasks.clear();

    this.schedules.filter(s => s.enabled).forEach(s => {
      if (s.type === 'cron') {
        const task = cron.schedule(s.value as string, () => {
          this.publish(SUBJECTS.AGENT.INBOX(s.agent), {
            id: uuidv4(),
            ts: new Date().toISOString(),
            type: 'CronFire',
            from: 'runtime',
            to: SUBJECTS.AGENT.INBOX(s.agent),
            agent: s.agent,
            payload: { schedule_id: s.id }
          });
        });
        this.cronTasks.set(s.id, task);
      } else if (s.type === 'interval') {
        const interval = setInterval(() => {
          this.publish(SUBJECTS.AGENT.INBOX(s.agent), {
            id: uuidv4(),
            ts: new Date().toISOString(),
            type: 'Tick',
            from: 'runtime',
            to: SUBJECTS.AGENT.INBOX(s.agent),
            agent: s.agent,
            payload: { schedule_id: s.id }
          });
        }, (s.value as number) * 1000);
        this.intervalTasks.set(s.id, interval);
      }
    });
  }

  private spawnEnabledAgents() {
    this.agents.forEach(agent => {
      if (agent.enabled) {
        this.spawnAgent(agent);
      }
    });
  }

  private spawnAgent(agent: AgentConfig) {
    if (this.workers.has(agent.name)) return;
    
    console.log(`Spawning agent worker: ${agent.name}`);
    const worker = fork(path.join(__dirname, '../agent/worker.ts'), [], {
      execArgv: ['-r', 'ts-node/register'],
      env: { ...process.env, AGENT_NAME: agent.name }
    });

    worker.on('exit', (code) => {
      console.log(`Agent worker ${agent.name} exited with code ${code}`);
      this.workers.delete(agent.name);
    });

    this.workers.set(agent.name, worker);
  }

  private stopAgent(name: string) {
    const worker = this.workers.get(name);
    if (worker) {
      worker.kill();
      this.workers.delete(name);
    }
  }

  private saveAgents() {
    this.safeWriteJson(path.join(SYSTEM_DIR, 'agents.json'), Array.from(this.agents.values()));
  }

  private saveSchedules() {
    this.safeWriteJson(path.join(SYSTEM_DIR, 'schedules.json'), this.schedules);
  }

  private safeWriteJson(filePath: string, data: any) {
    const tempPath = `${filePath}.tmp`;
    try {
      const content = JSON.stringify(data, null, 2);
      fs.writeFileSync(tempPath, content);
      fs.renameSync(tempPath, filePath);
    } catch (err) {
      console.error(`Failed to atomically write JSON to ${filePath}:`, err);
      // Clean up temp file if it exists
      if (fs.existsSync(tempPath)) {
        try { fs.unlinkSync(tempPath); } catch (e) {}
      }
    }
  }

  private materializeAgentFolder(name: string) {
    const agentDir = path.join(AGENTS_DIR, name);
    const personaDir = path.join(agentDir, 'persona');
    const memoryDir = path.join(agentDir, 'memory');

    [agentDir, personaDir, memoryDir].forEach(dir => {
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    });

    fs.writeFileSync(path.join(agentDir, 'profile.json'), JSON.stringify({ name }, null, 2));
    fs.writeFileSync(path.join(personaDir, 'persona.md'), `# Persona for ${name}\n`);
    fs.writeFileSync(path.join(personaDir, 'principles.md'), `# Principles for ${name}\n`);
    fs.writeFileSync(path.join(personaDir, 'examples.md'), `# Examples for ${name}\n`);
    fs.writeFileSync(path.join(memoryDir, 'scratch.md'), `# Scratch for ${name}\n`);
  }

  private startHttpServer() {
    const port = parseInt(process.env.HTTP_PORT || '7070');
    const server = http.createServer((req, res) => {
      let urlPath = req.url === '/' ? '/index.html' : req.url!;
      let filePath: string;

      if (urlPath.startsWith('/data')) {
        filePath = path.join('/', urlPath);
      } else {
        filePath = path.join(UI_DIR, urlPath);
      }

      if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
        const ext = path.extname(filePath).toLowerCase();
        let contentType = 'text/plain';
        if (ext === '.html') contentType = 'text/html';
        else if (ext === '.js') contentType = 'application/javascript';
        else if (ext === '.json') contentType = 'application/json';
        else if (ext === '.css') contentType = 'text/css';
        else if (ext === '.svg') contentType = 'image/svg+xml';

        res.writeHead(200, {
          'Content-Type': contentType,
          'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
          'Pragma': 'no-cache',
          'Expires': '0',
          'Surrogate-Control': 'no-store'
        });
        fs.createReadStream(filePath).pipe(res);
      } else {
        res.writeHead(404);
        res.end('Not Found');
      }
    });

    const wss = new WebSocketServer({ noServer: true });

    server.on('upgrade', (request, socket, head) => {
      const pathname = new URL(request.url!, `http://${request.headers.host}`).pathname;

      if (pathname === '/_/nats') {
        wss.handleUpgrade(request, socket, head, (ws) => {
          this.handleWsBridge(ws);
        });
      } else {
        socket.destroy();
      }
    });

    server.listen(port, () => {
      console.log(`HTTP Server + WS Bridge listening on port ${port}`);
    });
  }

  private handleWsBridge(ws: WebSocket) {
    const net = require('net');
    const natsSocket = net.connect(4222, 'localhost', () => {
      ws.on('message', (data: Buffer) => natsSocket.write(data));
      natsSocket.on('data', (data: Buffer) => ws.send(data));
    });

    ws.on('close', () => natsSocket.end());
    natsSocket.on('close', () => ws.close());
    natsSocket.on('error', () => ws.close());
    ws.on('error', () => natsSocket.end());
  }
}

const runtime = new RuntimeController();
runtime.start();
