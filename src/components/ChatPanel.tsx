'use client';

import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';

interface Message {
  id: string;
  conversation_id: string;
  role: 'prospect' | 'agent' | 'human';
  content: string;
  reasoning?: string;
  sent_at: string;
  is_read: boolean;
}

interface ChatPanelProps {
  conversationId: string;
  chatId: string;
  initials: string;
  initialMessages: Message[];
}

export default function ChatPanel({ conversationId, chatId, initials, initialMessages }: ChatPanelProps) {
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [inputValue, setInputValue] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [isAiLoading, setIsAiLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  function formatTime(dateStr: string): string {
    const d = new Date(dateStr);
    return d.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' });
  }

  async function sendMessage() {
    if (!inputValue.trim() || isSending) return;
    setIsSending(true);

    try {
      const res = await fetch('/api/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversation_id: conversationId,
          chat_id: chatId,
          content: inputValue.trim(),
        }),
      });

      if (res.ok) {
        const data = await res.json();
        setMessages(prev => [...prev, data.message]);
        setInputValue('');
      }
    } catch (err) {
      console.error('Send failed:', err);
    } finally {
      setIsSending(false);
    }
  }

  async function triggerAiResponse() {
    if (isAiLoading) return;
    setIsAiLoading(true);

    try {
      const res = await fetch('/api/agent/respond', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversation_id: conversationId }),
      });

      if (res.ok) {
        const data = await res.json();
        setMessages(prev => [...prev, data.message]);
        router.refresh();
      } else {
        const err = await res.json();
        alert(`AI Error: ${err.error || 'Unknown error'}\n${err.details || ''}`);
      }
    } catch (err) {
      console.error('AI response failed:', err);
      alert('Failed to generate AI response. Check the console for details.');
    } finally {
      setIsAiLoading(false);
    }
  }

  return (
    <>
      {/* Messages */}
      <div style={{
        flex: 1, overflowY: 'auto', padding: '24px',
        background: 'var(--bg-primary)',
        display: 'flex', flexDirection: 'column', gap: '16px',
      }}>
        {messages.map((msg) => (
          <div key={msg.id} className="animate-fadeIn">
            {msg.role === 'prospect' ? (
              <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
                <div className="avatar" style={{ width: '32px', height: '32px', fontSize: '12px' }}>
                  {initials}
                </div>
                <div>
                  <div className="chat-bubble-prospect">
                    <p style={{ fontSize: '14px', lineHeight: '1.5' }}>{msg.content}</p>
                  </div>
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px', paddingLeft: '4px' }}>
                    {formatTime(msg.sent_at)}
                  </div>
                </div>
              </div>
            ) : (
              <div>
                {msg.reasoning && (
                  <div style={{
                    fontSize: '11px', color: 'var(--text-muted)',
                    background: 'rgba(139, 92, 246, 0.08)',
                    border: '1px solid rgba(139, 92, 246, 0.15)',
                    borderRadius: '8px', padding: '8px 12px',
                    marginBottom: '8px', marginLeft: 'auto', maxWidth: '75%',
                  }}>
                    🧠 <strong>AI Reasoning:</strong> {msg.reasoning}
                  </div>
                )}
                <div className={msg.role === 'human' ? 'chat-bubble-human' : 'chat-bubble-agent'}>
                  <p style={{ fontSize: '14px', lineHeight: '1.5' }}>{msg.content}</p>
                </div>
                <div style={{
                  fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px',
                  textAlign: 'right', paddingRight: '4px',
                }}>
                  {msg.role === 'human' ? '👤 You' : '🤖 AI'} • {formatTime(msg.sent_at)}
                </div>
              </div>
            )}
          </div>
        ))}

        {isAiLoading && (
          <div style={{
            display: 'flex', justifyContent: 'flex-end', padding: '8px',
          }}>
            <div style={{
              background: 'rgba(59, 130, 246, 0.1)',
              border: '1px solid rgba(59, 130, 246, 0.2)',
              borderRadius: '12px', padding: '12px 16px',
              fontSize: '13px', color: 'var(--accent)',
              display: 'flex', alignItems: 'center', gap: '8px',
            }}>
              <span className="pulse-live" style={{ width: '8px', height: '8px', borderRadius: '50%', background: 'var(--accent)' }} />
              AI is thinking...
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Message input */}
      <div className="glass-card" style={{
        padding: '16px 24px',
        borderRadius: '0 0 16px 16px',
        borderTop: '1px solid var(--border)',
        display: 'flex', gap: '12px', alignItems: 'center',
      }}>
        <input
          type="text"
          className="input-field"
          placeholder="Type a message to take over manually..."
          style={{ flex: 1 }}
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && sendMessage()}
          disabled={isSending}
        />
        <button
          className="btn-primary"
          style={{ whiteSpace: 'nowrap', opacity: isSending ? 0.6 : 1 }}
          onClick={sendMessage}
          disabled={isSending || !inputValue.trim()}
        >
          {isSending ? 'Sending...' : 'Send ↗'}
        </button>
        <button
          className="btn-secondary"
          style={{ whiteSpace: 'nowrap', fontSize: '13px', opacity: isAiLoading ? 0.6 : 1 }}
          onClick={triggerAiResponse}
          disabled={isAiLoading}
        >
          {isAiLoading ? '⏳ Generating...' : '🤖 Let AI Respond'}
        </button>
      </div>
    </>
  );
}
