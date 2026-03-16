import { useEffect, useRef, useState } from 'react';
import { useNats } from '../context/NatsContext';
import { StringCodec } from 'nats.ws';

export default function DynamicAgentNode({ uuid }: { uuid: string }) {
  const { connection } = useNats();
  const mountRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!uuid || !connection || !mountRef.current) return;

    let unmountFn: (() => void) | undefined;

    const loadUI = async () => {
      try {
        const module = await import(/* @vite-ignore */ `/api/workers/${uuid}/ui.js?t=${Date.now()}`);

        if (module.mount) {
          const props = {
            uuid,
            natsPublish: (topic: string, data: any) => {
              connection.publish(topic, StringCodec().encode(JSON.stringify(data)));
            },
            natsSubscribe: (topic: string, callback: (data: string) => void) => {
              const sub = connection.subscribe(topic);
              (async () => {
                for await (const msg of sub) {
                  callback(StringCodec().decode(msg.data));
                }
              })();
              return sub;
            }
          };
          // Execute the framework-agnostic mount function
          unmountFn = module.mount(mountRef.current, props);
        } else {
          setError("Module does not export a 'mount' function.");
        }
      } catch (err: any) {
        setError(err.message);
      }
    };

    loadUI();

    return () => {
      if (unmountFn) unmountFn();
    };
  }, [uuid, connection]);

  if (error) return <div className="text-red-500 p-4 font-mono text-sm">Failed to load UI: {error}</div>;

  return <div ref={mountRef} className="w-full h-full" />;
}
