import React, { useEffect, useState, useCallback } from 'react';
import { useNats } from '../context/NatsContext';
import { Save, Plus, Trash2, RefreshCcw, AlertCircle } from 'lucide-react';

interface ScheduleEntry {
  agent_id: string;
  type: 'interval' | 'cron';
  value: string | number;
  enabled: boolean;
  label?: string;
}

const Schedules: React.FC = () => {
  const { request, status } = useNats();
  const [schedules, setSchedules] = useState<ScheduleEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [statusMessage, setStatusMessage] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const showStatus = (msg: string) => {
    setStatusMessage(msg);
    setTimeout(() => setStatusMessage(''), 5000);
  };

  const fetchSchedules = useCallback(async () => {
    if (status !== 'connected') return;
    setIsLoading(true);
    try {
      const res = await request('service.fs.read', {
        scope: 'system',
        path: 'schedules.json'
      });
      
      if (res.status === 'success' && res.content) {
        try {
          const parsed = JSON.parse(res.content);
          setSchedules(Array.isArray(parsed) ? parsed : []);
        } catch (e) {
          console.error('Failed to parse schedules.json', e);
          setSchedules([]);
        }
      } else {
        // File not found or error
        setSchedules([]);
      }
    } catch (err: any) {
      console.error('Failed to fetch schedules:', err);
      showStatus(`Load failed: ${err.message}`);
    } finally {
      setIsLoading(false);
    }
  }, [status, request]);

  useEffect(() => {
    fetchSchedules();
  }, [fetchSchedules]);

  const saveSchedules = async () => {
    if (status !== 'connected') return;
    setIsSaving(true);
    setStatusMessage('Saving...');
    
    // Coerce values
    const processedSchedules = schedules.map(s => ({
      ...s,
      value: s.type === 'interval' ? Number(s.value) : String(s.value)
    }));

    try {
      const res = await request('service.fs.write', {
        scope: 'system',
        path: 'schedules.json',
        content: JSON.stringify(processedSchedules, null, 2)
      });
      
      if (res.status === 'success') {
        showStatus('Schedules saved successfully. Tempo Server will reload within 60s.');
        setSchedules(processedSchedules); // Update local state with coerced values
      } else {
        throw new Error(res.error || 'Unknown error');
      }
    } catch (err: any) {
      showStatus(`Save failed: ${err.message}`);
    } finally {
      setIsSaving(false);
    }
  };

  const addSchedule = () => {
    setSchedules([
      ...schedules,
      { agent_id: 'new_agent', type: 'interval', value: 60, enabled: false }
    ]);
  };

  const removeSchedule = (index: number) => {
    setSchedules(schedules.filter((_, i) => i !== index));
  };

  const updateSchedule = (index: number, field: keyof ScheduleEntry, value: any) => {
    const updated = [...schedules];
    
    if (field === 'type') {
      // Provide sane defaults when switching types
      updated[index] = { 
        ...updated[index], 
        type: value as 'interval' | 'cron',
        value: value === 'interval' ? 60 : '0 * * * *'
      };
    } else {
      updated[index] = { ...updated[index], [field]: value };
    }
    
    setSchedules(updated);
  };

  return (
    <div className="space-y-6 h-full flex flex-col">
      <div className="border-b border-divider pb-4 flex justify-between items-end">
        <div>
          <h2 className="text-2xl font-black uppercase tracking-tighter italic">Schedules</h2>
          <p className="text-gray-500 text-sm">Tempo Server trigger configuration</p>
        </div>
        <div className="flex items-center gap-4">
          {statusMessage && (
            <div className="text-xs text-yellow-500 font-mono flex items-center gap-2 bg-yellow-500/10 px-3 py-1.5 rounded">
              <AlertCircle size={14} />
              {statusMessage}
            </div>
          )}
          <button 
            onClick={fetchSchedules}
            disabled={isLoading || isSaving}
            className="p-2 hover:bg-active rounded-md text-primary transition-colors border border-divider disabled:opacity-50"
            title="Reload from disk"
          >
            <RefreshCcw size={18} className={isLoading ? 'animate-spin' : ''} />
          </button>
          <button 
            onClick={saveSchedules}
            disabled={isLoading || isSaving}
            className="flex items-center gap-2 px-4 py-2 bg-primary text-black font-bold rounded hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            <Save size={16} />
            {isSaving ? 'SAVING...' : 'SAVE CHANGES'}
          </button>
        </div>
      </div>

      <div className="bg-card border border-divider rounded-lg overflow-hidden flex-1 flex flex-col">
        <div className="flex-1 overflow-y-auto">
          <table className="w-full text-left border-collapse">
            <thead className="sticky top-0 bg-black/80 backdrop-blur-md z-10">
              <tr className="border-b border-divider">
                <th className="p-4 text-xs font-bold uppercase tracking-widest text-gray-400">Agent ID</th>
                <th className="p-4 text-xs font-bold uppercase tracking-widest text-gray-400 w-32">Type</th>
                <th className="p-4 text-xs font-bold uppercase tracking-widest text-gray-400">Value (Sec / Cron)</th>
                <th className="p-4 text-xs font-bold uppercase tracking-widest text-gray-400 w-24 text-center">Status</th>
                <th className="p-4 text-xs font-bold uppercase tracking-widest text-gray-400 w-16 text-center">Delete</th>
              </tr>
            </thead>
            <tbody>
              {schedules.map((schedule, i) => (
                <tr key={i} className="border-b border-divider hover:bg-white/5 transition-colors">
                  <td className="p-4">
                    <input 
                      type="text" 
                      value={schedule.agent_id}
                      onChange={(e) => updateSchedule(i, 'agent_id', e.target.value)}
                      className="w-full bg-black/40 border border-divider rounded px-3 py-1.5 text-sm text-white font-mono outline-none focus:border-primary"
                    />
                  </td>
                  <td className="p-4">
                    <select 
                      value={schedule.type}
                      onChange={(e) => updateSchedule(i, 'type', e.target.value)}
                      className="w-full bg-black/40 border border-divider rounded px-3 py-1.5 text-sm text-white outline-none focus:border-primary"
                    >
                      <option value="interval">Interval</option>
                      <option value="cron">Cron</option>
                    </select>
                  </td>
                  <td className="p-4">
                    <input 
                      type={schedule.type === 'interval' ? 'number' : 'text'}
                      value={schedule.value}
                      onChange={(e) => updateSchedule(i, 'value', e.target.value)}
                      className="w-full bg-black/40 border border-divider rounded px-3 py-1.5 text-sm text-white font-mono outline-none focus:border-primary"
                    />
                  </td>
                  <td className="p-4 text-center">
                    <button
                      onClick={() => updateSchedule(i, 'enabled', !schedule.enabled)}
                      className={`px-3 py-1 rounded text-[10px] font-bold uppercase transition-colors ${
                        schedule.enabled 
                          ? 'bg-green-500/20 text-green-500 hover:bg-green-500/30' 
                          : 'bg-gray-800 text-gray-500 hover:bg-gray-700'
                      }`}
                    >
                      {schedule.enabled ? 'Enabled' : 'Disabled'}
                    </button>
                  </td>
                  <td className="p-4 text-center">
                    <button 
                      onClick={() => removeSchedule(i)}
                      className="p-1.5 rounded hover:bg-active text-gray-500 hover:text-red-500 transition-colors mx-auto"
                      title="Remove Schedule"
                    >
                      <Trash2 size={16} />
                    </button>
                  </td>
                </tr>
              ))}
              {schedules.length === 0 && !isLoading && (
                <tr>
                  <td colSpan={5} className="p-12 text-center text-gray-600 italic">
                    No schedules defined. Click "Add Schedule" to create one.
                  </td>
                </tr>
              )}
              {isLoading && (
                <tr>
                  <td colSpan={5} className="p-12 text-center text-gray-600">
                    <RefreshCcw size={24} className="animate-spin mx-auto opacity-50" />
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="p-4 border-t border-divider bg-black/20 flex justify-center">
          <button 
            onClick={addSchedule}
            className="flex items-center gap-2 px-6 py-2 border border-dashed border-gray-600 text-gray-400 font-bold rounded-lg hover:text-primary hover:border-primary hover:bg-primary/5 transition-colors text-sm uppercase tracking-widest"
          >
            <Plus size={16} />
            Add Schedule
          </button>
        </div>
      </div>
    </div>
  );
};

export default Schedules;
