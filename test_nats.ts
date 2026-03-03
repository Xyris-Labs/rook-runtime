import { connect } from 'nats';
async function run() {
  const nc = await connect({ servers: "nats://localhost:4222" });
  const js = nc.jetstream();
  console.log(js.views);
  await nc.close();
}
run();
