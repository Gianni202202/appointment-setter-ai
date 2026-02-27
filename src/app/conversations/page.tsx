'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';

interface ChatConversation {
  id: string;
  prospect_name: string;
  prospect_headline: string;
  prospect_company: string;
  last_message_at: string;
  last_message_text: string;
  state: string;
  message_count: number;
}

export default function ConversationsPage() {
  const [conversations, setConversations] = useState<ChatConversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');

  useEffect(() => {
    fetch('/api/conversations')
      .then(res => res.json())
      .then(data => {
        if (Array.isArray(data)) {
          setConversations(data);
        }
      })
      .catch(err => console.error('Failed to load:', err))
      .finally(() => setLoading(false));
  }, []);

  function timeAgo(dateStr: string): string {
    if (!dateStr) return '';
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}d ago`;
    return new Date(dateStr).toLocaleDateString('nl-NL', { day: 'numeric', month: 'short' });
  }

  const filtered = conversations.filter(c => {
    const matchesSearch = !search ||
      c.prospect_name.toLowerCase().includes(search.toLowerCase()) ||
      c.prospect_headline?.toLowerCase().includes(search.toLowerCase()) ||
      c.prospect_company?.toLowerCase().includes(search.toLowerCase());
    return matchesSearch;
  });

  return (
    <div>
      <div style={{ marginBottom: '24px' }}>
        <h1 style={{ fontSize: '28px', fontWeight: 800, marginBottom: '4px' }}>
          Conversations
        </h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: '14px' }}>
          {loading ? 'Loading...' : `${conversations.length} total conversations`}
        </p>
      </div>

      {/* Search */}
      <div style={{ marginBottom: '24px' }}>
        <input
          type="text"
          placeholder="Search by name, company, or headline..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{
            width: '100%',
            padding: '12px 16px',
            borderRadius: '12px',
            border: '1px solid var(--border)',
            background: 'var(--bg-card)',
            color: 'var(--text-primary)',
            fontSize: '14px',
            outline: 'none',
          }}
        />
      </div>

      {loading ? (
        <div className="glass-card" style={{ padding: '60px', textAlign: 'center' }}>
          <p style={{ fontSize: '14px', color: 'var(--text-muted)' }}>Loading conversations from LinkedIn...</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="glass-card" style={{ padding: '60px', textAlign: 'center' }}>
          <p style={{ fontSize: '16px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '8px' }}>
            {search ? 'No conversations match your search' : 'No conversations yet'}
          </p>
          <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
            {search ? 'Try a different search term' : 'Connect LinkedIn and sync your chats from the Dashboard'}
          </p>
        </div>
      ) : (
        <div className="glass-card" style={{ overflow: 'hidden' }}>
          {filtered.map((conv, i) => {
            const initials = conv.prospect_name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
            return (
              <Link
                key={conv.id}
                href={`/conversations/${conv.id}`}
                style={{
                  display: 'flex', alignItems: 'center', gap: '16px',
                  padding: '16px 20px', textDecoration: 'none', color: 'inherit',
                  borderTop: i > 0 ? '1px solid var(--border)' : 'none',
                  transition: 'background 0.2s ease',
                }}
                onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-secondary)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              >
                <div className="avatar">{initials}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                    <span style={{ fontWeight: 600, fontSize: '14px' }}>
                      {conv.prospect_name}
                    </span>
                    {conv.prospect_company && (
                      <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                        at {conv.prospect_company}
                      </span>
                    )}
                  </div>
                  <div style={{
                    fontSize: '12px', color: 'var(--text-muted)',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>
                    {conv.last_message_text || conv.prospect_headline || 'No messages'}
                  </div>
                </div>
                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '4px' }}>
                    {timeAgo(conv.last_message_at)}
                  </div>
                  {conv.message_count > 0 && (
                    <span style={{
                      fontSize: '10px', padding: '2px 8px', borderRadius: '8px',
                      background: 'rgba(99, 102, 241, 0.15)', color: '#818cf8',
                      fontWeight: 600,
                    }}>
                      {conv.message_count} msgs
                    </span>
                  )}
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
