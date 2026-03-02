import React, { useEffect, useState, useCallback } from 'react';
import { useNats } from '../context/NatsContext';
import { Activity } from 'lucide-react';

interface LogEntry {
  ts: string;
  from: string;
  type: string;
  payload: any;
}

interface HeartbeatPayload {
  status: string;
  uptime: number;
  lastBoot: string;
  agentsActive: number;
}

const formatUptime = (totalSeconds: number) => {
  const d = Math.floor(totalSeconds / 86400);
  const h = Math.floor((totalSeconds % 86400) / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  
  const hStr = h.toString().padStart(2, '0');
  const mStr = m.toString().padStart(2, '0');
  const sStr = s.toString().padStart(2, '0');
  
  return d > 0 ? `${d}d ${hStr}:${mStr}:${sStr}` : `${hStr}:${mStr}:${sStr}`;
};

const Dashboard: React.FC = () => {
  const { status, request, subscribe } = useNats();
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [agentCount, setAgentCount] = useState<number>(0);
  const [scheduleCount, setScheduleCount] = useState<number>(0);
  const [uptime, setUptime] = useState<string>('00:00:00');
  const [lastHeartbeat, setLastHeartbeat] = useState<string | null>(null);
  const [isPulse, setIsPulse] = useState(false);

  const handleHeartbeat = useCallback((data: any) => {
    const payload = data.payload as HeartbeatPayload;
    setUptime(formatUptime(payload.uptime));
    setAgentCount(payload.agentsActive);
    setLastHeartbeat(new Date().toLocaleTimeString());
    
    // Flash the pulse icon
    setIsPulse(true);
    setTimeout(() => setIsPulse(false), 500);
  }, []);

  const handleLog = useCallback((data: any) => {
    setLogs(prev => [data as LogEntry, ...prev].slice(0, 100));
  }, []);

  useEffect(() => {
    if (status !== 'connected') return;

    const unsubHeartbeat = subscribe('egress.ui.heartbeat', handleHeartbeat);
    const unsubLogs = subscribe('egress.ui.*', handleLog);

    const fetchInitial = async () => {
      try {
        const schedulesRes = await request('tool.schedule.list', { 
          id: crypto.randomUUID(), 
          ts: new Date().toISOString(), 
          type: 'ToolRequest', 
          from: 'ui', 
          to: 'tool.schedule.list', 
          payload: {} 
        });
        setScheduleCount(schedulesRes.payload.length || 0);
      } catch (err) {
        console.error('Dashboard init fetch failed:', err);
      }
    };

    fetchInitial();

    return () => {
      unsubHeartbeat();
      unsubLogs();
    };
  }, [status, subscribe, request, handleHeartbeat, handleLog]);

  return (
    <div className="space-y-6">
      <div className="border-b border-divider pb-4 flex justify-between items-end">
        <div>
          <h2 className="text-2xl font-black uppercase tracking-tighter italic">Dashboard</h2>
          <p className="text-gray-500 text-sm">Real-time overview of the Rook v0 Runtime</p>
        </div>
        {lastHeartbeat && (
          <div className="text-[10px] text-gray-600 font-mono flex items-center gap-2">
            <Activity size={10} className={`${isPulse ? 'text-primary' : 'text-gray-800'} transition-colors duration-200`} />
            LAST PULSE: {lastHeartbeat}
          </div>
        )}
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
