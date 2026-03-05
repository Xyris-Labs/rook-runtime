import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import { WebSocketServer, WebSocket } from 'ws';
import { connect } from 'nats';
import { Hub } from '../hub/Hub';
import { Librarian } from '../services/fs/Librarian';
import { Executor } from '../services/executor/Executor';
import { Broker } from '../services/llm/Broker';
import { CopilotAdapter } from '../services/llm/adapters/CopilotAdapter';
import { TempoServer } from '../services/tempo/TempoServer';

const UI_DIR = '/data/ui';

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

  // Start the Tempo Server
  const tempo = new TempoServer();
  await tempo.start();

  // Temporary UI Host & WS Proxy to keep Cockpit alive
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
    console.log(`[Stub] HTTP Server + WS Bridge listening on port ${port}`);
  });
}

bootstrap().catch(err => {
  console.error('Fatal bootstrap error:', err);
  process.exit(1);
});
