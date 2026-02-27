'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';

interface Conversation {
  id: string;
  prospect_name: string;
  prospect_headline: string;
  prospect_company: string;
  last_message_at: string;
  last_message_text: string;
  message_count: number;
}

export default function ConversationsPage() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'recent' | 'needs_reply'>('all');
  const router = useRouter();

  useEffect(() => {
    fetchConversations();
  }, []);

  async function fetchConversations() {
    try {
      setLoading(true);
      const res = await fetch('/api/conversations');
      if (res.ok) {
        const data = await res.json();
        setConversations(data);
      }
    } catch (err) {
      console.error('Failed to load conversations:', err);
    } finally {
      setLoading(false);
    }
  }

  const filtered = useMemo(() => {
    let result = conversations;

    // Search filter
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(c =>
        c.prospect_name.toLowerCase().includes(q) ||
        c.prospect_headline?.toLowerCase().includes(q) ||
        c.prospect_company?.toLowerCase().includes(q) ||
        c.last_message_text?.toLowerCase().includes(q)
      );
    }

    // Tab filter
    if (filter === 'recent') {
      const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      result = result.filter(c => new Date(c.last_message_at) > oneWeekAgo);
    } else if (filter === 'needs_reply') {
      // Conversations with messages where the last message is likely from the prospect
      result = result.filter(c => c.message_count > 0 && c.last_message_text);
    }

    return result;
  }, [conversations, search, filter]);

  function timeAgo(dateStr: string): string {
    if (!dateStr) return '';
    const now = new Date();
    const date = new Date(dateStr);
    const diff = now.getTime() - date.getTime();
    const mins = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days < 7) return `${days}d ago`;
    if (days < 30) return `${Math.floor(days / 7)}w ago`;
    return date.toLocaleDateString('nl-NL', { day: 'numeric', month: 'short' });
  }

  function getInitials(name: string): string {
    return name.split(' ').map(w => w[0]).join('').substring(0, 2).toUpperCase();
  }

  function truncate(text: string, max: number): string {
    if (!text) return '';
    return text.length > max ? text.substring(0, max) + '...' : text;
  }

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '80vh', flexDirection: 'column', gap: '12px' }}>
        <div className="pulse-live" style={{ width: '24px', height: '24px', borderRadius: '50%', background: 'var(--accent)' }} />
        <span style={{ color: 'var(--text-muted)', fontSize: '14px' }}>Loading conversations...</span>
      </div>
    );
  }

  return (
    <div style={{ padding: '32px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '24px' }}>
        <div>
          <h1 style={{ fontSize: '24px', fontWeight: 700 }}>Conversations</h1>
          <p style={{ fontSize: '14px', color: 'var(--text-muted)', marginTop: '4px' }}>
            {conversations.length} LinkedIn conversations • {filtered.length} shown
          </p>
        </div>
        <button className="btn-secondary" onClick={fetchConversations} style={{ fontSize: '13px' }}>
          🔄 Refresh
        </button>
      </div>

      {/* Search + Filters */}
      <div style={{ display: 'flex', gap: '12px', marginBottom: '20px', flexWrap: 'wrap' }}>
        <input
          type="text"
          className="input-field"
          placeholder="Search by name, company, headline, or message..."
          style={{ flex: 1, minWidth: '250px' }}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div style={{ display: 'flex', gap: '4px' }}>
          {(['all', 'recent', 'needs_reply'] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              style={{
                padding: '8px 16px', borderRadius: '8px', border: 'none',
                fontSize: '13px', cursor: 'pointer', fontWeight: 500,
                background: filter === f ? 'var(--accent)' : 'rgba(255,255,255,0.06)',
                color: filter === f ? '#fff' : 'var(--text-muted)',
                transition: 'all 0.2s',
              }}
            >
              {f === 'all' ? 'All' : f === 'recent' ? '🕐 Recent (7d)' : '💬 Has messages'}
            </button>
          ))}
        </div>
      </div>

      {/* Conversations list */}
      {filtered.length === 0 ? (
        <div className="glass-card" style={{ padding: '48px', textAlign: 'center' }}>
          <p style={{ fontSize: '16px', color: 'var(--text-muted)' }}>
            {search ? 'No conversations match your search.' : 'No conversations found.'}
          </p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
          {filtered.map((conv) => (
            <div
              key={conv.id}
              onClick={() => router.push(`/conversations/${conv.id}`)}
              className="glass-card"
              style={{
                padding: '16px 20px',
                borderRadius: '8px',
                cursor: 'pointer',
                display: 'flex', alignItems: 'center', gap: '16px',
                transition: 'all 0.15s',
                borderLeft: '3px solid transparent',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderLeftColor = 'var(--accent)';
                e.currentTarget.style.background = 'rgba(255,255,255,0.04)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderLeftColor = 'transparent';
                e.currentTarget.style.background = '';
              }}
            >
              {/* Avatar */}
              <div className="avatar" style={{
                width: '44px', height: '44px', fontSize: '14px', flexShrink: 0,
                background: conv.prospect_name === 'LinkedIn Contact'
                  ? 'rgba(255,255,255,0.08)'
                  : 'linear-gradient(135deg, var(--accent), #6D28D9)',
              }}>
                {getInitials(conv.prospect_name)}
              </div>

              {/* Name + Info */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ fontWeight: 600, fontSize: '14px' }}>{conv.prospect_name}</span>
                  {conv.message_count > 0 && (
                    <span style={{
                      fontSize: '11px', padding: '2px 6px', borderRadius: '10px',
                      background: 'rgba(59, 130, 246, 0.15)', color: 'var(--accent)',
                    }}>
                      {conv.message_count} msg{conv.message_count !== 1 ? 's' : ''}
                    </span>
                  )}
                </div>
                {conv.prospect_headline && (
                  <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '2px' }}>
                    {truncate(conv.prospect_headline, 80)}
                  </div>
                )}
                {conv.last_message_text && (
                  <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '4px', fontStyle: 'italic' }}>
                    "{truncate(conv.last_message_text, 100)}"
                  </div>
                )}
              </div>

              {/* Time */}
              <div style={{ fontSize: '12px', color: 'var(--text-muted)', whiteSpace: 'nowrap', flexShrink: 0 }}>
                {timeAgo(conv.last_message_at)}
              </div>

              {/* Arrow */}
              <span style={{ color: 'var(--text-muted)', fontSize: '16px' }}>→</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
