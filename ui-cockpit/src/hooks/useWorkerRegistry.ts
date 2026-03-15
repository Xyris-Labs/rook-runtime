import { useEffect, useState } from 'react';
import { useNats } from '../context/NatsContext';
import { StringCodec } from 'nats.ws';

export interface WorkerNode {
  key: string;
  uuid: string;
}

export function useWorkerRegistry() {
  const { connection } = useNats();
  const [workers, setWorkers] = useState<WorkerNode[]>([]);

  useEffect(() => {
    if (!connection) return;
    let watch: any;
    const sc = StringCodec();

    const initWatch = async () => {
      try {
        const js = connection.jetstream();
        const kv = await js.views.kv('ROOK_REGISTRY');
        watch = await kv.watch();

        for await (const entry of watch) {
          if (entry.operation === 'DEL' || entry.operation === 'PURGE') {
            setWorkers((prev) => prev.filter((w) => w.key !== entry.key));
          } else {
            const uuid = sc.decode(entry.value);
            setWorkers((prev) => {
              const exists = prev.find((w) => w.key === entry.key);
              if (exists) return prev.map((w) => (w.key === entry.key ? { key: entry.key, uuid } : w));
              return [...prev, { key: entry.key, uuid }];
            });
          }
        }
      } catch (err) {
        console.error('KV Watch Error:', err);
      }
    };

    initWatch();
    return () => {
      if (watch) watch.stop();
    };
  }, [connection]);

  return workers;
}
