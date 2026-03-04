import React from 'react';
import Sidebar from './Sidebar';
import Header from './Header';
import { Outlet } from 'react-router-dom';
import { AuthModal } from './AuthModal';

const MainLayout: React.FC = () => {
  return (
    <div className="flex h-screen bg-main text-white overflow-hidden">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0 relative">
        <Header />
        <main className="flex-1 overflow-y-auto p-6 relative">
          <Outlet />
        </main>
      </div>
      <AuthModal />
    </div>
  );
};

export default MainLayout;

