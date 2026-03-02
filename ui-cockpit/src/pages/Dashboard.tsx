import React, { useEffect, useState } from 'react';
import { useNats } from '../context/NatsContext';
import { JSONCodec } from 'nats.ws';

const jc = JSONCodec();

interface LogEntry {
  ts: string;
  from: string;
  type: string;
  payload: any;
}

const Dashboard: React.FC = () => {
  const { connection, status, request } = useNats();
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [agentCount, setAgentCount] = useState<number>(0);
  const [scheduleCount, setScheduleCount] = useState<number>(0);
  const [uptime, setUptime] = useState<string>('00:00:00');
  const [startTime] = useState<number>(Date.now());

  useEffect(() => {
    if (!connection) return;

    // Subscribe to all egress.ui messages
    const sub = connection.subscribe('egress.ui.*');
    (async () => {
      for await (const msg of sub) {
        const entry = jc.decode(msg.data) as LogEntry;
        setLogs(prev => [entry, ...prev].slice(0, 100));
      }
    })();

    // Initial counts
    const fetchCounts = async () => {
      try {
        const agentsRes = await request('tool.agent.list', { id: 'dash-init', ts: new Date().toISOString(), type: 'ToolRequest', from: 'ui', to: 'tool.agent.list', payload: {} });
        setAgentCount(agentsRes.payload.length || 0);

        const schedulesRes = await request('tool.schedule.list', { id: 'dash-init', ts: new Date().toISOString(), type: 'ToolRequest', from: 'ui', to: 'tool.schedule.list', payload: {} });
        setScheduleCount(schedulesRes.payload.length || 0);
      } catch (err) {
        console.error('Failed to fetch initial dashboard data:', err);
      }
    };

    fetchCounts();

    return () => {
      sub.unsubscribe();
    };
  }, [connection, request]);

  useEffect(() => {
    if (status !== 'connected') return;

    const interval = setInterval(() => {
      const seconds = Math.floor((Date.now() - startTime) / 1000);
      const h = Math.floor(seconds / 3600).toString().padStart(2, '0');
      const m = Math.floor((seconds % 3600) / 60).toString().padStart(2, '0');
      const s = (seconds % 60).toString().padStart(2, '0');
      setUptime(`${h}:${m}:${s}`);
    }, 1000);

    return () => clearInterval(interval);
  }, [status, startTime]);

  return (
    <div className="space-y-6">
      <div className="border-b border-divider pb-4">
        <h2 className="text-2xl font-black uppercase tracking-tighter italic">Dashboard</h2>
        <p className="text-gray-500 text-sm">Real-time overview of the Rook v0 Runtime</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-card p-6 border border-divider rounded-lg">
          <h3 className="text-gray-400 text-xs font-bold uppercase tracking-widest mb-2">Active Agents</h3>
          <p className="text-4xl font-black text-primary">{agentCount}</p>
        </div>
        <div className="bg-card p-6 border border-divider rounded-lg">
          <h3 className="text-gray-400 text-xs font-bold uppercase tracking-widest mb-2">Schedules</h3>
          <p className="text-4xl font-black text-primary">{scheduleCount}</p>
        </div>
        <div className="bg-card p-6 border border-divider rounded-lg">
          <h3 className="text-gray-400 text-xs font-bold uppercase tracking-widest mb-2">Uptime</h3>
          <p className="text-4xl font-black text-primary">{uptime}</p>
        </div>
      </div>

      <div className="bg-card border border-divider rounded-lg flex flex-col h-[500px]">
        <div className="p-4 border-b border-divider">
          <h3 className="text-sm font-bold uppercase tracking-widest">System Logs</h3>
        </div>
        <div className="flex-1 overflow-y-auto p-4 font-mono text-xs text-green-700 bg-black/20">
          {logs.length === 0 && <div className="text-gray-600 italic">Waiting for logs...</div>}
          {logs.map((log, i) => (
            <div key={i} className="mb-1">
              <span className="opacity-50 mr-2">[{new Date(log.ts).toLocaleTimeString()}]</span>
              <span className="text-blue-500 mr-2 uppercase">{log.from}</span>
              <span className="text-white">{typeof log.payload === 'object' ? JSON.stringify(log.payload) : log.payload}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
