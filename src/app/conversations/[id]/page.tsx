import { getConversation } from '@/lib/database';
import Link from 'next/link';
import { notFound } from 'next/navigation';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function ConversationDetailPage({ params }: PageProps) {
  const { id } = await params;
  const conversation = getConversation(id);

  if (!conversation) {
    notFound();
  }

  const stateLabels: Record<string, { emoji: string; label: string; class: string }> = {
    new: { emoji: '🆕', label: 'New', class: 'state-new' },
    engaged: { emoji: '💬', label: 'Engaged', class: 'state-engaged' },
    objection: { emoji: '⚡', label: 'Objection', class: 'state-objection' },
    qualified: { emoji: '🎯', label: 'Qualified', class: 'state-qualified' },
    booked: { emoji: '📅', label: 'Booked', class: 'state-booked' },
    dead: { emoji: '💀', label: 'Dead', class: 'state-dead' },
    handoff: { emoji: '🙋', label: 'Handoff', class: 'state-handoff' },
  };

  const info = stateLabels[conversation.state];
  const initials = conversation.prospect_name.split(' ').map((n: string) => n[0]).join('').slice(0, 2);

  function formatTime(dateStr: string): string {
    const d = new Date(dateStr);
    return d.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' });
  }

  function formatDate(dateStr: string): string {
    const d = new Date(dateStr);
    return d.toLocaleDateString('nl-NL', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  return (
    <div style={{ display: 'flex', gap: '24px', height: 'calc(100vh - 64px)' }}>
      {/* Chat area */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        {/* Chat header */}
        <div className="glass-card" style={{
          padding: '16px 24px',
          borderRadius: '16px 16px 0 0',
          display: 'flex', alignItems: 'center', gap: '16px',
          borderBottom: '1px solid var(--border)',
        }}>
          <Link href="/conversations" style={{ color: 'var(--text-muted)', textDecoration: 'none', fontSize: '20px' }}>
            ←
          </Link>
          <div className="avatar">{initials}</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: '16px' }}>
              {conversation.prospect_name}
            </div>
            <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
              {conversation.prospect_headline}
            </div>
          </div>
          <span className={`state-badge ${info?.class}`}>
            {info?.emoji} {info?.label}
          </span>
          <div style={{
            fontSize: '11px', padding: '4px 10px', borderRadius: '8px',
            background: conversation.icp_score >= 80 ? 'rgba(16, 185, 129, 0.15)' : 'rgba(245, 158, 11, 0.15)',
            color: conversation.icp_score >= 80 ? '#34d399' : '#fbbf24',
            fontWeight: 600
          }}>
            ICP {conversation.icp_score}%
          </div>
        </div>

        {/* Messages */}
        <div style={{
          flex: 1, overflowY: 'auto', padding: '24px',
          background: 'var(--bg-primary)',
          display: 'flex', flexDirection: 'column', gap: '16px',
        }}>
          {conversation.messages.map((msg) => (
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
          />
          <button className="btn-primary" style={{ whiteSpace: 'nowrap' }}>
            Send ↗
          </button>
          <button className="btn-secondary" style={{ whiteSpace: 'nowrap', fontSize: '13px' }}>
            🤖 Let AI Respond
          </button>
        </div>
      </div>

      {/* Sidebar info */}
      <div style={{ width: '280px', flexShrink: 0 }}>
        <div className="glass-card" style={{ padding: '24px' }}>
          <h3 style={{ fontSize: '14px', fontWeight: 700, marginBottom: '20px', color: 'var(--text-secondary)' }}>
            PROSPECT INFO
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '4px' }}>Name</div>
              <div style={{ fontSize: '14px', fontWeight: 500 }}>{conversation.prospect_name}</div>
            </div>
            <div>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '4px' }}>Headline</div>
              <div style={{ fontSize: '13px' }}>{conversation.prospect_headline}</div>
            </div>
            <div>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '4px' }}>Company</div>
              <div style={{ fontSize: '14px', fontWeight: 500 }}>{conversation.prospect_company}</div>
            </div>
            <div>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '4px' }}>ICP Score</div>
              <div style={{
                fontSize: '24px', fontWeight: 800,
                color: conversation.icp_score >= 80 ? 'var(--success)' : conversation.icp_score >= 50 ? 'var(--warning)' : 'var(--text-muted)'
              }}>
                {conversation.icp_score}%
              </div>
            </div>
            <div>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '4px' }}>State</div>
              <span className={`state-badge ${info?.class}`}>
                {info?.emoji} {info?.label}
              </span>
            </div>
            <div>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '4px' }}>Auto-respond</div>
              <div style={{
                display: 'inline-flex', alignItems: 'center', gap: '6px',
                fontSize: '13px', fontWeight: 600,
                color: conversation.auto_respond ? 'var(--success)' : 'var(--text-muted)'
              }}>
                {conversation.auto_respond ? '✅ Enabled' : '⏸️ Paused'}
              </div>
            </div>
            <div>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '4px' }}>Created</div>
              <div style={{ fontSize: '13px' }}>{formatDate(conversation.created_at)}</div>
            </div>
          </div>
        </div>

        {/* Quick Actions */}
        <div className="glass-card" style={{ padding: '24px', marginTop: '16px' }}>
          <h3 style={{ fontSize: '14px', fontWeight: 700, marginBottom: '16px', color: 'var(--text-secondary)' }}>
            QUICK ACTIONS
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <button className="btn-secondary" style={{ width: '100%', fontSize: '13px', textAlign: 'left' }}>
              🤖 Generate AI Response
            </button>
            <button className="btn-secondary" style={{ width: '100%', fontSize: '13px', textAlign: 'left' }}>
              �� Take Over (Handoff)
            </button>
            <button className="btn-secondary" style={{ width: '100%', fontSize: '13px', textAlign: 'left' }}>
              📅 Mark as Booked
            </button>
            <button className="btn-secondary" style={{ width: '100%', fontSize: '13px', textAlign: 'left', color: 'var(--danger)' }}>
              💀 Mark as Dead
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
