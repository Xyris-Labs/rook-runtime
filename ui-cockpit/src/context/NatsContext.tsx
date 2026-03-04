import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import { connect, JSONCodec } from 'nats.ws';
import type { NatsConnection, JetStreamClient } from 'nats.ws';

// Since the UI doesn't have direct access to the backend types, we redefine StatusEntry here.
export interface StatusEntry {
  status: 'online' | 'offline' | 'auth_required' | 'error';
  load: number;
  capabilities: string[];
  alerts: Array<{
    type: string;
    provider?: string;
    code?: string;
    url?: string;
    message?: string;
  }>;
  last_seen: string;
}

interface NatsContextType {
  connection: NatsConnection | null;
  js: JetStreamClient | null;
  status: 'connected' | 'disconnected' | 'connecting';
  meshStatus: Record<string, StatusEntry>;
  request: <T = any, R = any>(subject: string, payload: T) => Promise<R>;
  publish: <T = any>(subject: string, payload: T) => void;
  subscribe: (subject: string, callback: (data: any) => void) => () => void;
}

const NatsContext = createContext<NatsContextType | undefined>(undefined);

const jc = JSONCodec();

export const NatsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [connection, setConnection] = useState<NatsConnection | null>(null);
  const [jsClient, setJsClient] = useState<JetStreamClient | null>(null);
  const [status, setStatus] = useState<'connected' | 'disconnected' | 'connecting'>('disconnected');
  const [meshStatus, setMeshStatus] = useState<Record<string, StatusEntry>>({});
  
  const connectionRef = useRef<NatsConnection | null>(null);
  const kvWatchRef = useRef<any>(null);

  useEffect(() => {
    let active = true;

    async function initNats() {
      setStatus('connecting');
      try {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        // Connect directly to NATS WebSocket port
        const url = `${protocol}//${window.location.hostname}:8080`;
        
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
        
        const js = nc.jetstream();
        setJsClient(js);
        
        setStatus('connected');

        // Setup KV Watch
        try {
          const statusKv = await js.views.kv('ROOK_STATUS');
          const watcher = await statusKv.watch();
          kvWatchRef.current = watcher;
          
          (async () => {
            for await (const entry of watcher) {
              if (!active) break;
              if (entry.operation === 'DEL' || entry.operation === 'PURGE') {
                setMeshStatus(prev => {
                  const copy = { ...prev };
                  delete copy[entry.key];
                  return copy;
                });
              } else {
                try {
                  const decoded = jc.decode(entry.value) as StatusEntry;
                  setMeshStatus(prev => ({
                    ...prev,
                    [entry.key]: decoded
                  }));
                } catch (e) {
                  console.error('Failed to decode StatusEntry:', e);
                }
              }
            }
          })().catch(console.error);
        } catch (e) {
          console.error('Failed to attach to ROOK_STATUS KV:', e);
        }

        nc.closed().then(() => {
          if (active) {
            setStatus('disconnected');
            setConnection(null);
            setJsClient(null);
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
      if (kvWatchRef.current) {
        kvWatchRef.current.stop().catch(() => {});
      }
      if (connectionRef.current) {
        connectionRef.current.close().catch(() => {});
      }
    };
  }, []);

  const request = useCallback(async (subject: string, payload: any) => {
    if (!connectionRef.current) throw new Error('NATS not connected');
    const res = await connectionRef.current.request(subject, jc.encode(payload), { timeout: 10000 });
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
    <NatsContext.Provider value={{ connection, js: jsClient, status, meshStatus, request, publish, subscribe }}>
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
