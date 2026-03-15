import { useEffect, useState } from 'react';
import { useNats } from '../context/NatsContext';
import { StringCodec } from 'nats.ws';

export default function DynamicAgentNode({ uuid }: { uuid: string }) {
  const { connection } = useNats();
  const [Component, setComponent] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!uuid) return;
    const loadUI = async () => {
      try {
        const module = await import(/* @vite-ignore */ `/api/workers/${uuid}/ui.js?t=${Date.now()}`);
        setComponent(() => module.default || module.mount);
      } catch (err: any) {
        setError(err.message);
      }
    };
    loadUI();
  }, [uuid]);

  if (error) return <div className="text-red-500">Failed to load UI: {error}</div>;
  if (!Component) return <div className="text-gray-400">Loading UI for worker.{uuid}...</div>;

  return (
    <Component
      uuid={uuid}
      natsPublish={(topic: string, data: any) => {
        if (!connection) return;
        connection.publish(topic, StringCodec().encode(JSON.stringify(data)));
      }}
    />
  );
}
