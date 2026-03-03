import { connect, JSONCodec, StringCodec } from 'nats';

async function test() {
  try {
    const nc = await connect({ servers: 'nats://localhost:4222' });
    const js = nc.jetstream();
    const sc = StringCodec();
    const jc = JSONCodec();

    console.log("Checking KV ROOK_STATUS:");
    const statusKv = await js.views.kv('ROOK_STATUS');
    const statusKeys = await statusKv.keys();
    for await (const k of statusKeys) {
      const entry = await statusKv.get(k);
      if (entry) {
        console.log(`Key: ${k}, Value:`, jc.decode(entry.value));
      }
    }

    console.log("Testing Spawn...");
    const spawnRes = await nc.request('service.executor.spawn', jc.encode({
      agent_id: 'test_agent_1',
      entrypoint: 'src/agent/worker.ts' 
    }), { timeout: 2000 });
    console.log("Spawn response:", jc.decode(spawnRes.data));

    console.log("Testing List...");
    const listRes = await nc.request('service.executor.list', jc.encode({}), { timeout: 2000 });
    console.log("List response:", jc.decode(listRes.data));

    await nc.close();
  } catch (err) {
    console.error(err);
  }
}

test();
