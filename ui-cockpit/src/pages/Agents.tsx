import React, { useEffect, useState, useCallback } from 'react';
import { useNats } from '../context/NatsContext';
import { RefreshCcw, Power, PowerOff, Trash2, Plus, X } from 'lucide-react';

interface Agent {
  name: string;
  enabled: boolean;
  inbox: string;
  isRunning: boolean;
}

const Agents: React.FC = () => {
  const { request, status, subscribe } = useNats();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [newAgentName, setNewAgentName] = useState('');

  const fetchAgents = useCallback(async () => {
    if (status !== 'connected') return;
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
  }, [status, request]);

  useEffect(() => {
    fetchAgents();
    
    if (status === 'connected') {
      const unsub = subscribe('egress.ui.heartbeat', () => {
        // Just a hint to refresh if we want, but let's stick to manual/event based for now
        // fetchAgents(); 
      });
      return unsub;
    }
  }, [status, fetchAgents, subscribe]);

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

  const deleteAgent = async (name: string) => {
    if (!confirm(`Are you sure you want to delete agent "${name}"? This cannot be undone.`)) return;
    try {
      await request('tool.agent.delete', {
        id: crypto.randomUUID(),
        ts: new Date().toISOString(),
        type: 'ToolRequest',
        from: 'ui',
        to: 'tool.agent.delete',
        payload: { name }
      });
      await fetchAgents();
    } catch (err) {
      console.error(`Failed to delete agent:`, err);
    }
  };

  const createAgent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newAgentName) return;

    try {
      await request('tool.agent.create', {
        id: crypto.randomUUID(),
        ts: new Date().toISOString(),
        type: 'ToolRequest',
        from: 'ui',
        to: 'tool.agent.create',
        payload: {
          id: newAgentName,
          name: newAgentName,
          enabled: true,
          inbox: `agent.${newAgentName}.inbox`,
          path: `/data/system/agents/${newAgentName}`
        }
      });
      setNewAgentName('');
      setShowModal(false);
      await fetchAgents();
    } catch (err) {
      console.error(`Failed to create agent:`, err);
    }
  };

  return (
    <div className="space-y-6">
      <div className="border-b border-divider pb-4 flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-black uppercase tracking-tighter italic">Agents</h2>
          <p className="text-gray-500 text-sm">Manage multi-agent personas and processes</p>
        </div>
        <div className="flex gap-2">
          <button 
            onClick={() => setShowModal(true)}
            className="flex items-center gap-2 px-4 py-2 bg-primary text-black font-bold rounded-md hover:opacity-90 transition-opacity"
          >
            <Plus size={18} />
            ADD AGENT
          </button>
          <button 
            onClick={fetchAgents}
            className="p-2 hover:bg-active rounded-md text-primary transition-colors border border-divider"
          >
            <RefreshCcw size={18} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      <div className="bg-card border border-divider rounded-lg overflow-hidden">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-black/20 border-b border-divider">
              <th className="p-4 text-xs font-bold uppercase tracking-widest text-gray-400">Agent Name</th>
              <th className="p-4 text-xs font-bold uppercase tracking-widest text-gray-400">Process Status</th>
              <th className="p-4 text-xs font-bold uppercase tracking-widest text-gray-400">Auto-Start</th>
              <th className="p-4 text-xs font-bold uppercase tracking-widest text-gray-400 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {agents.map((agent) => (
              <tr key={agent.name} className="border-b border-divider hover:bg-white/5 transition-colors">
                <td className="p-4">
                  <div className="font-bold">{agent.name}</div>
                  <div className="text-[10px] font-mono text-gray-600 uppercase">{agent.inbox}</div>
                </td>
                <td className="p-4">
                  <div className="flex items-center gap-2">
                    <div className={`w-2 h-2 rounded-full ${agent.isRunning ? 'bg-green-500 animate-pulse' : 'bg-gray-600'}`} />
                    <span className={`text-[10px] font-bold uppercase ${agent.isRunning ? 'text-green-500' : 'text-gray-600'}`}>
                      {agent.isRunning ? 'Running' : 'Stopped'}
                    </span>
                  </div>
                </td>
                <td className="p-4">
                  <span className={`px-2 py-1 rounded text-[10px] font-bold uppercase ${
                    agent.enabled ? 'bg-blue-500/20 text-blue-400' : 'bg-gray-800 text-gray-500'
                  }`}>
                    {agent.enabled ? 'Enabled' : 'Disabled'}
                  </span>
                </td>
                <td className="p-4 text-right">
                  <div className="flex justify-end gap-1">
                    <button 
                      onClick={() => toggleAgent(agent.name, agent.enabled)}
                      className={`p-2 rounded hover:bg-active transition-colors ${
                        agent.enabled ? 'text-red-400' : 'text-green-400'
                      }`}
                      title={agent.enabled ? 'Stop (Disable)' : 'Start (Enable)'}
                    >
                      {agent.enabled ? <PowerOff size={16} /> : <Power size={16} />}
                    </button>
                    <button 
                      onClick={() => deleteAgent(agent.name)}
                      className="p-2 rounded hover:bg-active text-gray-500 hover:text-red-500 transition-colors"
                      title="Delete Agent"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {agents.length === 0 && !loading && (
              <tr>
                <td colSpan={4} className="p-12 text-center text-gray-600 italic">No agents registered. Click "ADD AGENT" to create one.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="bg-card border border-divider rounded-xl w-full max-w-md shadow-2xl">
            <div className="p-6 border-b border-divider flex justify-between items-center">
              <h3 className="text-xl font-black uppercase tracking-tighter italic">Create New Agent</h3>
              <button onClick={() => setShowModal(false)} className="text-gray-500 hover:text-white">
                <X size={20} />
              </button>
            </div>
            <form onSubmit={createAgent} className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-bold uppercase tracking-widest text-gray-400 mb-2">
                  Agent Identity Name
                </label>
                <input 
                  type="text" 
                  autoFocus
                  value={newAgentName}
                  onChange={(e) => setNewAgentName(e.target.value.toLowerCase().replace(/[^a-z0-9]/g, ''))}
                  placeholder="e.g. jerry, scout-01"
                  className="w-full bg-black/40 border border-divider rounded p-3 text-primary font-mono outline-none focus:border-primary transition-colors"
                  required
                />
                <p className="mt-2 text-[10px] text-gray-600">
                  Allowed: a-z, 0-9. No spaces or special characters.
                </p>
              </div>
              <div className="pt-4 flex gap-3">
                <button 
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="flex-1 py-3 border border-divider text-gray-400 font-bold rounded hover:bg-white/5 transition-colors"
                >
                  CANCEL
                </button>
                <button 
                  type="submit"
                  className="flex-1 py-3 bg-primary text-black font-bold rounded hover:opacity-90 transition-opacity"
                >
                  INITIALIZE
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default Agents;
