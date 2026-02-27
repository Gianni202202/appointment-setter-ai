'use client';

import { useState } from 'react';
import Link from 'next/link';

interface Conversation {
  id: string;
  prospect_name: string;
  prospect_headline: string;
  prospect_company: string;
  state: string;
  icp_score: number;
  last_message_at: string;
  messages: { role: string; content: string }[];
}

interface FiltersProps {
  conversations: Conversation[];
}

const stateLabels: Record<string, { emoji: string; label: string; class: string }> = {
  new: { emoji: '🆕', label: 'New', class: 'state-new' },
  engaged: { emoji: '💬', label: 'Engaged', class: 'state-engaged' },
  objection: { emoji: '⚡', label: 'Objection', class: 'state-objection' },
  qualified: { emoji: '🎯', label: 'Qualified', class: 'state-qualified' },
  booked: { emoji: '��', label: 'Booked', class: 'state-booked' },
  dead: { emoji: '💀', label: 'Dead', class: 'state-dead' },
  handoff: { emoji: '🙋', label: 'Handoff', class: 'state-handoff' },
};

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export default function ConversationFilters({ conversations }: FiltersProps) {
  const [activeFilter, setActiveFilter] = useState('all');

  const filtered = activeFilter === 'all'
    ? conversations
    : conversations.filter(c => c.state === activeFilter);

  return (
    <>
      {/* Filter bar */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '24px', flexWrap: 'wrap' }}>
        {['all', 'new', 'engaged', 'objection', 'qualified', 'booked', 'handoff', 'dead'].map((filter) => (
          <button
            key={filter}
            className="btn-secondary"
            style={{
              padding: '8px 16px', fontSize: '13px', textTransform: 'capitalize',
              background: activeFilter === filter ? 'var(--accent)' : undefined,
              color: activeFilter === filter ? '#fff' : undefined,
              borderColor: activeFilter === filter ? 'var(--accent)' : undefined,
            }}
            onClick={() => setActiveFilter(filter)}
          >
            {filter === 'all' ? `📋 All (${conversations.length})` : `${stateLabels[filter]?.emoji} ${stateLabels[filter]?.label} (${conversations.filter(c => c.state === filter).length})`}
          </button>
        ))}
      </div>

      {/* Filtered Conversations List */}
      <div className="glass-card" style={{ overflow: 'hidden' }}>
        {filtered.length === 0 ? (
          <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-muted)' }}>
            No conversations in this state
          </div>
        ) : (
          filtered.map((conv, i) => {
            const info = stateLabels[conv.state];
            const initials = conv.prospect_name.split(' ').map(n => n[0]).join('').slice(0, 2);
            const lastMsg = conv.messages[conv.messages.length - 1];

            return (
              <Link
                key={conv.id}
                href={`/conversations/${conv.id}`}
                style={{ textDecoration: 'none', color: 'inherit' }}
              >
                <div
                  className="conversation-item"
                  style={{
                    borderBottom: i < filtered.length - 1 ? '1px solid var(--border)' : 'none',
                    borderRadius: 0, padding: '20px 24px',
                  }}
                >
                  <div className="avatar">{initials}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '4px' }}>
                      <span style={{ fontWeight: 600, fontSize: '15px' }}>{conv.prospect_name}</span>
                      <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{conv.prospect_company}</span>
                    </div>
                    <div style={{ fontSize: '13px', color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: '4px' }}>
                      {conv.prospect_headline}
                    </div>
                    {lastMsg && (
                      <div style={{ fontSize: '12px', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {lastMsg.role === 'prospect' ? '← ' : '→ '}
                        {lastMsg.content.slice(0, 80)}...
                      </div>
                    )}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '8px' }}>
                    <span className={`state-badge ${info?.class}`}>{info?.emoji} {info?.label}</span>
                    <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{timeAgo(conv.last_message_at)}</span>
                    <div style={{
                      fontSize: '11px', padding: '2px 8px', borderRadius: '6px',
                      background: conv.icp_score >= 80 ? 'rgba(16, 185, 129, 0.15)' : conv.icp_score >= 50 ? 'rgba(245, 158, 11, 0.15)' : 'rgba(107, 114, 128, 0.15)',
                      color: conv.icp_score >= 80 ? '#34d399' : conv.icp_score >= 50 ? '#fbbf24' : '#9ca3af',
                      fontWeight: 600,
                    }}>
                      ICP {conv.icp_score}%
                    </div>
                  </div>
                </div>
              </Link>
            );
          })
        )}
      </div>
    </>
  );
}
