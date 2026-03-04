import React from 'react';
import { useNats } from '../context/NatsContext';
import { Server, Activity, AlertCircle, ShieldAlert } from 'lucide-react';

const System: React.FC = () => {
  const { meshStatus } = useNats();

  return (
    <div className="space-y-6">
      <div className="border-b border-divider pb-4 flex justify-between items-end">
        <div>
          <h2 className="text-2xl font-black uppercase tracking-tighter italic">System</h2>
          <p className="text-gray-500 text-sm">Service Mesh Topology & Diagnostics</p>
        </div>
        <div className="text-[10px] text-gray-600 font-mono flex items-center gap-2">
          <Activity size={10} className="text-primary animate-pulse" />
          {Object.keys(meshStatus).length} NODES ACTIVE
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {Object.entries(meshStatus).map(([uuid, entry]) => {
          let statusColor = 'text-gray-500';
          let bgColor = 'bg-gray-500/10';
          let StatusIcon = Server;

          if (entry.status === 'online') {
            statusColor = 'text-green-500';
            bgColor = 'bg-green-500/10';
            StatusIcon = Activity;
          } else if (entry.status === 'auth_required') {
            statusColor = 'text-yellow-500';
            bgColor = 'bg-yellow-500/10';
            StatusIcon = ShieldAlert;
          } else if (entry.status === 'error') {
            statusColor = 'text-red-500';
            bgColor = 'bg-red-500/10';
            StatusIcon = AlertCircle;
          }

          return (
            <div key={uuid} className="bg-card border border-divider rounded-xl overflow-hidden flex flex-col relative">
              <div className="p-6 pb-4">
                <div className="flex justify-between items-start mb-4">
                  <div className={`p-3 rounded-lg ${bgColor} ${statusColor}`}>
                    <StatusIcon size={24} />
                  </div>
                  <div className={`px-2 py-1 rounded text-[10px] font-bold uppercase ${bgColor} ${statusColor}`}>
                    {entry.status}
                  </div>
                </div>
                
                <h3 className="text-lg font-bold text-white mb-1 truncate" title={uuid}>
                  {uuid}
                </h3>
                <p className="text-xs font-mono text-gray-500">
                  Last Seen: {new Date(entry.last_seen).toLocaleTimeString()}
                </p>
              </div>

              <div className="border-t border-divider bg-black/20 p-4 space-y-3 mt-auto">
                <div>
                  <div className="text-[10px] text-gray-600 font-bold uppercase tracking-widest mb-1">Load</div>
                  <div className="w-full bg-gray-800 rounded-full h-1.5 overflow-hidden">
                    <div 
                      className={`h-full ${entry.load > 80 ? 'bg-red-500' : 'bg-primary'}`} 
                      style={{ width: `${Math.max(2, entry.load)}%` }}
                    />
                  </div>
                  <div className="text-[10px] font-mono text-right text-gray-500 mt-1">{entry.load}%</div>
                </div>

                <div>
                  <div className="text-[10px] text-gray-600 font-bold uppercase tracking-widest mb-2">Capabilities</div>
                  <div className="flex flex-wrap gap-2">
                    {entry.capabilities.length > 0 ? (
                      entry.capabilities.map((cap, i) => (
                        <span key={i} className="text-[10px] font-mono px-2 py-1 bg-white/5 border border-divider rounded text-gray-400">
                          {cap}
                        </span>
                      ))
                    ) : (
                      <span className="text-[10px] font-mono text-gray-600 italic">None advertised</span>
                    )}
                  </div>
                </div>

                {entry.alerts && entry.alerts.length > 0 && (
                  <div className="pt-2 border-t border-divider/50 mt-2">
                     <div className="text-[10px] text-yellow-500/70 font-bold uppercase tracking-widest mb-1 flex items-center gap-1">
                        <AlertCircle size={10} /> Active Alerts
                     </div>
                     {entry.alerts.map((alert, i) => (
                        <div key={i} className="text-[10px] font-mono text-yellow-400/80 truncate">
                          [{alert.type}] {alert.message || 'Check logs'}
                        </div>
                     ))}
                  </div>
                )}
              </div>
            </div>
          );
        })}

        {Object.keys(meshStatus).length === 0 && (
          <div className="col-span-full p-12 text-center border border-dashed border-divider rounded-xl">
            <Activity size={32} className="mx-auto text-gray-600 mb-4 opacity-50" />
            <p className="text-gray-500 font-mono text-sm">Waiting for JetStream KV Sync...</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default System;
