import React from 'react';
import { Activity } from 'lucide-react';
import { useNats } from '../../context/NatsContext';

const Header: React.FC = () => {
  const { status } = useNats();

  return (
    <header className="sticky top-0 z-10 bg-card border-b border-divider h-14 flex items-center justify-between px-6">
      <h1 className="text-lg font-bold text-primary">Rook Cockpit</h1>
      <div className="flex items-center gap-2">
        <Activity 
          size={16} 
          className={status === 'connected' ? 'text-green-500' : status === 'connecting' ? 'text-yellow-500' : 'text-red-500'} 
        />
        <span className="text-sm uppercase tracking-wider text-gray-400">
          {status}
        </span>
      </div>
    </header>
  );
};

export default Header;
