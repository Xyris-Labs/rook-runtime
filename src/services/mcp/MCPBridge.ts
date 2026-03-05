import { connect, NatsConnection, JSONCodec, KV } from 'nats';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { 
  ServiceType, 
  HandshakeRequest, 
  HandshakeResponse, 
  StatusEntry,
  MCPCallRequest,
  MCPCallResponse
} from '../../types';

const jc = JSONCodec();

export class MCPBridge {
  private nc!: NatsConnection;
  private uuid!: string;
  private statusKv!: KV;
  private toolsKv!: KV;
  private mcpClient!: Client;
  private transport!: StdioClientTransport;

  private command: string;
  private args: string[];

  constructor(command: string, args: string[]) {
    this.command = command;
    this.args = args;
  }

  async start() {
    console.log(`Starting MCP Bridge for ${this.command} ${this.args.join(' ')}...`);
    const natsUrl = process.env.NATS_URL || 'nats://localhost:4222';
    
    try {
      this.nc = await connect({ servers: natsUrl });
      console.log(`MCP Bridge connected to NATS at ${natsUrl}`);
      
      const js = this.nc.jetstream();
      this.statusKv = await js.views.kv('ROOK_STATUS');
      this.toolsKv = await js.views.kv('ROOK_TOOLS');

      await this.handshake();
      
      await this.initMcpClient();
      await this.registerTools();

      this.startHeartbeat();
      this.setupHandlers();
      
      console.log('MCP Bridge service ready.');
    } catch (err) {
      console.error('MCP Bridge failed to start:', err);
      process.exit(1);
    }
  }

  private async handshake() {
    const req: HandshakeRequest = { type: ServiceType.MCP_BRIDGE, name: 'primary' };
    try {
      const msg = await this.nc.request('registry.handshake', jc.encode(req), { timeout: 5000 });
      const res = jc.decode(msg.data) as HandshakeResponse;
      this.uuid = res.uuid;
      console.log(`MCP Bridge acquired UUID: ${this.uuid}`);
    } catch (err) {
      console.error('MCP Bridge failed handshake:', err);
      throw err;
    }
  }

  private async initMcpClient() {
    console.log('Initializing MCP Stdio Transport...');
    
    // Ensure the target directory exists if we are wrapping the filesystem server
    if (this.args.includes('/data/artifacts')) {
      const fs = require('fs');
      if (!fs.existsSync('/data/artifacts')) {
        fs.mkdirSync('/data/artifacts', { recursive: true });
      }
    }

    this.transport = new StdioClientTransport({
      command: this.command,
      args: this.args
    });

    this.mcpClient = new Client({
      name: `rook-mcp-bridge-${this.uuid}`,
      version: '1.0.0'
    }, {
      capabilities: {}
    });

    await this.mcpClient.connect(this.transport);
    console.log('MCP Client connected to transport.');
  }

  private async registerTools() {
    try {
      console.log('Requesting tools from MCP Server...');
      const response = await this.mcpClient.listTools();
      
      for (const tool of response.tools) {
        // Construct the schema expected by the LLM
        const schema = {
          type: "function",
          function: {
            name: tool.name,
            description: tool.description || "",
            parameters: tool.inputSchema
          }
        };

        // Write to ROOK_TOOLS JetStream bucket
        await this.toolsKv.put(tool.name, jc.encode(schema));
        console.log(`Registered MCP Tool: ${tool.name}`);
      }
    } catch (e) {
      console.error('Failed to register MCP tools:', e);
    }
  }

  private startHeartbeat() {
    const sendStatus = async () => {
      const status: StatusEntry = {
        status: 'online',
        load: 0,
        capabilities: ['mcp-proxy'],
        alerts: [],
        last_seen: new Date().toISOString()
      };
      try {
        await this.statusKv.put(this.uuid, jc.encode(status));
      } catch (err) {
        console.error('MCP Bridge failed to put status:', err);
      }
    };
    
    sendStatus();
    setInterval(sendStatus, 10000);
  }

  private setupHandlers() {
    this.nc.subscribe('mcp.v1.tools.call.*', {
      callback: async (err, msg) => {
        if (err) return;
        
        const toolName = msg.subject.split('.').pop()!;
        let reqArgs: Record<string, any> = {};

        try {
          reqArgs = jc.decode(msg.data) as Record<string, any>;
        } catch(e) {
          // Some tools might take no args or raw strings, safely default
          reqArgs = {};
        }

        console.log(`[MCP Bridge] Executing tool: ${toolName}`);

        try {
          const result = await this.mcpClient.callTool({
            name: toolName,
            arguments: reqArgs
          });

          const response: MCPCallResponse = {
            status: 'success',
            result: result
          };
          msg.respond(jc.encode(response));

        } catch (e: any) {
          console.error(`[MCP Bridge] Tool execution failed for ${toolName}:`, e.message);
          const response: MCPCallResponse = {
            status: 'error',
            error: e.message
          };
          msg.respond(jc.encode(response));
        }
      }
    });
  }
}
