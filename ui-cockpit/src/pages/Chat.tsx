import React, { useState, useEffect, useRef } from 'react';
import { useNats } from '../context/NatsContext';
import { Send, User, Bot, Loader2 } from 'lucide-react';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

const Chat: React.FC = () => {
  const { request, publish, subscribe, status } = useNats();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [agentId] = useState('jerry'); // Hardcoded default for v0, can be made dynamic
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Scroll to bottom
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isTyping]);

  // Load History
  useEffect(() => {
    if (status !== 'connected') return;

    const loadHistory = async () => {
      try {
        const res = await request('service.fs.read', {
          scope: 'agent',
          agent_id: agentId,
          path: 'chat.json'
        });

        if (res.status === 'success' && res.content) {
          const parsed = JSON.parse(res.content);
          if (Array.isArray(parsed)) {
            setMessages(parsed);
          }
        }
      } catch (err) {
        console.warn('Could not load chat history:', err);
      }
    };

    loadHistory();
  }, [status, request, agentId]);

  // Subscribe to Outbox
  useEffect(() => {
    if (status !== 'connected') return;

    const unsub = subscribe(`agent.${agentId}.outbox`, (data: any) => {
      if (data && data.role && data.content) {
        setMessages(prev => [...prev, { role: data.role, content: data.content }]);
        setIsTyping(false);
      }
    });

    return () => unsub();
  }, [status, subscribe, agentId]);

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || status !== 'connected') return;

    const userMsg: ChatMessage = { role: 'user', content: input.trim() };
    
    // Optimistic UI update
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setIsTyping(true);

    // Publish to NATS
    publish(`agent.${agentId}.inbox`, userMsg);
  };

  return (
    <div className="flex flex-col h-full bg-main text-white space-y-4">
      <div className="border-b border-divider pb-4 flex justify-between items-end shrink-0">
        <div>
          <h2 className="text-2xl font-black uppercase tracking-tighter italic">Intercom</h2>
          <p className="text-gray-500 text-sm">Direct NATS communication with {agentId}</p>
        </div>
      </div>

      <div className="flex-1 min-h-0 bg-card border border-divider rounded-xl overflow-hidden flex flex-col relative">
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {messages.length === 0 && !isTyping && (
            <div className="text-center text-gray-600 italic mt-20">
              No conversation history found. Send a message to start.
            </div>
          )}

          {messages.map((msg, i) => (
            <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`flex gap-4 max-w-[80%] ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>
                <div className={`shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${
                  msg.role === 'user' ? 'bg-blue-500/20 text-blue-500' : 'bg-green-500/20 text-green-500'
                }`}>
                  {msg.role === 'user' ? <User size={16} /> : <Bot size={16} />}
                </div>
                <div className={`p-4 rounded-2xl whitespace-pre-wrap font-mono text-sm ${
                  msg.role === 'user' 
                    ? 'bg-blue-500/10 border border-blue-500/20 text-blue-100 rounded-tr-sm' 
                    : 'bg-black/40 border border-divider text-gray-300 rounded-tl-sm'
                }`}>
                  {msg.content}
                </div>
              </div>
            </div>
          ))}

          {isTyping && (
            <div className="flex justify-start">
              <div className="flex gap-4 max-w-[80%] flex-row">
                <div className="shrink-0 w-8 h-8 rounded-full flex items-center justify-center bg-green-500/20 text-green-500">
                  <Bot size={16} />
                </div>
                <div className="p-4 rounded-2xl bg-black/40 border border-divider text-gray-300 rounded-tl-sm flex items-center gap-2">
                  <Loader2 size={16} className="animate-spin text-primary" />
                  <span className="text-xs text-gray-500 italic">Thinking...</span>
                </div>
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        <div className="p-4 border-t border-divider bg-black/20 shrink-0">
          <form onSubmit={handleSend} className="flex gap-2">
            <input 
              type="text" 
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={`Send a message to ${agentId}...`}
              disabled={isTyping || status !== 'connected'}
              className="flex-1 bg-black/40 border border-divider rounded-lg px-4 py-3 text-sm text-white outline-none focus:border-primary disabled:opacity-50"
            />
            <button 
              type="submit"
              disabled={!input.trim() || isTyping || status !== 'connected'}
              className="bg-primary text-black p-3 rounded-lg flex items-center justify-center hover:opacity-90 disabled:opacity-50 transition-opacity"
            >
              <Send size={18} />
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};

export default Chat;
