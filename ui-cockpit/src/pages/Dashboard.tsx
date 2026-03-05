import React from 'react';
import { useNats } from '../context/NatsContext';
import { Activity, Server, ShieldCheck, AlertCircle } from 'lucide-react';

const Dashboard: React.FC = () => {
  const { meshStatus, status } = useNats();

  const activeNodes = Object.keys(meshStatus).length;
  const totalLoad = Object.values(meshStatus).reduce((acc, entry) => acc + (entry.load || 0), 0);
  const errors = Object.values(meshStatus).filter(e => e.status === 'error').length;
  const auths = Object.values(meshStatus).filter(e => e.status === 'auth_required').length;

  return (
    <div className="space-y-6">
      <div className="border-b border-divider pb-4">
        <h2 className="text-2xl font-black uppercase tracking-tighter italic">Dashboard</h2>
        <p className="text-gray-500 text-sm">Global Mesh Telemetry</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <div className="bg-card p-6 border border-divider rounded-xl">
          <div className="flex justify-between items-start mb-4">
            <div className="p-3 bg-blue-500/10 text-blue-500 rounded-lg">
              <Server size={24} />
            </div>
          </div>
          <h3 className="text-3xl font-black text-white mb-1">{activeNodes}</h3>
          <p className="text-xs font-mono text-gray-500 uppercase tracking-widest">Active Nodes</p>
        </div>

        <div className="bg-card p-6 border border-divider rounded-xl">
          <div className="flex justify-between items-start mb-4">
            <div className="p-3 bg-purple-500/10 text-purple-500 rounded-lg">
              <Activity size={24} />
            </div>
          </div>
          <h3 className="text-3xl font-black text-white mb-1">{totalLoad}%</h3>
          <p className="text-xs font-mono text-gray-500 uppercase tracking-widest">Mesh Load</p>
        </div>

        <div className="bg-card p-6 border border-divider rounded-xl">
          <div className="flex justify-between items-start mb-4">
            <div className={`p-3 rounded-lg ${errors > 0 ? 'bg-red-500/10 text-red-500' : 'bg-green-500/10 text-green-500'}`}>
              {errors > 0 ? <AlertCircle size={24} /> : <ShieldCheck size={24} />}
            </div>
          </div>
          <h3 className="text-3xl font-black text-white mb-1">{errors}</h3>
          <p className="text-xs font-mono text-gray-500 uppercase tracking-widest">Errors</p>
        </div>

        <div className="bg-card p-6 border border-divider rounded-xl">
          <div className="flex justify-between items-start mb-4">
            <div className={`p-3 rounded-lg ${status === 'connected' ? 'bg-green-500/10 text-green-500' : 'bg-yellow-500/10 text-yellow-500'}`}>
              <Activity size={24} />
            </div>
          </div>
          <h3 className="text-xl font-black text-white mb-1 uppercase">{status}</h3>
          <p className="text-xs font-mono text-gray-500 uppercase tracking-widest">NATS Uplink</p>
        </div>
      </div>
      
      {auths > 0 && (
        <div className="bg-yellow-500/10 border border-yellow-500/50 p-6 rounded-xl flex items-center gap-4">
           <AlertCircle className="text-yellow-500" size={32} />
           <div>
             <h4 className="text-yellow-500 font-bold uppercase tracking-widest">Pending Authorizations</h4>
             <p className="text-yellow-500/70 text-sm">One or more nodes requires interactive authentication. Please complete the modal overlays.</p>
           </div>
        </div>
      )}
    </div>
  );
};

export default Dashboard;