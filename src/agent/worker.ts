import { connect, NatsConnection, JSONCodec, Msg } from 'nats';
import { v4 as uuidv4 } from 'uuid';
import { Envelope, SUBJECTS } from '../types';

const jc = JSONCodec();
const agentName = process.env.AGENT_NAME!;

class AgentWorker {
  private nc!: NatsConnection;

  async start() {
    try {
      const natsUrl = process.env.NATS_URL || 'nats://localhost:4222';
      this.nc = await connect({ servers: natsUrl });
      console.log(`Agent ${agentName} connected to NATS`);

      this.subscribeToInbox();
      this.signalReady();
    } catch (err) {
      console.error(`Agent ${agentName} failed to start:`, err);
      process.exit(1);
    }
  }

  private subscribeToInbox() {
    const subject = SUBJECTS.AGENT.INBOX(agentName);
    this.nc.subscribe(subject, {
      callback: async (err, msg) => {
        if (err) return;
        const envelope = jc.decode(msg.data) as Envelope;
        await this.handleMessage(envelope);
      }
    });
  }

  private signalReady() {
    this.publish(SUBJECTS.AGENT.READY(agentName), {
      id: uuidv4(),
      ts: new Date().toISOString(),
      type: 'AgentReady',
      from: `agent:${agentName}`,
      to: SUBJECTS.AGENT.READY(agentName),
      agent: agentName,
      payload: { status: 'ready' }
    });
  }

  private async handleMessage(envelope: Envelope) {
    console.log(`Agent ${agentName} received message:`, envelope.type);

    try {
      // 1) Validate envelope (implicitly done by decoding)

      // 2) Hydrate agent context
      const context = await this.hydrateContext(envelope);

      // 3) Execute reasoning step (Placeholder Brain)
      const output = await this.placeholderBrain(context, envelope);

      // 4) If tool call requested (demonstrated in placeholder brain)

      // 5) If output generated
      if (output) {
        this.publish(SUBJECTS.EGRESS.RENDER, {
          id: uuidv4(),
          ts: new Date().toISOString(),
          type: 'AgentOutput',
          from: `agent:${agentName}`,
          to: SUBJECTS.EGRESS.RENDER,
          agent: agentName,
          payload: { text: output }
        });
      }

      // 6) Persist memory updates (demonstrated in placeholder brain)

    } catch (e: any) {
      this.publish(SUBJECTS.EGRESS.NOTIFY, {
        id: uuidv4(),
        ts: new Date().toISOString(),
        type: 'AgentOutput',
        from: `agent:${agentName}`,
        to: SUBJECTS.EGRESS.NOTIFY,
        agent: agentName,
        payload: { error: e.message }
      });
    }
  }

  private async hydrateContext(envelope: Envelope) {
    // Assembly order: persona, principles, schemas, memory, session, message
    const files = [
      `system/agents/${agentName}/persona/persona.md`,
      `system/agents/${agentName}/persona/principles.md`,
      `system/agents/${agentName}/memory/scratch.md`
    ];

    const contextParts = await Promise.all(files.map(async f => {
      const res = await this.requestTool(SUBJECTS.TOOL.FS.READ, { path: f });
      return typeof res === 'string' ? res : JSON.stringify(res);
    }));

    return {
      persona: contextParts[0],
      principles: contextParts[1],
      memory: contextParts[2],
      message: envelope.payload
    };
  }

  private async placeholderBrain(context: any, envelope: Envelope) {
    const input = envelope.payload.text || '';
    let response = `Hello! I am agent ${agentName}. I received: "${input}"`;

    // Demonstrate a tool call: append to scratch.md
    const scratchPath = `system/agents/${agentName}/memory/scratch.md`;
    const currentMemory = context.memory;
    const newMemory = currentMemory + `
- Received message at ${new Date().toISOString()}: ${input}`;
    
    await this.requestTool(SUBJECTS.TOOL.FS.WRITE, { path: scratchPath, content: newMemory });
    
    return response + ` (Updated my memory!)`;
  }

  private async requestTool(subject: string, payload: any) {
    const envelope: Envelope = {
      id: uuidv4(),
      ts: new Date().toISOString(),
      type: 'ToolRequest',
      from: `agent:${agentName}`,
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

const worker = new AgentWorker();
worker.start();
