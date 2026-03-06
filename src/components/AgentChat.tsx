'use client';

import { useState, useEffect, useRef, useCallback } from 'react';

interface ChatMessage {
  role: 'user' | 'agent';
  content: string;
  timestamp: string;
  actions?: { type: string; result?: string }[];
}

interface AgentChatProps {
  onModeChange?: (mode: string) => void;
  onRefreshDashboard?: () => void;
}

export default function AgentChat({ onModeChange, onRefreshDashboard }: AgentChatProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Load history on mount
  useEffect(() => {
    fetch('/api/agent/chat')
      .then(r => r.json())
      .then(data => {
        if (data.history) setMessages(data.history);
      })
      .catch(() => {});
  }, []);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Focus input when opened
  useEffect(() => {
    if (isOpen) setTimeout(() => inputRef.current?.focus(), 200);
  }, [isOpen]);

  const sendMessage = useCallback(async () => {
    const text = input.trim();
    if (!text || loading) return;

    setInput('');
    setLoading(true);

    // Optimistic add user message
    const userMsg: ChatMessage = { role: 'user', content: text, timestamp: new Date().toISOString() };
    setMessages(prev => [...prev, userMsg]);

    try {
      // 90s timeout — agent may need time for draft generation
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 90000);

      const res = await fetch('/api/agent/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text }),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (res.ok) {
        const data = await res.json();
        const agentMsg: ChatMessage = {
          role: 'agent',
          content: data.message,
          timestamp: new Date().toISOString(),
          actions: data.actions,
        };
        setMessages(prev => [...prev, agentMsg]);

        // If mode changed, notify parent
        if (data.actions?.some((a: any) => a.type === 'CHANGE_MODE')) {
          onModeChange?.(data.mode);
          window.dispatchEvent(new CustomEvent('agent-mode-changed', { detail: data.mode }));
        }

        // Refresh dashboard after any action
        if (data.actions?.length > 0) {
          onRefreshDashboard?.();
        }
      } else {
        let errMsg = 'Something went wrong';
        try {
          const err = await res.json();
          errMsg = err.error || err.message || errMsg;
        } catch {}
        setMessages(prev => [...prev, {
          role: 'agent',
          content: '❌ Error (' + res.status + '): ' + errMsg,
          timestamp: new Date().toISOString(),
        }]);
      }
    } catch (err: any) {
      const isTimeout = err?.name === 'AbortError';
      setMessages(prev => [...prev, {
        role: 'agent',
        content: isTimeout
          ? '⏳ Jarvis is bezig met je verzoek, maar het duurt langer dan verwacht. Probeer het over een minuut opnieuw.'
          : '❌ Verbindingsfout: ' + (err?.message || 'Server niet bereikbaar. Probeer het opnieuw.'),
        timestamp: new Date().toISOString(),
      }]);
    }
    setLoading(false);
  }, [input, loading, onModeChange, onRefreshDashboard]);

  const quickActions = [
    { label: '📥 Scan inbox', text: 'Scan mijn inbox en vertel me hoeveel chats aandacht nodig hebben' },
    { label: '📊 Status', text: 'Geef me een overzicht van de huidige status' },
    { label: '👤 Copilot aan', text: 'Zet copilot mode aan' },
    { label: '⚙️ Settings', text: 'Wat zijn de huidige scan instellingen?' },
  ];

  return (
    <>
      {/* Floating toggle button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        style={{
          position: 'fixed', bottom: '20px', right: '20px', zIndex: 10000,
          width: '56px', height: '56px', borderRadius: '50%',
          background: isOpen ? 'var(--danger)' : 'linear-gradient(135deg, #7c3aed, #3b82f6)',
          border: 'none', color: '#fff', fontSize: '20px', cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: isOpen ? '0 4px 20px rgba(239,68,68,0.4)' : '0 4px 24px rgba(124, 58, 237, 0.5)',
          transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
        }}
      >
        {isOpen ? '✕' : '⚡'}
      </button>

      {/* Chat panel */}
      {isOpen && (
        <div style={{
          position: 'fixed', bottom: '88px', right: '20px', zIndex: 9999,
          width: '380px', maxWidth: 'calc(100vw - 40px)',
          height: '520px', maxHeight: 'calc(100vh - 120px)',
          background: 'var(--bg-secondary)',
          borderRadius: '16px',
          border: '1px solid var(--border)',
          display: 'flex', flexDirection: 'column',
          boxShadow: '0 8px 40px rgba(0,0,0,0.4)',
          overflow: 'hidden',
        }}>
          {/* Header */}
          <div style={{
            padding: '14px 16px',
            background: 'linear-gradient(135deg, rgba(124,58,237,0.12), rgba(59,130,246,0.06))',
            borderBottom: '1px solid var(--border)',
            display: 'flex', alignItems: 'center', gap: '12px',
          }}>
            <div style={{
              width: '36px', height: '36px', borderRadius: '12px',
              background: 'linear-gradient(135deg, #7c3aed, #3b82f6)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '18px', boxShadow: '0 2px 8px rgba(124,58,237,0.3)',
            }}>⚡</div>
            <div>
              <div style={{ fontWeight: 700, fontSize: '15px', letterSpacing: '-0.01em' }}>Jarvis</div>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                Jouw AI assistent • Volledige controle
              </div>
            </div>
          </div>

          {/* Messages */}
          <div style={{
            flex: 1, overflowY: 'auto', padding: '12px',
            display: 'flex', flexDirection: 'column', gap: '8px',
          }}>
            {messages.length === 0 && (
              <div style={{ textAlign: 'center', padding: '24px 12px', color: 'var(--text-muted)', fontSize: '13px' }}>
                <div style={{ fontSize: '32px', marginBottom: '8px' }}>⚡</div>
                <p style={{ marginBottom: '12px', fontWeight: 500 }}>Hey Gianni! Jarvis hier, klaar om aan de slag te gaan.</p>
                <p>Wat kan ik voor je doen?</p>
                <div style={{ marginTop: '12px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  {quickActions.map(qa => (
                    <button
                      key={qa.label}
                      onClick={() => { setInput(qa.text); setTimeout(() => sendMessage(), 100); }}
                      style={{
                        padding: '8px 12px', borderRadius: '8px', fontSize: '12px',
                        background: 'rgba(59,130,246,0.1)', border: '1px solid rgba(59,130,246,0.2)',
                        color: 'var(--accent)', cursor: 'pointer', textAlign: 'left',
                      }}
                    >
                      {qa.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((msg, i) => (
              <div key={i} style={{
                display: 'flex',
                justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start',
              }}>
                <div style={{
                  maxWidth: '85%', padding: '10px 14px', borderRadius: '14px',
                  fontSize: '13px', lineHeight: '1.5',
                  background: msg.role === 'user'
                    ? 'linear-gradient(135deg, #1d4ed8, #3b82f6)'
                    : 'rgba(255,255,255,0.06)',
                  color: msg.role === 'user' ? '#fff' : 'var(--text-primary)',
                  border: msg.role === 'user' ? 'none' : '1px solid var(--border)',
                }}>
                  <div style={{ whiteSpace: 'pre-wrap' }}>{msg.content}</div>
                  {/* Action results */}
                  {msg.actions && msg.actions.length > 0 && (
                    <div style={{ marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      {msg.actions.map((a, j) => (
                        <div key={j} style={{
                          fontSize: '11px', padding: '4px 8px', borderRadius: '6px',
                          background: 'rgba(16,185,129,0.1)', color: 'var(--success)',
                          border: '1px solid rgba(16,185,129,0.2)',
                        }}>
                          ✓ {a.type}: {a.result}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}

            {loading && (
              <div style={{ display: 'flex', gap: '4px', padding: '8px 14px' }}>
                <div className="pulse-live" style={{ width: '6px', height: '6px', borderRadius: '50%', background: 'var(--accent)' }} />
                <div className="pulse-live" style={{ width: '6px', height: '6px', borderRadius: '50%', background: 'var(--accent)', animationDelay: '0.2s' }} />
                <div className="pulse-live" style={{ width: '6px', height: '6px', borderRadius: '50%', background: 'var(--accent)', animationDelay: '0.4s' }} />
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Quick actions bar (when messages exist) */}
          {messages.length > 0 && (
            <div style={{
              padding: '6px 12px', display: 'flex', gap: '4px', overflowX: 'auto',
              borderTop: '1px solid rgba(255,255,255,0.05)',
            }}>
              {quickActions.map(qa => (
                <button
                  key={qa.label}
                  onClick={() => { setInput(qa.text); }}
                  style={{
                    padding: '4px 8px', borderRadius: '6px', fontSize: '11px', whiteSpace: 'nowrap',
                    background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border)',
                    color: 'var(--text-muted)', cursor: 'pointer',
                  }}
                >
                  {qa.label}
                </button>
              ))}
            </div>
          )}

          {/* Input */}
          <div style={{
            padding: '10px 12px', borderTop: '1px solid var(--border)',
            display: 'flex', gap: '8px',
          }}>
            <input
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
              placeholder="Type een instructie..."
              disabled={loading}
              style={{
                flex: 1, padding: '10px 14px', borderRadius: '10px', fontSize: '13px',
                background: 'rgba(255,255,255,0.06)', border: '1px solid var(--border)',
                color: 'var(--text-primary)', outline: 'none',
              }}
            />
            <button
              onClick={sendMessage}
              disabled={loading || !input.trim()}
              style={{
                width: '40px', height: '40px', borderRadius: '10px',
                background: input.trim() ? 'var(--accent)' : 'rgba(255,255,255,0.05)',
                border: 'none', color: '#fff', fontSize: '16px', cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                opacity: (!input.trim() || loading) ? 0.5 : 1,
              }}
            >
              →
            </button>
          </div>
        </div>
      )}
    </>
  );
}
