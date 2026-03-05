import React, { useState } from 'react';
import { useNats } from '../context/NatsContext';
import { Play, Square, Save, Download, AlertCircle } from 'lucide-react';

const Agents: React.FC = () => {
  const { request, status } = useNats();
  const [agentId, setAgentId] = useState('jerry');
  const [profileContent, setProfileContent] = useState('{\n  "model": {\n    "name": "local-model",\n    "temp": 0.7\n  },\n  "contextFiles": [\n    "persona.md"\n  ]\n}');
  const [personaContent, setPersonaContent] = useState('# Persona\n\nYou are a helpful agent.');
  const [statusMessage, setStatusMessage] = useState('');

  const showStatus = (msg: string) => {
    setStatusMessage(msg);
    setTimeout(() => setStatusMessage(''), 5000);
  };

  const handleLoad = async () => {
    if (!agentId || status !== 'connected') return;
    setStatusMessage('Loading...');
    try {
      // Load Profile
      const profileRes = await request('service.fs.read', {
        scope: 'agent',
        agent_id: agentId,
        path: 'profile.json'
      });

      if (profileRes.status === 'success' && profileRes.content) {
        setProfileContent(profileRes.content);
      } else {
        setProfileContent('{\n  "model": {\n    "name": "local-model",\n    "temp": 0.7\n  },\n  "contextFiles": [\n    "persona.md"\n  ]\n}');
        console.warn('Profile read error:', profileRes.error);
      }

      // Load Persona
      const personaRes = await request('service.fs.read', {
        scope: 'agent',
        agent_id: agentId,
        path: 'persona.md'
      });
      if (personaRes.status === 'success' && personaRes.content) {
        setPersonaContent(personaRes.content);
      } else {
        setPersonaContent('# Persona\n\nYou are a helpful agent.');
        console.warn('Persona read error:', personaRes.error);
      }
      
      showStatus('Loaded agent context.');
    } catch (err: any) {
      showStatus(`Load failed: ${err.message}`);
    }
  };

  const handleSave = async () => {
    if (!agentId || status !== 'connected') return;
    setStatusMessage('Saving...');
    try {
      // Save Profile
      const profileRes = await request('service.fs.write', {
        scope: 'agent',
        agent_id: agentId,
        path: 'profile.json',
        content: profileContent
      });
      if (profileRes.status !== 'success') throw new Error(profileRes.error || 'Failed to save profile.json');

      // Save Persona
      const personaRes = await request('service.fs.write', {
        scope: 'agent',
        agent_id: agentId,
        path: 'persona.md',
        content: personaContent
      });
      if (personaRes.status !== 'success') throw new Error(personaRes.error || 'Failed to save persona.md');

      showStatus('Saved agent context.');
    } catch (err: any) {
      showStatus(`Save failed: ${err.message}`);
    }
  };

  const handleStart = async () => {
    if (!agentId || status !== 'connected') return;
    setStatusMessage('Starting...');
    try {
      const res = await request('service.executor.spawn', {
        agent_id: agentId,
        entrypoint: 'src/agent/worker.ts'
      });
      if (res.status === 'success') {
        showStatus(`Started agent process (PID: ${res.pid})`);
      } else {
        showStatus(`Start failed: ${res.error}`);
      }
    } catch (err: any) {
      showStatus(`Start failed: ${err.message}`);
    }
  };

  const handleKill = async () => {
    if (!agentId || status !== 'connected') return;
    setStatusMessage('Killing...');
    try {
      const res = await request('service.executor.kill', {
        agent_id: agentId,
        signal: 'SIGTERM'
      });
      if (res.status === 'success') {
        showStatus('Killed agent process.');
      } else {
        showStatus(`Kill failed: ${res.error}`);
      }
    } catch (err: any) {
      showStatus(`Kill failed: ${err.message}`);
    }
  };

  return (
    <div className="space-y-6 h-full flex flex-col">
      <div className="border-b border-divider pb-4 flex justify-between items-end">
        <div>
          <h2 className="text-2xl font-black uppercase tracking-tighter italic">Command Wire</h2>
          <p className="text-gray-500 text-sm">Direct Agent Manipulation</p>
        </div>
        {statusMessage && (
          <div className="text-xs text-yellow-500 font-mono flex items-center gap-2 bg-yellow-500/10 px-3 py-1.5 rounded">
            <AlertCircle size={14} />
            {statusMessage}
          </div>
        )}
      </div>

      <div className="flex gap-4">
        <input 
          type="text" 
          value={agentId}
          onChange={(e) => setAgentId(e.target.value)}
          placeholder="Agent ID"
          className="bg-card border border-divider rounded-lg px-4 py-2 font-mono text-white outline-none focus:border-primary flex-1 max-w-xs"
        />
        
        <div className="flex gap-2">
          <button 
            onClick={handleLoad}
            className="flex items-center gap-2 px-4 py-2 bg-card border border-divider text-gray-300 font-bold rounded-lg hover:bg-white/5 transition-colors"
          >
            <Download size={16} />
            LOAD
          </button>
          <button 
            onClick={handleSave}
            className="flex items-center gap-2 px-4 py-2 bg-primary text-black font-bold rounded-lg hover:opacity-90 transition-opacity"
          >
            <Save size={16} />
            SAVE
          </button>
          <div className="w-px bg-divider mx-2"></div>
          <button 
            onClick={handleStart}
            className="flex items-center gap-2 px-4 py-2 bg-green-500/20 text-green-500 border border-green-500/20 font-bold rounded-lg hover:bg-green-500/30 transition-colors"
          >
            <Play size={16} />
            START AGENT
          </button>
          <button 
            onClick={handleKill}
            className="flex items-center gap-2 px-4 py-2 bg-red-500/20 text-red-500 border border-red-500/20 font-bold rounded-lg hover:bg-red-500/30 transition-colors"
          >
            <Square size={16} />
            KILL AGENT
          </button>
        </div>
      </div>

      <div className="flex gap-6 flex-1 min-h-0">
        <div className="flex-1 flex flex-col gap-2">
          <label className="text-xs font-bold uppercase tracking-widest text-gray-500">profile.json</label>
          <textarea 
            value={profileContent}
            onChange={(e) => setProfileContent(e.target.value)}
            className="flex-1 bg-card border border-divider rounded-lg p-4 font-mono text-sm text-gray-300 outline-none focus:border-primary resize-none"
            spellCheck={false}
          />
        </div>
        <div className="flex-[2] flex flex-col gap-2">
          <label className="text-xs font-bold uppercase tracking-widest text-gray-500">persona.md</label>
          <textarea 
            value={personaContent}
            onChange={(e) => setPersonaContent(e.target.value)}
            className="flex-1 bg-card border border-divider rounded-lg p-4 font-mono text-sm text-gray-300 outline-none focus:border-primary resize-none"
            spellCheck={false}
          />
        </div>
      </div>
    </div>
  );
};

export default Agents;
