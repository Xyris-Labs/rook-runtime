import { connect, NatsConnection, JSONCodec, StringCodec, KV } from 'nats';
import { v4 as uuidv4 } from 'uuid';
import { HandshakeRequest, HandshakeResponse, RegistryEntry } from '../types';

const jc = JSONCodec();
const sc = StringCodec();

export class Hub {
  private nc!: NatsConnection;
  private registryKv!: KV;
  private statusKv!: KV;

  async start() {
    console.log('Starting Hub...');
    const natsUrl = process.env.NATS_URL || 'nats://localhost:4222';
    
    try {
      this.nc = await connect({ servers: natsUrl });
      console.log(`Hub connected to NATS at ${natsUrl}`);

      const jsm = await this.nc.jetstreamManager();
      const js = this.nc.jetstream();

      // Ensure KV Buckets exist
      await this.ensureKVs(jsm, js);
      
      this.registryKv = await js.views.kv('ROOK_REGISTRY');
      this.statusKv = await js.views.kv('ROOK_STATUS');

      this.setupHandshakeHandler();
      console.log('Hub initialized successfully.');
    } catch (err) {
      console.error('Hub initialization failed:', err);
      process.exit(1);
    }
  }

  private async ensureKVs(jsm: any, js: any) {
    try {
      await jsm.streams.info('KV_ROOK_REGISTRY');
    } catch (err: any) {
      if (err.message === 'stream not found') {
        console.log('Creating ROOK_REGISTRY KV bucket...');
        await js.views.kv('ROOK_REGISTRY', { history: 1 });
      } else {
        throw err;
      }
    }

    try {
      await jsm.streams.info('KV_ROOK_STATUS');
    } catch (err: any) {
      if (err.message === 'stream not found') {
        console.log('Creating ROOK_STATUS KV bucket...');
        await js.views.kv('ROOK_STATUS', { history: 1, ttl: 60000 });
      } else {
        throw err;
      }
    }

    try {
      await jsm.streams.info('KV_ROOK_TOOLS');
    } catch (err: any) {
      if (err.message === 'stream not found') {
        console.log('Creating ROOK_TOOLS KV bucket...');
        await js.views.kv('ROOK_TOOLS', { history: 1 });
      } else {
        throw err;
      }
    }
  }

  private setupHandshakeHandler() {
    this.nc.subscribe('registry.handshake', {
      callback: async (err, msg) => {
        if (err) {
          console.error('Handshake error:', err);
          return;
        }

        try {
          const req = jc.decode(msg.data) as HandshakeRequest;
          const key = `${req.type}.${req.name}`;
          
          let uuid: string = '';
          
          try {
            const entry = await this.registryKv.get(key);
            if (entry) {
               uuid = sc.decode(entry.value);
               console.log(`Resumed service: ${key} -> ${uuid}`);
            }
          } catch(e) {
             // likely key not found
          }
          
          if (!uuid) {
             uuid = uuidv4();
             console.log(`Registered new service: ${key} -> ${uuid}`);
          }

          await this.registryKv.put(key, sc.encode(uuid));
          
          const res: HandshakeResponse = { uuid };
          msg.respond(jc.encode(res));

        } catch (e) {
          console.error('Failed to handle handshake:', e);
        }
      }
    });
  }
}
