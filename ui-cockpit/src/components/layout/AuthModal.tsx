import React from 'react';
import { useNats } from '../../context/NatsContext';

export const AuthModal: React.FC = () => {
  const { meshStatus } = useNats();

  let activeAlert = null;
  let activeService = null;

  for (const [uuid, entry] of Object.entries(meshStatus)) {
    if (entry.status === 'auth_required' && entry.alerts && entry.alerts.length > 0) {
      const alert = entry.alerts.find(a => a.type === 'AUTH_REQUIRED');
      if (alert && alert.code && alert.url) {
        activeAlert = alert;
        // In a real implementation we might resolve UUID to Name, but for now we'll just show the provider or UUID
        activeService = alert.provider || uuid;
        break;
      }
    }
  }

  if (!activeAlert) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <div className="bg-card border border-divider rounded-xl w-full max-w-md shadow-2xl overflow-hidden">
        <div className="bg-yellow-500/20 p-6 border-b border-divider text-center">
          <h3 className="text-xl font-black uppercase tracking-tighter text-yellow-500">Authorization Required</h3>
          <p className="text-sm text-yellow-200/70 mt-2">{activeService} is requesting access.</p>
        </div>
        
        <div className="p-8 space-y-6 text-center">
          <p className="text-gray-400 text-sm">
            {activeAlert.message || 'Please authenticate to continue.'}
          </p>
          
          <div className="bg-black/50 border border-divider rounded-lg p-6">
            <div className="text-4xl font-mono font-black tracking-widest text-primary selection:bg-primary selection:text-black">
              {activeAlert.code}
            </div>
          </div>
          
          <div>
            <a 
              href={activeAlert.url} 
              target="_blank" 
              rel="noreferrer"
              className="inline-block w-full py-3 bg-primary text-black font-bold rounded hover:opacity-90 transition-opacity"
            >
              OPEN AUTHORIZATION PAGE
            </a>
            <p className="mt-4 text-[10px] text-gray-500 font-mono">
              Waiting for provider confirmation...
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
