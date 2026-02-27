import { getMetrics, getConversations } from '@/lib/database';

export const dynamic = 'force-dynamic';

export default function Dashboard() {
  const metrics = getMetrics();
  const conversations = getConversations();
  const recentConversations = conversations.slice(0, 5);

  const stateLabels: Record<string, { emoji: string; label: string; class: string }> = {
    new: { emoji: '��', label: 'New', class: 'state-new' },
    engaged: { emoji: '💬', label: 'Engaged', class: 'state-engaged' },
    objection: { emoji: '⚡', label: 'Objection', class: 'state-objection' },
    qualified: { emoji: '🎯', label: 'Qualified', class: 'state-qualified' },
    booked: { emoji: '📅', label: 'Booked', class: 'state-booked' },
    dead: { emoji: '💀', label: 'Dead', class: 'state-dead' },
    handoff: { emoji: '🙋', label: 'Handoff', class: 'state-handoff' },
  };

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: '32px' }}>
        <h1 style={{ fontSize: '28px', fontWeight: 800, marginBottom: '4px' }}>
          Dashboard
        </h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: '14px' }}>
          Overview of your AI appointment setter performance
        </p>
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
            {metrics.total_conversations}
          </div>
        </div>

        <div className="metric-card">
          <div style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '8px' }}>
            Active Conversations
          </div>
          <div style={{ fontSize: '36px', fontWeight: 800, color: 'var(--success)' }}>
            {metrics.active_conversations}
          </div>
        </div>

        <div className="metric-card">
          <div style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '8px' }}>
            Reply Rate
          </div>
          <div style={{ fontSize: '36px', fontWeight: 800, color: 'var(--accent)' }}>
            {metrics.reply_rate}%
          </div>
        </div>

        <div className="metric-card">
          <div style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '8px' }}>
            Meetings Booked
          </div>
          <div style={{ fontSize: '36px', fontWeight: 800, color: '#8b5cf6' }}>
            {metrics.meetings_booked}
          </div>
        </div>
      </div>

      {/* Pipeline / State Distribution */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', marginBottom: '32px' }}>
        <div className="glass-card" style={{ padding: '24px' }}>
          <h2 style={{ fontSize: '16px', fontWeight: 700, marginBottom: '20px' }}>
            Pipeline Overview
          </h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {Object.entries(metrics.conversations_by_state).map(([state, count]) => {
              const info = stateLabels[state];
              const percentage = metrics.total_conversations > 0
                ? (count / metrics.total_conversations) * 100
                : 0;
              return (
                <div key={state}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                    <span className={`state-badge ${info?.class}`}>
                      {info?.emoji} {info?.label}
                    </span>
                    <span style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-secondary)' }}>
                      {count}
                    </span>
                  </div>
                  <div style={{
                    height: '6px',
                    background: 'var(--bg-secondary)',
                    borderRadius: '3px',
                    overflow: 'hidden',
                  }}>
                    <div style={{
                      height: '100%',
                      width: `${percentage}%`,
                      background: 'var(--accent)',
                      borderRadius: '3px',
                      transition: 'width 0.5s ease',
                    }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Recent Conversations */}
        <div className="glass-card" style={{ padding: '24px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
            <h2 style={{ fontSize: '16px', fontWeight: 700 }}>
              Recent Conversations
            </h2>
            <a href="/conversations" style={{
              fontSize: '13px', color: 'var(--accent)', textDecoration: 'none',
              fontWeight: 500
            }}>
              View all →
            </a>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            {recentConversations.map((conv) => {
              const info = stateLabels[conv.state];
              const initials = conv.prospect_name.split(' ').map(n => n[0]).join('').slice(0, 2);
              return (
                <a
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
                      {conv.prospect_headline}
                    </div>
                  </div>
                  <span className={`state-badge ${info?.class}`} style={{ fontSize: '11px' }}>
                    {info?.emoji} {info?.label}
                  </span>
                </a>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
