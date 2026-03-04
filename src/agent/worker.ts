import { connect, NatsConnection, JSONCodec, KV } from 'nats';
import { 
  FSScope, 
  FSReadRequest, 
  FSResponse,
  FSWriteRequest,
  InferenceRequest,
  InferenceResponse,
  InferenceMessage
} from '../types';

const jc = JSONCodec();

const AGENT_ID = process.env.AGENT_ID;
const NATS_URL = process.env.NATS_URL;

if (!AGENT_ID || !NATS_URL) {
  console.error('Missing AGENT_ID or NATS_URL in environment');
  process.exit(1);
}

class SovereignAgent {
  private nc!: NatsConnection;

  async start() {
    try {
      this.nc = await connect({ servers: NATS_URL });
      console.log(`[Agent: ${AGENT_ID}] Connected to NATS at ${NATS_URL}`);

      this.subscribeToTopics();
      console.log(`[Agent: ${AGENT_ID}] Worker started and listening for events.`);
    } catch (err) {
      console.error(`[Agent: ${AGENT_ID}] Failed to start:`, err);
      process.exit(1);
    }
  }

  private subscribeToTopics() {
    const handleEvent = async (err: any, msg: any) => {
      if (err) {
        console.error(`[Agent: ${AGENT_ID}] Subscription error:`, err);
        return;
      }
      
      const payload = msg.data.length > 0 ? jc.decode(msg.data) : {};
      await this.runReasoningCycle(payload);
    };

    this.nc.subscribe(`agent.${AGENT_ID}.inbox`, { callback: handleEvent });
    this.nc.subscribe(`agent.${AGENT_ID}.tick`, { callback: handleEvent });
    this.nc.subscribe(`agent.${AGENT_ID}.task_complete`, { callback: handleEvent });
  }

  private async requestFSRead(path: string): Promise<string | null> {
    const req: FSReadRequest = {
      scope: FSScope.AGENT,
      agent_id: AGENT_ID,
      path
    };
    
    try {
      const resMsg = await this.nc.request('service.fs.read', jc.encode(req), { timeout: 5000 });
      const res = jc.decode(resMsg.data) as FSResponse;
      if (res.status === 'success' && res.content !== undefined) {
        return res.content;
      } else {
        console.warn(`[Agent: ${AGENT_ID}] FSRead error for ${path}:`, res.error);
        return null;
      }
    } catch (e: any) {
      console.warn(`[Agent: ${AGENT_ID}] FSRead request timed out or failed for ${path}:`, e.message);
      return null;
    }
  }

  private async requestFSWrite(path: string, content: string): Promise<boolean> {
    const req: FSWriteRequest = {
      scope: FSScope.AGENT,
      agent_id: AGENT_ID,
      path,
      content
    };
    
    try {
      const resMsg = await this.nc.request('service.fs.write', jc.encode(req), { timeout: 5000 });
      const res = jc.decode(resMsg.data) as FSResponse;
      return res.status === 'success';
    } catch (e: any) {
      console.error(`[Agent: ${AGENT_ID}] FSWrite request failed for ${path}:`, e.message);
      return false;
    }
  }

