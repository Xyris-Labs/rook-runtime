import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import { WebSocketServer, WebSocket } from 'ws';
import { connect, StringCodec } from 'nats';
import { Hub } from '../hub/Hub';
import { Librarian } from '../services/fs/Librarian';
import { Executor } from '../services/executor/Executor';
import { Broker } from '../services/llm/Broker';
import { CopilotAdapter } from '../services/llm/adapters/CopilotAdapter';
import { OpenAIAdapter } from '../services/llm/adapters/OpenAIAdapter';
import { TempoServer } from '../services/tempo/TempoServer';
import { MCPBridge } from '../services/mcp/MCPBridge';
import { ScribeServer } from '../services/scribe/ScribeServer';

const CONTAINER_UI_DIR = '/data/ui';
const LOCAL_UI_DIR = path.resolve(__dirname, '../../rook_data/ui');
const UI_DIR = fs.existsSync(CONTAINER_UI_DIR) ? CONTAINER_UI_DIR : LOCAL_UI_DIR;

async function bootstrap() {
  console.log('Bootstrapping Rook v2.0 Service Mesh...');

  // Start the JetStream Hub
  const hub = new Hub();
  await hub.start();

  // Give the Hub a moment to create the streams before services try to use them
  await new Promise(resolve => setTimeout(resolve, 1000));

  // Start the sovereign Librarian service
  const librarian = new Librarian();
  await librarian.start();

  // Start the sovereign Executor service
  const executor = new Executor();
  await executor.start();

  // Start the LLM Broker and Adapters
  const broker = new Broker();
  await broker.start();
  
  const copilotAdapter = new CopilotAdapter();
  await copilotAdapter.start();

  const openAiAdapter = new OpenAIAdapter();
  await openAiAdapter.start();

  // Start the Tempo Server
  const tempo = new TempoServer();
  await tempo.start();

  // Start MCP Bridge for filesystem access in /data
  const mcpFs = new MCPBridge('npx', ['-y', '@modelcontextprotocol/server-filesystem', '/data/artifacts']);
  await mcpFs.start();

  // Start Scribe file server (HTTP on port 7071, NATS registration)
  const scribe = new ScribeServer();
  await scribe.start();

  // NATS client for the HTTP Proxy
  const natsUrl = process.env.NATS_URL || 'nats://localhost:4222';
  const proxyNc = await connect({ servers: natsUrl });
  const sc = StringCodec();

  // Temporary UI Host & WS Proxy to keep Cockpit alive
  const port = parseInt(process.env.HTTP_PORT || '7070');
  const server = http.createServer(async (req, res) => {
    const requestUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const urlPath = requestUrl.pathname === '/' ? '/index.html' : requestUrl.pathname;

    // Micro-Frontend Proxy Route
    if (urlPath.match(/^\/api\/workers\/[^\/]+\/ui\.js$/)) {
      const uuid = urlPath.split('/')[3];
      try {
        const rep = await proxyNc.request(`worker.${uuid}.get_ui`, new Uint8Array(0), { timeout: 5000 });
        res.writeHead(200, {
          'Content-Type': 'application/javascript',
          'Cache-Control': 'no-cache, no-store, must-revalidate'
        });
        res.end(sc.decode(rep.data));
      } catch (err: any) {
        console.error(`[Proxy] Failed to fetch UI for ${uuid}:`, err.message);
        res.writeHead(504, { 'Content-Type': 'application/javascript' });
        res.end(`console.error("Failed to load worker UI: ${err.message}");`);
      }
      return;
    }

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
      // SPA Catch-all: Route unknown paths back to index.html
      const indexPath = path.join(UI_DIR, 'index.html');
      if (fs.existsSync(indexPath)) {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        fs.createReadStream(indexPath).pipe(res);
      } else {
        res.writeHead(404);
        res.end('Not Found');
      }
    }
  });

  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (request, socket, head) => {
    const pathname = new URL(request.url!, `http://${request.headers.host}`).pathname;

    if (pathname === '/_/nats') {
      wss.handleUpgrade(request, socket, head, (ws) => {
        const net = require('net');
        const natsSocket = net.connect(4222, 'localhost', () => {
          ws.on('message', (data: Buffer) => natsSocket.write(data));
          natsSocket.on('data', (data: Buffer) => ws.send(data));
        });

        ws.on('close', () => natsSocket.end());
        natsSocket.on('close', () => ws.close());
        natsSocket.on('error', () => ws.close());
        ws.on('error', () => natsSocket.end());
      });
    } else {
      socket.destroy();
    }
  });

  server.listen(port, () => {
    console.log(`[Stub] Serving UI from ${UI_DIR}`);
    console.log(`[Stub] HTTP Server + WS Bridge listening on port ${port}`);
  });
}

bootstrap().catch(err => {
  console.error('Fatal bootstrap error:', err);
  process.exit(1);
});
