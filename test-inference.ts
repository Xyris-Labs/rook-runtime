import { connect, JSONCodec } from 'nats';
import { InferenceRequest } from './src/types';

async function runTest() {
  const nc = await connect({ servers: 'nats://localhost:4222' });
  const jc = JSONCodec();

  console.log("Sending inference request to broker...");
  const req: InferenceRequest = {
    model: 'local-model',
    temperature: 0.7,
    messages: [
      { role: 'user', content: 'Hello local LLM!' }
    ]
  };
  
  try {
    const res = await nc.request('service.llm.inference', jc.encode(req), { timeout: 2000 });
    console.log("Response:", jc.decode(res.data));
  } catch (e) {
    console.error(e);
  }
  
  await nc.close();
}

runTest().catch(console.error);
