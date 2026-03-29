import React from 'react';
import { NavLink } from 'react-router-dom';
import { LayoutDashboard, Users, Calendar, Settings, MessageSquare, Box, Database, HardDrive } from 'lucide-react';
import { useWorkerRegistry } from '../../hooks/useWorkerRegistry';

const Sidebar: React.FC = () => {
  const workers = useWorkerRegistry();
  const navItems = [
    { name: 'Dashboard', path: '/', icon: LayoutDashboard },
    { name: 'Intercom', path: '/chat', icon: MessageSquare },
    { name: 'Agents', path: '/agents', icon: Users },
    { name: 'Schedules', path: '/schedules', icon: Calendar },
    { name: 'System', path: '/system', icon: Settings },
    { name: 'Cortex', path: '/cortex', icon: Database },
    { name: 'Scribe', path: '/scribe', icon: HardDrive },
  ];

  return (
    <aside className="w-64 bg-sidebar border-r border-divider flex flex-col h-screen">
      <div className="p-6">
        <div className="text-primary font-black text-2xl tracking-tighter">ROOK</div>
        <div className="text-xs text-gray-500 font-mono mt-neg-1">RUNTIME v0</div>
      </div>
      <nav className="flex-1 px-4 space-y-1">
        {navItems.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2 rounded-md transition-colors ${
                isActive
                  ? 'bg-active text-primary'
                  : 'text-gray-400 hover-bg-hover hover-text-white'
              }`
            }
          >
            <item.icon size={18} />
            <span className="font-medium">{item.name}</span>
          </NavLink>
        ))}
        {workers.length > 0 && (
          <div className="mt-8">
            <h3 className="px-4 text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Connected Nodes</h3>
            <div className="space-y-1">
              {workers.map((worker) => (
                <a
                  key={worker.key}
                  href={`/agents?worker=${worker.uuid}`}
                  className="flex items-center gap-3 px-4 py-2 text-sm text-gray-400 hover:text-white hover:bg-white/5 rounded-lg transition-colors"
                >
                  <Box size={16} />
                  <span className="truncate">{worker.key.replace('service.worker.', '')}</span>
                </a>
              ))}
            </div>
          </div>
        )}
      </nav>
      <div className="p-4 border-t border-divider">
        <div className="text-xs text-gray-600 font-mono">
          © 2026 Xyris-Labs
        </div>
      </div>
    </aside>
  );
};

export default Sidebar;
