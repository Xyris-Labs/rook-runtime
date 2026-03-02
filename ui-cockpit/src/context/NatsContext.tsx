import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import { connect, JSONCodec } from 'nats.ws';
import type { NatsConnection } from 'nats.ws';

interface NatsContextType {
  connection: NatsConnection | null;
  status: 'connected' | 'disconnected' | 'connecting';
  request: <T = any, R = any>(subject: string, payload: T) => Promise<R>;
  publish: <T = any>(subject: string, payload: T) => void;
  subscribe: (subject: string, callback: (data: any) => void) => () => void;
}

const NatsContext = createContext<NatsContextType | undefined>(undefined);

const jc = JSONCodec();

export const NatsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [connection, setConnection] = useState<NatsConnection | null>(null);
  const [status, setStatus] = useState<'connected' | 'disconnected' | 'connecting'>('disconnected');
  const connectionRef = useRef<NatsConnection | null>(null);

  useEffect(() => {
    let active = true;

    async function initNats() {
      setStatus('connecting');
      try {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const url = `${protocol}//${window.location.host}/_/nats`;
        
        console.log(`Connecting to NATS at ${url}`);
        const nc = await connect({
          servers: [url],
          reconnect: true,
          waitOnFirstConnect: true,
        });

        if (!active) {
          await nc.close();
          return;
        }

        connectionRef.current = nc;
        setConnection(nc);
        setStatus('connected');

        nc.closed().then(() => {
          if (active) {
            setStatus('disconnected');
            setConnection(null);
            connectionRef.current = null;
          }
        });

      } catch (err) {
        console.error('NATS Connection Error:', err);
        if (active) {
          setStatus('disconnected');
        }
      }
    }

    initNats();

    return () => {
      active = false;
      if (connectionRef.current) {
        connectionRef.current.close();
      }
    };
  }, []);

  const request = useCallback(async (subject: string, payload: any) => {
    if (!connectionRef.current) throw new Error('NATS not connected');
    const res = await connectionRef.current.request(subject, jc.encode(payload));
    return jc.decode(res.data) as any;
  }, []);

  const publish = useCallback((subject: string, payload: any) => {
    if (!connectionRef.current) throw new Error('NATS not connected');
    connectionRef.current.publish(subject, jc.encode(payload));
  }, []);

  const subscribe = useCallback((subject: string, callback: (data: any) => void) => {
    if (!connectionRef.current) {
      console.warn('Attempted to subscribe before NATS was connected');
      return () => {};
    }

    const sub = connectionRef.current.subscribe(subject);
    let active = true;

    (async () => {
      for await (const msg of sub) {
        if (!active) break;
        try {
          const data = jc.decode(msg.data);
          callback(data);
        } catch (err) {
          console.error(`Error decoding NATS message from ${subject}:`, err);
        }
      }
    })();

    return () => {
      active = false;
      sub.unsubscribe();
    };
  }, []);

  return (
    <NatsContext.Provider value={{ connection, status, request, publish, subscribe }}>
      {children}
    </NatsContext.Provider>
  );
};

export const useNats = () => {
  const context = useContext(NatsContext);
  if (context === undefined) {
    throw new Error('useNats must be used within a NatsProvider');
  }
  return context;
};
