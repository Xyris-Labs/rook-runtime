import React from 'react';
import { NavLink } from 'react-router-dom';
import { LayoutDashboard, Users, Calendar, Settings, MessageSquare } from 'lucide-react';

const Sidebar: React.FC = () => {
  const navItems = [
    { name: 'Dashboard', path: '/', icon: LayoutDashboard },
    { name: 'Intercom', path: '/chat', icon: MessageSquare },
    { name: 'Agents', path: '/agents', icon: Users },
    { name: 'Schedules', path: '/schedules', icon: Calendar },
    { name: 'System', path: '/system', icon: Settings },
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
