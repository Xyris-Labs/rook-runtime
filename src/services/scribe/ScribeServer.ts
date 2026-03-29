import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import { connect, NatsConnection, JSONCodec, KV } from 'nats';
import {
  ServiceType,
  HandshakeRequest,
  HandshakeResponse,
  StatusEntry,
} from '../../types';

const jc = JSONCodec();
const HTTP_PORT = 7071;

export class ScribeServer {
  private nc!: NatsConnection;
  private uuid!: string;
  private statusKv!: KV;
  private root: string;
  private httpPort: number;
  private httpServer!: http.Server;

  constructor() {
    this.root = path.resolve(
      process.env.SCRIBE_ROOT || path.join(process.cwd(), 'rook_data', 'files')
    );
    this.httpPort = parseInt(process.env.SCRIBE_HTTP_PORT || String(HTTP_PORT), 10);
  }

  async start() {
    console.log('Starting Scribe service...');

    if (!fs.existsSync(this.root)) {
      fs.mkdirSync(this.root, { recursive: true });
      console.log(`[Scribe] Created root directory: ${this.root}`);
    }

    const natsUrl = process.env.NATS_URL || 'nats://localhost:4222';
    this.nc = await connect({ servers: natsUrl });
    console.log(`[Scribe] Connected to NATS at ${natsUrl}`);

    const js = this.nc.jetstream();
    this.statusKv = await js.views.kv('ROOK_STATUS');

    await this.handshake();
    this.startHeartbeat();
    this.setupNatsHandlers();
    this.startHttpServer();

    console.log('[Scribe] Service ready.');
  }

  // ── NATS ──────────────────────────────────────────────────────────────────

  private async handshake() {
    const req: HandshakeRequest = { type: ServiceType.SCRIBE, name: 'primary' };
    try {
      const msg = await this.nc.request('registry.handshake', jc.encode(req), { timeout: 5000 });
      const res = jc.decode(msg.data) as HandshakeResponse;
      this.uuid = res.uuid;
      console.log(`[Scribe] Acquired UUID: ${this.uuid}`);
    } catch (err) {
      console.error('[Scribe] Handshake failed:', err);
      throw err;
    }
  }

  private startHeartbeat() {
    const sendStatus = async () => {
      const status: StatusEntry & { httpPort: number; serviceType: string } = {
        status: 'online',
        load: 0,
        capabilities: ['file-server'],
        alerts: [],
        last_seen: new Date().toISOString(),
        httpPort: this.httpPort,
        serviceType: ServiceType.SCRIBE,
      };
      try {
        await this.statusKv.put(this.uuid, jc.encode(status));
      } catch (err) {
        console.error('[Scribe] Failed to put status:', err);
      }
    };

    sendStatus();
    setInterval(sendStatus, 15000);
  }

  private setupNatsHandlers() {
    this.nc.subscribe(`scribe.${this.uuid}.ping`, {
      callback: (err, msg) => {
        if (err) return;
        msg.respond(jc.encode({ status: 'pong', uuid: this.uuid }));
      },
    });
  }

  private publishEvent(event: 'created' | 'updated' | 'deleted' | 'moved', filePath: string) {
    try {
      this.nc.publish(
        'scribe.events',
        jc.encode({ event, path: filePath, timestamp: new Date().toISOString() })
      );
    } catch {
      // Non-fatal
    }
  }

  // ── Path helpers ──────────────────────────────────────────────────────────

  private resolvePath(relativePath: string): string {
    if (relativePath.includes('..')) {
      throw new Error('Path traversal not allowed');
    }
    const normalized = relativePath.replace(/^\/+/, '');
    const resolved = path.resolve(this.root, normalized || '.');
    if (resolved !== this.root && !resolved.startsWith(this.root + path.sep)) {
      throw new Error('Path traversal not allowed');
    }
    return resolved;
  }

  // ── HTTP helpers ──────────────────────────────────────────────────────────

