import React from 'react';

const Dashboard: React.FC = () => {
  return (
    <div className="space-y-6">
      <div className="border-b border-divider pb-4">
        <h2 className="text-2xl font-black uppercase tracking-tighter italic">Dashboard</h2>
        <p className="text-gray-500 text-sm">Real-time overview of the Rook v0 Runtime</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-card p-6 border border-divider rounded-lg">
          <h3 className="text-gray-400 text-xs font-bold uppercase tracking-widest mb-2">Active Agents</h3>
          <p className="text-4xl font-black text-primary">0</p>
        </div>
        <div className="bg-card p-6 border border-divider rounded-lg">
          <h3 className="text-gray-400 text-xs font-bold uppercase tracking-widest mb-2">Schedules</h3>
          <p className="text-4xl font-black text-primary">0</p>
        </div>
        <div className="bg-card p-6 border border-divider rounded-lg">
          <h3 className="text-gray-400 text-xs font-bold uppercase tracking-widest mb-2">Uptime</h3>
          <p className="text-4xl font-black text-primary">--:--</p>
        </div>
      </div>

      <div className="bg-card border border-divider rounded-lg">
        <div className="p-4 border-b border-divider">
          <h3 className="text-sm font-bold uppercase tracking-widest">System Logs</h3>
        </div>
        <div className="h-64 overflow-y-auto p-4 font-mono text-xs text-green-700">
          <div className="mb-1 opacity-50">[2026-03-01 21:15:00] Initializing Cockpit...</div>
          <div className="mb-1 opacity-70">[2026-03-01 21:15:01] Connected to NATS bridge.</div>
          <div className="mb-1">[2026-03-01 21:15:02] Runtime READY.</div>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
