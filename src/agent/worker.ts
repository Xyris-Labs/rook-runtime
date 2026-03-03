import { connect, NatsConnection, JSONCodec, Msg } from 'nats';
import { v4 as uuidv4 } from 'uuid';
import { Envelope, SUBJECTS, AgentConfig } from '../types';

const jc = JSONCodec();

export class Agent {
  private nc!: NatsConnection;
  private name: string;
  private config!: AgentConfig;
  private contextData: Record<string, string> = {};

  constructor(name: string) {
    this.name = name;
  }

  async start() {
    try {
      const natsUrl = process.env.NATS_URL || 'nats://localhost:4222';
      this.nc = await connect({ servers: natsUrl });
      console.log(`Agent ${this.name} connected to NATS`);

      await this.initialize();

      this.subscribeToInbox();
      this.signalReady();
    } catch (err) {
      console.error(`Agent ${this.name} failed to start:`, err);
      process.exit(1);
    }
  }

  private async initialize() {
    // 1. Request profile.json via cognition
    const profileRes = await this.requestTool(SUBJECTS.TOOL.COGNITION.READ, { path: 'profile.json' });
    if (profileRes && profileRes.error) {
       console.warn(`Agent ${this.name} profile.json not found or error: ${profileRes.error}`);
       this.config = { name: this.name, enabled: true, id: this.name, inbox: SUBJECTS.AGENT.INBOX(this.name), path: '', contextFiles: [], model: { provider: 'openai', name: 'gpt-4o', temp: 0.7 } };
    } else {
       this.config = typeof profileRes === 'string' ? JSON.parse(profileRes) : profileRes;
    }

    // 2. Iterate through contextFiles and pull content
    if (this.config.contextFiles && Array.isArray(this.config.contextFiles)) {
      for (const file of this.config.contextFiles) {
        const fileRes = await this.requestTool(SUBJECTS.TOOL.COGNITION.READ, { path: file });
        if (fileRes && !fileRes.error) {
          this.contextData[file] = typeof fileRes === 'string' ? fileRes : JSON.stringify(fileRes);
        } else {
          // File missing, create it
          await this.requestTool(SUBJECTS.TOOL.COGNITION.WRITE, { path: file, content: '' });
          this.contextData[file] = '';
        }
      }
    }

    // Verify model availability via LLM Broker
    try {
      const modelsRes = await this.requestTool(SUBJECTS.SERVICE.LLM.MODELS.LIST, {});
      console.log(`Agent ${this.name} verified models:`, modelsRes.models);
    } catch (e) {
      console.warn(`Agent ${this.name} could not verify models.`);
    }
  }

  private subscribeToInbox() {
    const subject = SUBJECTS.AGENT.INBOX(this.name);
    this.nc.subscribe(subject, {
      callback: async (err, msg) => {
        if (err) return;
        const envelope = jc.decode(msg.data) as Envelope;
        await this.handleMessage(envelope);
      }
    });
  }

  private signalReady() {
    this.publish(SUBJECTS.AGENT.READY(this.name), {
      id: uuidv4(),
      ts: new Date().toISOString(),
      type: 'AgentReady',
      from: `agent:${this.name}`,
      to: SUBJECTS.AGENT.READY(this.name),
      agent: this.name,
      payload: { status: 'ready' }
    });
  }

  private async handleMessage(envelope: Envelope) {
    console.log(`Agent ${this.name} reasoning cycle triggered by:`, envelope.type);

    try {
      // Execute reasoning step
      const output = await this.reasoningCycle(envelope);

      if (output) {
        this.publish(SUBJECTS.EGRESS.RENDER, {
          id: uuidv4(),
          ts: new Date().toISOString(),
          type: 'AgentOutput',
          from: `agent:${this.name}`,
          to: SUBJECTS.EGRESS.RENDER,
          agent: this.name,
          payload: { text: output }
        });
      }

    } catch (e: any) {
      this.publish(SUBJECTS.EGRESS.NOTIFY, {
        id: uuidv4(),
        ts: new Date().toISOString(),
        type: 'AgentOutput',
        from: `agent:${this.name}`,
        to: SUBJECTS.EGRESS.NOTIFY,
        agent: this.name,
        payload: { error: e.message }
      });
    }
  }

  private async reasoningCycle(envelope: Envelope) {
    const input = envelope.payload.text || 'Tick';
    
    // Assemble mind context
    let mindContext = '';
    for (const [file, content] of Object.entries(this.contextData)) {
      mindContext += `\n--- ${file} ---\n${content}\n`;
    }

    // Call inference service
    const prompt = `Context:\n${mindContext}\n\nInput: ${input}`;
    
    const inferenceRes = await this.requestTool(SUBJECTS.SERVICE.LLM.INFERENCE, {
      model: this.config.model,
      prompt
    });

    if (inferenceRes.error) {
      return `[Agent ${this.name}] Inference Error: ${inferenceRes.error}`;
    }

    return `[Agent ${this.name}] Processed input: "${input}". Response: ${inferenceRes.text || 'Ack'}`;
  }

  private async requestTool(subject: string, payload: any) {
    const envelope: Envelope = {
      id: uuidv4(),
      ts: new Date().toISOString(),
      type: 'ToolRequest',
      from: `agent:${this.name}`,
      to: subject,
      payload
    };

    const msg = await this.nc.request(subject, jc.encode(envelope), { timeout: 5000 });
    const res = jc.decode(msg.data) as Envelope;
    return res.payload;
  }

  private publish(subject: string, envelope: Envelope) {
    this.nc.publish(subject, jc.encode(envelope));
  }
}

// Only auto-start if run directly
if (require.main === module) {
  const name = process.env.AGENT_NAME;
  if (name) {
    const worker = new Agent(name);
    worker.start();
  } else {
    console.error("AGENT_NAME environment variable is required");
    process.exit(1);
  }
}
