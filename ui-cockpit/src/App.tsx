import { BrowserRouter, Routes, Route } from 'react-router-dom';
import MainLayout from './components/layout/MainLayout';
import Dashboard from './pages/Dashboard';
import Agents from './pages/Agents';
import Schedules from './pages/Schedules';
import System from './pages/System';
import Chat from './pages/Chat';
import Cortex from './pages/Cortex';
import Scribe from './pages/Scribe';
import { NatsProvider } from './context/NatsContext';

function App() {
  return (
    <NatsProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<MainLayout />}>
            <Route index element={<Dashboard />} />
            <Route path="chat" element={<Chat />} />
            <Route path="agents" element={<Agents />} />
            <Route path="schedules" element={<Schedules />} />
            <Route path="system" element={<System />} />
            <Route path="cortex" element={<Cortex />} />
            <Route path="scribe" element={<Scribe />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </NatsProvider>
  );
}

export default App;
