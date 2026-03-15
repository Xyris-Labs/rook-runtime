import { useState } from 'react';
import DynamicAgentNode from '../components/DynamicAgentNode';

export default function Agents() {
  const [targetUuid, setTargetUuid] = useState('');
  const [mountedUuid, setMountedUuid] = useState('');

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-100">Agent Nodes</h1>
      <div className="flex gap-4 mb-8">
        <input
          type="text"
          placeholder="Paste Worker UUID here..."
          className="px-4 py-2 bg-gray-800 text-white flex-1 border border-gray-700 rounded"
          value={targetUuid}
          onChange={(e) => setTargetUuid(e.target.value)}
        />
        <button
          className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded"
          onClick={() => setMountedUuid(targetUuid)}
        >
          Connect to Node
        </button>
      </div>
      {mountedUuid && <DynamicAgentNode uuid={mountedUuid} />}
    </div>
  );
}
