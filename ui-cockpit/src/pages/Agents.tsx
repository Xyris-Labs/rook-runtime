import React, { useEffect, useState, useCallback } from 'react';
import { useNats } from '../context/NatsContext';
import { RefreshCcw, Power, PowerOff, Trash2, Plus, X, Brain, Save, FilePlus, Loader2 } from 'lucide-react';

interface Agent {
  name: string;
  enabled: boolean;
  inbox: string;
  isRunning: boolean;
  path: string;
  model: {
    provider: string;
    name: string;
    temp: number;
  };
  contextFiles: string[];
}

const Agents: React.FC = () => {
  const { request, status } = useNats();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newAgentName, setNewAgentName] = useState('');
  
  // Mind Panel State
  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null);
  const [mindFiles, setMindFiles] = useState<{ [path: string]: string }>({});
  const [mindTab, setMindTab] = useState<'config' | string>('config');
  const [editingModel, setEditingModel] = useState<Agent['model'] | null>(null);
  const [editingContextFiles, setEditingContextFiles] = useState<string[]>([]);
  const [newFilePath, setNewFilePath] = useState('');
  const [savingMind, setSavingMind] = useState(false);

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
  }, [status, fetchAgents]);

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
          path: `/data/system/agents/${newAgentName}`,
          model: { provider: 'openai', name: 'gpt-4o', temp: 0.7 },
          contextFiles: []
        }
      });
      setNewAgentName('');
      setShowCreateModal(false);
      await fetchAgents();
    } catch (err) {
      console.error(`Failed to create agent:`, err);
    }
  };

  const openMindPanel = async (agent: Agent) => {
    setSelectedAgent(agent);
    setEditingModel(agent.model);
    setEditingContextFiles(agent.contextFiles);
    setMindTab('config');
    setMindFiles({});
    
    try {
      const res = await request('tool.agent.mind.read', {
        id: crypto.randomUUID(),
        ts: new Date().toISOString(),
        type: 'ToolRequest',
        from: 'ui',
        to: 'tool.agent.mind.read',
        payload: { name: agent.name }
      });
      if (res.payload && res.payload.files) {
        setMindFiles(res.payload.files);
      }
    } catch (err) {
      console.error('Failed to read agent mind:', err);
    }
  };

  const saveMind = async () => {
    if (!selectedAgent || !editingModel) return;

    setSavingMind(true);
    try {
      const res = await request('tool.agent.mind.write', {
        id: crypto.randomUUID(),
        ts: new Date().toISOString(),
        type: 'ToolRequest',
        from: 'ui',
        to: 'tool.agent.mind.write',
        payload: {
          name: selectedAgent.name,
          files: mindFiles,
          model: editingModel,
          contextFiles: editingContextFiles
        }
      });
      
      if (res.payload && res.payload.error) {
        throw new Error(res.payload.error);
      }

      // Success
      alert('Mind Saved & Restarted');
      await fetchAgents();
      // Update selected agent reference to latest
      const updated = agents.find(a => a.name === selectedAgent.name);
      if (updated) setSelectedAgent(updated);
    } catch (err: any) {
      console.error('Failed to write agent mind:', err);
      alert(`Save Error: ${err.message}`);
    } finally {
      setSavingMind(false);
    }
  };

  const addContextFile = () => {
    const path = newFilePath.trim();
    if (!path) return;
    if (editingContextFiles.includes(path)) {
      setMindTab(path);
      setNewFilePath('');
      return;
    }
    
    setEditingContextFiles([...editingContextFiles, path]);
    setMindFiles({ ...mindFiles, [path]: '' });
    setMindTab(path);
    setNewFilePath('');
  };

  return (
    <div className="space-y-6 h-full flex flex-col">
      {!selectedAgent ? (
        <>
          <div className="border-b border-divider pb-4 flex justify-between items-center">
            <div>
              <h2 className="text-2xl font-black uppercase tracking-tighter italic">Agents</h2>
              <p className="text-gray-500 text-sm">Manage multi-agent personas and processes</p>
            </div>
            <div className="flex gap-2">
              <button 
                onClick={() => setShowCreateModal(true)}
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
                  <tr 
                    key={agent.name} 
                    className="border-b border-divider hover:bg-white/5 transition-colors cursor-pointer group"
                    onClick={() => openMindPanel(agent)}
                  >
                    <td className="p-4">
                      <div className="font-bold flex items-center gap-2">
                        <Brain size={14} className="text-gray-500 group-hover:text-primary" />
                        {agent.name}
                      </div>
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
                    <td className="p-4 text-right" onClick={(e) => e.stopPropagation()}>
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
        </>
      ) : (
        <div className="flex-1 flex flex-col min-h-0 bg-card border border-divider rounded-lg">
          <div className="p-4 border-b border-divider flex justify-between items-center bg-black/20">
            <div className="flex items-center gap-4">
              <button 
                onClick={() => setSelectedAgent(null)}
                className="text-gray-500 hover:text-white"
              >
                <X size={20} />
              </button>
              <div>
                <h3 className="text-lg font-black uppercase tracking-tighter italic">
                  MIND: {selectedAgent.name}
                </h3>
                <p className="text-[10px] text-gray-500 font-mono">{selectedAgent.path}</p>
              </div>
            </div>
            <button 
              onClick={saveMind}
              disabled={savingMind}
              className="flex items-center gap-2 px-4 py-2 bg-primary text-black font-bold rounded hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {savingMind ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
              {savingMind ? 'SAVING...' : 'SAVE & RESTART'}
            </button>
          </div>

          <div className="flex-1 flex min-h-0">
            {/* Sidebar Tabs */}
            <div className="w-48 border-r border-divider bg-black/10 flex flex-col">
              <button 
                onClick={() => setMindTab('config')}
                className={`p-3 text-left text-xs font-bold uppercase tracking-widest border-b border-divider transition-colors ${
                  mindTab === 'config' ? 'bg-active text-primary' : 'text-gray-500 hover:bg-white/5'
                }`}
              >
                Configuration
              </button>
              <div className="p-2 text-[10px] font-bold text-gray-600 uppercase tracking-widest mt-2 px-3 flex justify-between items-center">
                <span>Context Layers</span>
              </div>
              <div className="flex-1 overflow-y-auto">
                {editingContextFiles.map(file => (
                  <button 
                    key={file}
                    onClick={() => setMindTab(file)}
                    className={`w-full p-3 text-left text-[10px] font-mono border-b border-divider transition-colors truncate ${
                      mindTab === file ? 'bg-active text-primary' : 'text-gray-400 hover:bg-white/5'
                    }`}
                  >
                    {file}
                  </button>
                ))}
              </div>
              <div className="p-2 border-t border-divider">
                <div className="flex gap-1">
                  <input 
                    type="text" 
                    placeholder="path/to/file.md"
                    value={newFilePath}
                    onChange={(e) => setNewFilePath(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && addContextFile()}
                    className="flex-1 bg-black/40 border border-divider rounded p-1 text-[10px] text-primary outline-none"
                  />
                  <button 
                    onClick={addContextFile}
                    className="p-1 bg-primary text-black rounded hover:opacity-90"
                    title="Add Context Layer"
                  >
                    <FilePlus size={14} />
                  </button>
                </div>
              </div>
            </div>

            {/* Editor Area */}
            <div className="flex-1 flex flex-col min-w-0 bg-black/20">
              {mindTab === 'config' ? (
                <div className="p-6 space-y-6">
                  <div className="grid grid-cols-2 gap-6">
                    <div className="space-y-4">
                      <h4 className="text-xs font-bold uppercase tracking-widest text-gray-500">Model Engine</h4>
                      <div className="space-y-2">
                        <label className="block text-[10px] text-gray-600 uppercase">Provider</label>
                        <select 
                          value={editingModel?.provider}
                          onChange={(e) => setEditingModel({ ...editingModel!, provider: e.target.value })}
                          className="w-full bg-black/40 border border-divider rounded p-2 text-sm text-white outline-none"
                        >
                          <option value="openai">OpenAI</option>
                          <option value="anthropic">Anthropic</option>
                          <option value="groq">Groq</option>
                          <option value="ollama">Ollama (Local)</option>
                        </select>
                      </div>
                      <div className="space-y-2">
                        <label className="block text-[10px] text-gray-600 uppercase">Model Name</label>
                        <input 
                          type="text" 
                          value={editingModel?.name}
                          onChange={(e) => setEditingModel({ ...editingModel!, name: e.target.value })}
                          className="w-full bg-black/40 border border-divider rounded p-2 text-sm text-white font-mono outline-none"
                        />
                      </div>
                    </div>
                    <div className="space-y-4">
                      <h4 className="text-xs font-bold uppercase tracking-widest text-gray-500">Parameters</h4>
                      <div className="space-y-2">
                        <label className="block text-[10px] text-gray-600 uppercase">Temperature ({editingModel?.temp})</label>
                        <input 
                          type="range" 
                          min="0" max="2" step="0.1"
                          value={editingModel?.temp}
                          onChange={(e) => setEditingModel({ ...editingModel!, temp: parseFloat(e.target.value) })}
                          className="w-full accent-primary"
                        />
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <textarea 
                  value={mindFiles[mindTab] || ''}
                  onChange={(e) => setMindFiles({ ...mindFiles, [mindTab]: e.target.value })}
                  className="flex-1 w-full bg-transparent p-6 font-mono text-sm text-white outline-none resize-none leading-relaxed"
                  placeholder={`# Edit ${mindTab}...`}
                />
              )}
            </div>
          </div>
        </div>
      )}

      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="bg-card border border-divider rounded-xl w-full max-w-md shadow-2xl">
            <div className="p-6 border-b border-divider flex justify-between items-center">
              <h3 className="text-xl font-black uppercase tracking-tighter italic">Create New Agent</h3>
              <button onClick={() => setShowCreateModal(false)} className="text-gray-500 hover:text-white">
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
                  onClick={() => setShowCreateModal(false)}
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
