import { connect, JSONCodec, StringCodec } from 'nats';

async function test() {
  const nc = await connect({ servers: 'nats://localhost:4222' });
  const js = nc.jetstream();

  const registryKv = await js.views.kv('ROOK_REGISTRY');
  const regKeys = await registryKv.keys();
  console.log("--- REGISTRY KEYS ---");
  for await (const k of regKeys) {
    console.log(k);
  }

  const statusKv = await js.views.kv('ROOK_STATUS');
  const statusKeys = await statusKv.keys();
  console.log("--- STATUS KEYS ---");
  for await (const k of statusKeys) {
    console.log(k);
  }

  await nc.close();
}
test().catch(console.error);