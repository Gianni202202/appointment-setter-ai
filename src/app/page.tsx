'use client';

import { useState, useEffect } from 'react';
import AgentToggle from '@/components/AgentToggle';
import LinkedInConnect from '@/components/LinkedInConnect';
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

export default function Dashboard() {
  const [conversations, setConversations] = useState<ChatConversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [linkedInConnected, setLinkedInConnected] = useState(false);

  useEffect(() => {
    // Check if LinkedIn is connected
    fetch('/api/unipile/status')
      .then(res => res.json())
      .then(data => {
        setLinkedInConnected(data.connected);
        // Only fetch conversations if connected
        if (data.connected) {
          return fetch('/api/conversations');
        }
        return null;
      })
      .then(res => res ? res.json() : [])
      .then(data => {
        if (Array.isArray(data)) {
          setConversations(data);
        }
      })
      .catch(err => console.error('Load failed:', err))
      .finally(() => setLoading(false));
  }, []);

  const total = conversations.length;
  const recentConversations = conversations.slice(0, 5);

  // Calculate basic metrics from conversations
  const withMessages = conversations.filter(c => c.message_count > 0).length;
  const replyRate = total > 0 ? Math.round((withMessages / total) * 100) : 0;

  // Format relative time
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

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: '24px' }}>
        <h1 style={{ fontSize: '28px', fontWeight: 800, marginBottom: '4px' }}>
          Dashboard
        </h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: '14px' }}>
          Overview of your AI appointment setter performance
        </p>
      </div>

      {/* Agent Controls */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', marginBottom: '32px' }}>
        <AgentToggle initialEnabled={false} />
        <LinkedInConnect />
      </div>

      {/* Metric Cards */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(4, 1fr)',
        gap: '20px',
        marginBottom: '32px',
      }}>
        <div className="metric-card">
          <div style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '8px' }}>
            Total Conversations
          </div>
          <div style={{ fontSize: '36px', fontWeight: 800, color: 'var(--text-primary)' }}>
            {loading ? '—' : total}
          </div>
        </div>

        <div className="metric-card">
          <div style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '8px' }}>
            Active Conversations
          </div>
          <div style={{ fontSize: '36px', fontWeight: 800, color: 'var(--success)' }}>
            {loading ? '—' : total}
          </div>
        </div>

        <div className="metric-card">
          <div style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '8px' }}>
            Reply Rate
          </div>
          <div style={{ fontSize: '36px', fontWeight: 800, color: 'var(--accent)' }}>
            {loading ? '—' : `${replyRate}%`}
          </div>
        </div>

        <div className="metric-card">
          <div style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '8px' }}>
            Meetings Booked
          </div>
          <div style={{ fontSize: '36px', fontWeight: 800, color: '#8b5cf6' }}>
            {loading ? '—' : 0}
          </div>
        </div>
      </div>

      {/* Recent Conversations */}
      <div className="glass-card" style={{ padding: '24px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
          <h2 style={{ fontSize: '16px', fontWeight: 700 }}>
            Recent Conversations
          </h2>
          {total > 0 && (
            <Link href="/conversations" style={{
              fontSize: '13px', color: 'var(--accent)', textDecoration: 'none', fontWeight: 500
            }}>
              View all {total} →
            </Link>
          )}
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-muted)', fontSize: '14px' }}>
            Loading conversations...
          </div>
        ) : !linkedInConnected ? (
          <div style={{ textAlign: 'center', padding: '40px 0' }}>
            <p style={{ fontSize: '14px', color: 'var(--text-muted)', marginBottom: '8px' }}>
              Connect your LinkedIn account first
            </p>
            <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
              Use the Connect LinkedIn button above to get started
            </p>
          </div>
        ) : recentConversations.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px 0' }}>
            <p style={{ fontSize: '14px', color: 'var(--text-muted)', marginBottom: '8px' }}>
              No conversations found
            </p>
            <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
              Click &quot;Sync Chats&quot; to pull your LinkedIn conversations
            </p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            {recentConversations.map((conv) => {
              const initials = conv.prospect_name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
              return (
                <Link
                  key={conv.id}
                  href={`/conversations/${conv.id}`}
                  className="conversation-item"
                  style={{ textDecoration: 'none', color: 'inherit' }}
                >
                  <div className="avatar">{initials}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: '14px', marginBottom: '2px' }}>
                      {conv.prospect_name}
                    </div>
                    <div style={{
                      fontSize: '12px', color: 'var(--text-muted)',
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'
                    }}>
                      {conv.last_message_text || conv.prospect_headline || 'No messages yet'}
                    </div>
                  </div>
                  <span style={{ fontSize: '11px', color: 'var(--text-muted)', flexShrink: 0 }}>
                    {timeAgo(conv.last_message_at)}
                  </span>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
