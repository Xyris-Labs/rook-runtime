import React, { useEffect, useState } from 'react';
import { useNats } from '../context/NatsContext';
import { RefreshCcw, Power, PowerOff } from 'lucide-react';

interface Agent {
  name: string;
  enabled: boolean;
  inbox: string;
}

const Agents: React.FC = () => {
  const { request } = useNats();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchAgents = async () => {
    try {
      setLoading(true);
      const res = await request('tool.agent.list', {
        id: crypto.randomUUID(),
        ts: new Date().toISOString(),
        type: 'ToolRequest',
        from: 'ui',
        to: 'tool.agent.list',
        payload: {}
      });
      setAgents(res.payload);
    } catch (err) {
      console.error('Failed to fetch agents:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAgents();
  }, []);

  const toggleAgent = async (name: string, currentEnabled: boolean) => {
    const subject = currentEnabled ? 'tool.agent.disable' : 'tool.agent.enable';
    try {
      await request(subject, {
        id: crypto.randomUUID(),
        ts: new Date().toISOString(),
        type: 'ToolRequest',
        from: 'ui',
        to: subject,
        payload: { name }
      });
      await fetchAgents();
    } catch (err) {
      console.error(`Failed to ${currentEnabled ? 'disable' : 'enable'} agent:`, err);
    }
  };

  return (
    <div className="space-y-6">
      <div className="border-b border-divider pb-4 flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-black uppercase tracking-tighter italic">Agents</h2>
          <p className="text-gray-500 text-sm">Manage multi-agent personas and processes</p>
        </div>
        <button 
          onClick={fetchAgents}
          className="p-2 hover:bg-active rounded-full text-primary transition-colors"
        >
          <RefreshCcw size={20} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      <div className="bg-card border border-divider rounded-lg overflow-hidden">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-black/20 border-b border-divider">
              <th className="p-4 text-xs font-bold uppercase tracking-widest text-gray-400">Agent Name</th>
              <th className="p-4 text-xs font-bold uppercase tracking-widest text-gray-400">Inbox</th>
              <th className="p-4 text-xs font-bold uppercase tracking-widest text-gray-400">Status</th>
              <th className="p-4 text-xs font-bold uppercase tracking-widest text-gray-400 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {agents.map((agent) => (
              <tr key={agent.name} className="border-b border-divider hover:bg-white/5 transition-colors">
                <td className="p-4 font-bold">{agent.name}</td>
                <td className="p-4 font-mono text-xs text-gray-500">{agent.inbox}</td>
                <td className="p-4">
                  <span className={`px-2 py-1 rounded text-[10px] font-bold uppercase ${
                    agent.enabled ? 'bg-green-500/20 text-green-500' : 'bg-red-500/20 text-red-500'
                  }`}>
                    {agent.enabled ? 'Enabled' : 'Disabled'}
                  </span>
                </td>
                <td className="p-4 text-right">
                  <button 
                    onClick={() => toggleAgent(agent.name, agent.enabled)}
                    className={`p-2 rounded transition-colors ${
                      agent.enabled ? 'hover:bg-red-500/20 text-red-500' : 'hover:bg-green-500/20 text-green-500'
                    }`}
                    title={agent.enabled ? 'Disable Agent' : 'Enable Agent'}
                  >
                    {agent.enabled ? <PowerOff size={18} /> : <Power size={18} />}
                  </button>
                </td>
              </tr>
            ))}
            {agents.length === 0 && !loading && (
              <tr>
                <td colSpan={4} className="p-12 text-center text-gray-600">No agents found.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default Agents;