  private async runReasoningCycle(triggerPayload: any) {
    console.log(`[Agent: ${AGENT_ID}] Reasoning cycle initiated.`);

    // 1. Read Profile
    const profileJsonStr = await this.requestFSRead('profile.json');
    if (!profileJsonStr) {
      console.error(`[Agent: ${AGENT_ID}] Aborting cycle: Unable to read profile.json.`);
      return;
    }

    let profile: any;
    try {
      profile = JSON.parse(profileJsonStr);
    } catch (e) {
      console.error(`[Agent: ${AGENT_ID}] Aborting cycle: profile.json is invalid JSON.`);
      return;
    }

    // 2. Hydrate Contexts
    const contextFiles: string[] = profile.contextFiles || [];
    let systemPrompt = '';
    let scratchpadContent = '';

    for (const file of contextFiles) {
      const content = await this.requestFSRead(file);
      if (content !== null) {
        systemPrompt += `
--- [${file}] ---
${content}
`;
        if (file === 'scratchpad.md') {
          scratchpadContent = content;
        }
      }
    }

    // If no scratchpad.md was explicitly fetched but we need to write to it later,
    // we'll just attempt to read it now if it wasn't in contextFiles (standard fallback)
    if (!contextFiles.includes('scratchpad.md')) {
      const sp = await this.requestFSRead('scratchpad.md');
      scratchpadContent = sp || '';
    }

    // 3. Discover Tools
    let tools: any[] = [];
    try {
      const js = this.nc.jetstream();
      const toolsKv = await js.views.kv('ROOK_TOOLS');
      const keys = await toolsKv.keys();
      for await (const k of keys) {
        const entry = await toolsKv.get(k);
        if (entry) {
          try {
            const toolDef = jc.decode(entry.value);
            tools.push(toolDef);
          } catch (e) {}
        }
      }
    } catch (e) {
      console.log(`[Agent: ${AGENT_ID}] No ROOK_TOOLS KV bucket found or unable to access it. Defaulting to no tools.`);
    }

    // 4. Inference & Tool Loop
    const messages: InferenceMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: JSON.stringify(triggerPayload) }
    ];

    let cycleComplete = false;
    let finalResponseText = '';

    while (!cycleComplete) {
      const infReq: InferenceRequest = {
        model: profile.model?.name || 'default',
        temperature: profile.model?.temp || 0.7,
        messages,
        tools: tools.length > 0 ? tools : undefined
      };

      let infResMsg: any;
      try {
        infResMsg = await this.nc.request('service.llm.inference', jc.encode(infReq), { timeout: 60000 });
      } catch (e: any) {
        console.error(`[Agent: ${AGENT_ID}] Inference request failed:`, e.message);
        return; // Gracefully abort
      }

      const infRes = jc.decode(infResMsg.data) as InferenceResponse;
      if (infRes.status !== 'success') {
        console.error(`[Agent: ${AGENT_ID}] Inference returned error:`, infRes.error);
        return; // Gracefully abort
      }

      const assistantMsg: InferenceMessage = {
        role: 'assistant',
        content: infRes.content || '',
      };
      
      if (infRes.tool_calls && infRes.tool_calls.length > 0) {
        assistantMsg.tool_calls = infRes.tool_calls;
        messages.push(assistantMsg);

        for (const toolCall of infRes.tool_calls) {
          const toolName = toolCall.name;
          const toolArgs = toolCall.arguments;

          let toolResultStr = '';
          try {
            const mcpReq = await this.nc.request(`mcp.v1.tools.call.${toolName}`, jc.encode(toolArgs), { timeout: 30000 });
            const mcpRes = jc.decode(mcpReq.data);
            toolResultStr = JSON.stringify(mcpRes);
          } catch (e: any) {
            console.error(`[Agent: ${AGENT_ID}] MCP Tool call failed for ${toolName}:`, e.message);
            toolResultStr = JSON.stringify({ error: e.message });
          }

          messages.push({
            role: 'tool',
            content: toolResultStr,
            tool_call_id: toolCall.id
          });
        }
      } else {
        // No more tool calls, we have a final response
        if (infRes.content) {
          messages.push(assistantMsg);
          finalResponseText = infRes.content;
        }
        cycleComplete = true;
      }
    }

    // 5. Memory Commit
    if (finalResponseText) {
      console.log(`[Agent: ${AGENT_ID}] Final response generated. Committing to scratchpad.md`);
      
      const timestamp = new Date().toISOString();
      const updatedScratchpadStr = scratchpadContent 
        ? `${scratchpadContent}

[${timestamp}] Incoming Payload: ${JSON.stringify(triggerPayload)}
Response: ${finalResponseText}`
        : `[${timestamp}] Incoming Payload: ${JSON.stringify(triggerPayload)}
Response: ${finalResponseText}`;

      const writeSuccess = await this.requestFSWrite('scratchpad.md', updatedScratchpadStr);
      if (writeSuccess) {
        console.log(`[Agent: ${AGENT_ID}] Successfully updated scratchpad.md`);
      }
    }
    
    console.log(`[Agent: ${AGENT_ID}] Reasoning cycle finished.`);
  }
}

const worker = new SovereignAgent();
worker.start();
