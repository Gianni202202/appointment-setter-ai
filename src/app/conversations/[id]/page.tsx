'use client';

import { useState, useEffect, use } from 'react';
import Link from 'next/link';

interface ChatMessage {
  id: string;
  role: 'prospect' | 'agent' | 'human';
  content: string;
  sent_at: string;
  is_read: boolean;
}

export default function ConversationDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: chatId } = use(params);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch(`/api/conversations?chat_id=${chatId}`)
      .then(res => res.json())
      .then(data => {
        if (data.messages) {
          setMessages(data.messages);
        } else if (data.error) {
          setError(data.error);
        }
      })
      .catch(err => setError(String(err)))
      .finally(() => setLoading(false));
  }, [chatId]);

  function formatTime(dateStr: string): string {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    return d.toLocaleDateString('nl-NL', {
      day: 'numeric', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 64px)' }}>
      {/* Header */}
      <div className="glass-card" style={{
        padding: '16px 24px',
        borderRadius: '16px 16px 0 0',
        display: 'flex', alignItems: 'center', gap: '16px',
        borderBottom: '1px solid var(--border)',
      }}>
        <Link href="/conversations" style={{ color: 'var(--text-muted)', textDecoration: 'none', fontSize: '20px' }}>
          ←
        </Link>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 700, fontSize: '16px' }}>
            Conversation
          </div>
          <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
            {messages.length} messages
          </div>
        </div>
      </div>

      {/* Messages */}
      <div className="glass-card" style={{
        flex: 1,
        borderRadius: '0 0 16px 16px',
        padding: '24px',
        overflowY: 'auto',
        display: 'flex',
        flexDirection: 'column',
        gap: '16px',
      }}>
        {loading ? (
          <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--text-muted)' }}>
            Loading messages...
          </div>
        ) : error ? (
          <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--danger)' }}>
            Error: {error}
          </div>
        ) : messages.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--text-muted)' }}>
            No messages in this conversation
          </div>
        ) : (
          messages.map((msg) => {
            const isMe = msg.role === 'agent' || msg.role === 'human';
            return (
              <div
                key={msg.id}
                style={{
                  display: 'flex',
                  justifyContent: isMe ? 'flex-end' : 'flex-start',
                }}
              >
                <div style={{
                  maxWidth: '70%',
                  padding: '12px 16px',
                  borderRadius: isMe ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
                  background: isMe
                    ? 'linear-gradient(135deg, #1d4ed8, #3b82f6)'
                    : 'var(--bg-secondary)',
                  color: isMe ? '#fff' : 'var(--text-primary)',
                }}>
                  <div style={{ fontSize: '14px', lineHeight: '1.5', whiteSpace: 'pre-wrap' }}>
                    {msg.content}
                  </div>
                  <div style={{
                    fontSize: '10px',
                    marginTop: '6px',
                    opacity: 0.6,
                    textAlign: isMe ? 'right' : 'left',
                  }}>
                    {formatTime(msg.sent_at)}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