  private cors(res: http.ServerResponse) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  }

  private json(res: http.ServerResponse, code: number, data: unknown) {
    this.cors(res);
    res.writeHead(code, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
  }

  private err(res: http.ServerResponse, code: number, message: string) {
    this.json(res, code, { error: message });
  }

  private readBody(req: http.IncomingMessage): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', () => resolve(Buffer.concat(chunks)));
      req.on('error', reject);
    });
  }

  // ── HTTP server ───────────────────────────────────────────────────────────

  private startHttpServer() {
    this.httpServer = http.createServer(async (req, res) => {
      const url = new URL(req.url || '/', `http://localhost:${this.httpPort}`);
      const method = (req.method || 'GET').toUpperCase();

      if (method === 'OPTIONS') {
        this.cors(res);
        res.writeHead(204);
        res.end();
        return;
      }

      try {
        const p = url.pathname;
        if      (p === '/files'          && method === 'GET')    await this.handleList(res, url);
        else if (p === '/files/download' && method === 'GET')    await this.handleDownload(req, res, url);
        else if (p === '/files/upload'   && method === 'POST')   await this.handleUpload(req, res, url);
        else if (p === '/files/mkdir'    && method === 'PUT')    await this.handleMkdir(res, url);
        else if (p === '/files'          && method === 'DELETE') await this.handleDelete(res, url);
        else if (p === '/files/move'     && method === 'POST')   await this.handleMove(req, res);
        else this.err(res, 404, 'Not found');
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : 'Internal error';
        this.err(res, 500, msg);
      }
    });

    this.httpServer.listen(this.httpPort, () => {
      console.log(`[Scribe] HTTP server listening on port ${this.httpPort}`);
    });
  }

  // ── Route handlers ────────────────────────────────────────────────────────

  private async handleList(res: http.ServerResponse, url: URL) {
    const rel = url.searchParams.get('path') || '.';
    const resolved = this.resolvePath(rel);

    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
      return this.err(res, 404, 'Directory not found');
    }

    const names = fs.readdirSync(resolved);
    const entries = names.map(name => {
      const full = path.join(resolved, name);
      const stat = fs.statSync(full);
      return {
        name,
        type: stat.isDirectory() ? 'dir' : 'file',
        size: stat.isDirectory() ? null : stat.size,
        modified: stat.mtime.toISOString(),
      };
    });

    entries.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    this.json(res, 200, { path: rel, entries });
  }

  private async handleDownload(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    url: URL
  ) {
    const rel = url.searchParams.get('path') || '';
    if (!rel) return this.err(res, 400, 'path required');

    const resolved = this.resolvePath(rel);
    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
      return this.err(res, 404, 'File not found');
    }

    const ext = path.extname(resolved).toLowerCase();
    const mimeMap: Record<string, string> = {
      '.txt': 'text/plain',  '.md': 'text/markdown',
      '.html': 'text/html',  '.css': 'text/css',
      '.js': 'application/javascript', '.ts': 'text/plain',
      '.json': 'application/json',     '.xml': 'application/xml',
      '.png': 'image/png',  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
      '.gif': 'image/gif',  '.svg': 'image/svg+xml', '.webp': 'image/webp',
      '.pdf': 'application/pdf',
    };
    const contentType = mimeMap[ext] || 'application/octet-stream';
    const stat = fs.statSync(resolved);

    this.cors(res);
    res.writeHead(200, {
      'Content-Type': contentType,
      'Content-Length': stat.size,
      'Content-Disposition': `attachment; filename="${path.basename(resolved)}"`,
    });
    fs.createReadStream(resolved).pipe(res);
  }

  private async handleUpload(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    url: URL
  ) {
    const rel = url.searchParams.get('path') || '';
    if (!rel) return this.err(res, 400, 'path required');

    const resolved = this.resolvePath(rel);
    const dir = path.dirname(resolved);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const body = await this.readBody(req);
    const exists = fs.existsSync(resolved);
    fs.writeFileSync(resolved, body);

    this.publishEvent(exists ? 'updated' : 'created', rel);
    this.json(res, 200, { status: 'ok', path: rel });
  }

  private async handleMkdir(res: http.ServerResponse, url: URL) {
    const rel = url.searchParams.get('path') || '';
    if (!rel) return this.err(res, 400, 'path required');

    const resolved = this.resolvePath(rel);
    fs.mkdirSync(resolved, { recursive: true });

    this.publishEvent('created', rel);
    this.json(res, 200, { status: 'ok', path: rel });
  }

  private async handleDelete(res: http.ServerResponse, url: URL) {
    const rel = url.searchParams.get('path') || '';
    if (!rel) return this.err(res, 400, 'path required');

    const resolved = this.resolvePath(rel);
    if (!fs.existsSync(resolved)) return this.err(res, 404, 'Path not found');

    if (fs.statSync(resolved).isDirectory()) {
      fs.rmSync(resolved, { recursive: true, force: true });
    } else {
      fs.unlinkSync(resolved);
    }

    this.publishEvent('deleted', rel);
    this.json(res, 200, { status: 'ok', path: rel });
  }

  private async handleMove(req: http.IncomingMessage, res: http.ServerResponse) {
    const body = await this.readBody(req);
    let payload: { from: string; to: string };
    try {
      payload = JSON.parse(body.toString());
    } catch {
      return this.err(res, 400, 'Invalid JSON body');
    }

    const { from, to } = payload;
    if (!from || !to) return this.err(res, 400, 'from and to required');

    const resolvedFrom = this.resolvePath(from);
    const resolvedTo   = this.resolvePath(to);

    if (!fs.existsSync(resolvedFrom)) return this.err(res, 404, 'Source not found');

    const toDir = path.dirname(resolvedTo);
    if (!fs.existsSync(toDir)) fs.mkdirSync(toDir, { recursive: true });

    fs.renameSync(resolvedFrom, resolvedTo);

    this.publishEvent('moved', `${from} -> ${to}`);
    this.json(res, 200, { status: 'ok', from, to });
  }
}
