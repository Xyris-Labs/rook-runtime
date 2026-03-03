import * as fs from 'fs';
import * as path from 'path';
import { NatsConnection, JSONCodec } from 'nats';
import { v4 as uuidv4 } from 'uuid';
import { Envelope, SUBJECTS } from '../types';

const DATA_ROOT = '/data';
const LLM_DIR = path.join(DATA_ROOT, 'system', 'llm');
const PROVIDERS_FILE = path.join(LLM_DIR, 'providers.json');

const jc = JSONCodec();

export interface ProviderConfig {
  id: string;
  adapter: string;
  enabled: boolean;
  auth: {
    type: string;
    secret: string;
    refresh_token?: string;
    expires_at?: number;
  };
  endpoint?: string;
  models: {
    auto_discover: boolean;
    manifest: string[];
  };
  throttling: {
    max_concurrency: number;
    requests_per_min: number;
  };
}

export class LlmManager {
  private providers: Map<string, ProviderConfig> = new Map();
  private nc: NatsConnection;

  constructor(nc: NatsConnection) {
    this.nc = nc;
    this.ensureDirectory();
    this.loadProviders();
  }

  private ensureDirectory() {
    if (!fs.existsSync(LLM_DIR)) {
      fs.mkdirSync(LLM_DIR, { recursive: true });
    }
    if (!fs.existsSync(PROVIDERS_FILE)) {
      const defaultProviders = {
        providers: [
          {
            id: 'openai-default',
            adapter: 'openai',
            enabled: true,
            auth: {
              type: 'apiKey',
              secret: 'dummy-key'
            },
            models: {
              auto_discover: false,
              manifest: ['gpt-4o', 'gpt-4-turbo']
            },
            throttling: {
              max_concurrency: 5,
              requests_per_min: 50
            }
          }
        ]
      };
      this.safeWriteJson(PROVIDERS_FILE, defaultProviders);
    }
  }

  private loadProviders() {
    if (fs.existsSync(PROVIDERS_FILE)) {
      try {
        const data = JSON.parse(fs.readFileSync(PROVIDERS_FILE, 'utf8'));
        this.providers.clear();
        if (data.providers && Array.isArray(data.providers)) {
          data.providers.forEach((p: ProviderConfig) => this.providers.set(p.id, p));
        }
      } catch (e) {
        console.error('Failed to load providers.json:', e);
      }
    }
  }

  private saveProviders() {
    this.safeWriteJson(PROVIDERS_FILE, {
      providers: Array.from(this.providers.values())
    });
  }

  private safeWriteJson(filePath: string, data: any) {
    const tempPath = `${filePath}.tmp`;
    try {
      if (!fs.existsSync(path.dirname(filePath))) {
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
      }
      fs.writeFileSync(tempPath, JSON.stringify(data, null, 2));
      fs.renameSync(tempPath, filePath);
    } catch (err) {
      console.error(`Failed to atomically write file to ${filePath}:`, err);
      if (fs.existsSync(tempPath)) {
        try { fs.unlinkSync(tempPath); } catch (e) {}
      }
    }
  }

  public setupHandlers() {
    // Discovery
    this.nc.subscribe(SUBJECTS.SERVICE.LLM.MODELS.LIST, {
      callback: (err, msg) => {
        if (err) return;
        const envelope = jc.decode(msg.data) as Envelope;
        
        const allModels: { provider: string, models: string[] }[] = [];
        for (const [id, config] of this.providers.entries()) {
          if (config.enabled) {
            allModels.push({
              provider: config.adapter,
              models: config.models.manifest || []
            });
          }
        }

        msg.respond(jc.encode({
          id: uuidv4(),
          ts: new Date().toISOString(),
          type: 'ToolResult',
          from: 'runtime',
          to: msg.reply || '',
          correlation_id: envelope.id,
          payload: { models: allModels }
        }));
      }
    });

    // Provider override
    this.nc.subscribe(SUBJECTS.SERVICE.LLM.PROVIDER.UPDATE, {
      callback: (err, msg) => {
        if (err) return;
        const envelope = jc.decode(msg.data) as Envelope;
        
        try {
          const update = envelope.payload as Partial<ProviderConfig> & { id: string };
          if (!update.id) throw new Error('Provider ID required');
          
          let existing = this.providers.get(update.id);
          if (!existing) {
            existing = {
              id: update.id,
              adapter: update.adapter || 'unknown',
              enabled: true,
              auth: { type: 'none', secret: '' },
              models: { auto_discover: false, manifest: [] },
              throttling: { max_concurrency: 5, requests_per_min: 50 }
            };
          }

          if (update.adapter) existing.adapter = update.adapter;
          if (update.enabled !== undefined) existing.enabled = update.enabled;
          if (update.auth) existing.auth = { ...existing.auth, ...update.auth };
          if (update.endpoint) existing.endpoint = update.endpoint;
          if (update.models) existing.models = { ...existing.models, ...update.models };
          if (update.throttling) existing.throttling = { ...existing.throttling, ...update.throttling };

          this.providers.set(existing.id, existing);
          this.saveProviders();

          msg.respond(jc.encode({
            id: uuidv4(),
            ts: new Date().toISOString(),
            type: 'ToolResult',
            from: 'runtime',
            to: msg.reply || '',
            correlation_id: envelope.id,
            payload: { status: 'success', provider: existing }
          }));

        } catch (e: any) {
          msg.respond(jc.encode({
            id: uuidv4(),
            ts: new Date().toISOString(),
            type: 'ToolResult',
            from: 'runtime',
            to: msg.reply || '',
            correlation_id: envelope.id,
            payload: { error: e.message }
          }));
        }
      }
    });

    // Inference placeholder
    this.nc.subscribe(SUBJECTS.SERVICE.LLM.INFERENCE, {
      callback: (err, msg) => {
        if (err) return;
        const envelope = jc.decode(msg.data) as Envelope;
        
        msg.respond(jc.encode({
          id: uuidv4(),
          ts: new Date().toISOString(),
          type: 'ToolResult',
          from: 'runtime',
          to: msg.reply || '',
          correlation_id: envelope.id,
          payload: { error: 'Not Implemented - Inference Service pending integration' }
        }));
      }
    });
  }
}
