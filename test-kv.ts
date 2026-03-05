import { connect, JSONCodec, StringCodec } from 'nats';
async function run() {
  const nc = await connect({ servers: 'nats://localhost:4222' });
  const js = nc.jetstream();
  const sc = StringCodec();
  const jc = JSONCodec();

  const regKv = await js.views.kv('ROOK_REGISTRY');
  const rKeys = await regKv.keys();
  for await (const k of rKeys) {
    const e = await regKv.get(k);
    console.log(k, sc.decode(e!.value));
  }

  const statKv = await js.views.kv('ROOK_STATUS');
  const sKeys = await statKv.keys();
  for await (const k of sKeys) {
    const e = await statKv.get(k);
    console.log(k, jc.decode(e!.value));
  }
  await nc.close();
}
run();
