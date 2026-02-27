'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';

interface Conversation {
  id: string;
  prospect_name: string;
  prospect_headline: string;
  last_message_at: string;
  last_message_text: string;
  message_count: number;
}

export default function Dashboard() {
  const [agentEnabled, setAgentEnabled] = useState(false);
  const [linkedInStatus, setLinkedInStatus] = useState<any>({ connected: false });
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState('');
  const router = useRouter();

  useEffect(() => {
    loadAll();
  }, []);

  async function loadAll() {
    setLoading(true);
    try {
      const [agentRes, statusRes, convRes] = await Promise.all([
        fetch('/api/agent/toggle'),
        fetch('/api/unipile/status'),
        fetch('/api/conversations'),
      ]);

      if (agentRes.ok) {
        const d = await agentRes.json();
        setAgentEnabled(d.enabled);
      }
      if (statusRes.ok) {
        setLinkedInStatus(await statusRes.json());
      }
      if (convRes.ok) {
        setConversations(await convRes.json());
      }
    } catch (err) {
      console.error('Dashboard load error:', err);
    } finally {
      setLoading(false);
    }
  }

  async function toggleAgent() {
    try {
      const res = await fetch('/api/agent/toggle', { method: 'PUT' });
      if (res.ok) {
        const d = await res.json();
        setAgentEnabled(d.enabled);
      }
    } catch (err) {
      console.error('Toggle failed:', err);
    }
  }

  async function syncChats() {
    if (syncing) return;
    setSyncing(true);
    setSyncResult('');
    try {
      const res = await fetch('/api/unipile/sync', { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        setSyncResult(`✓ Synced ${data.synced_count} conversations`);
        // Reload conversations
        const convRes = await fetch('/api/conversations');
        if (convRes.ok) setConversations(await convRes.json());
      } else {
        const err = await res.json();
        setSyncResult(`✕ Sync failed: ${err.error}`);
      }
    } catch (err) {
      setSyncResult(`✕ Error: ${err}`);
    } finally {
      setSyncing(false);
      setTimeout(() => setSyncResult(''), 5000);
    }
  }

  // Compute real metrics
  const totalConversations = conversations.length;
  const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const recentConversations = conversations.filter(c => new Date(c.last_message_at) > oneWeekAgo);
  const withMessages = conversations.filter(c => c.message_count > 0);
  const activeRate = totalConversations > 0
    ? Math.round((withMessages.length / totalConversations) * 100)
    : 0;

  function timeAgo(dateStr: string): string {
    if (!dateStr) return '';
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);
    if (mins < 60) return `${mins}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days < 7) return `${days}d ago`;
    return new Date(dateStr).toLocaleDateString('nl-NL', { day: 'numeric', month: 'short' });
  }

  function getInitials(name: string): string {
    return name.split(' ').map(w => w[0]).join('').substring(0, 2).toUpperCase();
  }

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '80vh', flexDirection: 'column', gap: '12px' }}>
        <div className="pulse-live" style={{ width: '24px', height: '24px', borderRadius: '50%', background: 'var(--accent)' }} />
        <span style={{ color: 'var(--text-muted)', fontSize: '14px' }}>Loading dashboard...</span>
      </div>
    );
  }

  return (
    <div style={{ padding: '32px', maxWidth: '1100px' }}>
      <h1 style={{ fontSize: '24px', fontWeight: 700 }}>Dashboard</h1>
      <p style={{ fontSize: '14px', color: 'var(--text-muted)', marginTop: '4px' }}>
        Your AI-powered LinkedIn DM assistant
      </p>

      {/* Agent + LinkedIn Status */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginTop: '24px' }}>
        {/* Agent toggle */}
        <div className="glass-card" style={{
          padding: '20px',
          borderLeft: `3px solid ${agentEnabled ? 'var(--success)' : 'var(--danger)'}`,
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <div className={agentEnabled ? 'pulse-live' : ''} style={{
                  width: '10px', height: '10px', borderRadius: '50%',
                  background: agentEnabled ? 'var(--success)' : 'var(--danger)',
                }} />
                <span style={{ fontWeight: 600, fontSize: '16px' }}>
                  AI Agent — {agentEnabled ? 'Active' : 'Paused'}
                </span>
              </div>
              <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '4px' }}>
                {agentEnabled
                  ? 'Agent will suggest responses for incoming messages.'
                  : 'Agent is paused. No automatic responses will be generated.'}
              </p>
            </div>
            <label style={{ position: 'relative', display: 'inline-block', width: '48px', height: '26px', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={agentEnabled}
                onChange={toggleAgent}
                style={{ opacity: 0, width: 0, height: 0 }}
              />
              <span style={{
                position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
                background: agentEnabled ? 'var(--success)' : 'rgba(255,255,255,0.1)',
                borderRadius: '13px', transition: 'all 0.3s',
              }}>
                <span style={{
                  position: 'absolute', left: agentEnabled ? '24px' : '3px', top: '3px',
                  width: '20px', height: '20px', borderRadius: '50%',
                  background: '#fff', transition: 'left 0.3s',
                }} />
              </span>
            </label>
          </div>
        </div>

        {/* LinkedIn status */}
        <div className="glass-card" style={{
          padding: '20px',
          borderLeft: `3px solid ${linkedInStatus.connected ? 'var(--success)' : 'var(--warning)'}`,
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '18px' }}>in</span>
                <span style={{ fontWeight: 600, fontSize: '16px' }}>
                  LinkedIn — {linkedInStatus.connected ? 'Connected' : 'Not Connected'}
                </span>
              </div>
              {linkedInStatus.connected && (
                <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '4px' }}>
                  Account: {linkedInStatus.name} • ID: {linkedInStatus.account_id}
                </p>
              )}
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button className="btn-secondary" onClick={loadAll} style={{ fontSize: '12px' }}>🔄</button>
              <button
                className="btn-primary"
                onClick={syncChats}
                disabled={syncing || !linkedInStatus.connected}
                style={{ fontSize: '12px', opacity: (syncing || !linkedInStatus.connected) ? 0.5 : 1 }}
              >
                {syncing ? '⏳ Syncing...' : '📥 Sync Chats'}
              </button>
            </div>
          </div>
          {syncResult && (
            <div style={{
              marginTop: '8px', fontSize: '12px', padding: '6px 10px', borderRadius: '6px',
              background: syncResult.startsWith('✓') ? 'rgba(16,185,129,0.1)' : 'rgba(239,68,68,0.1)',
              color: syncResult.startsWith('✓') ? 'var(--success)' : 'var(--danger)',
            }}>
              {syncResult}
            </div>
          )}
        </div>
      </div>

      {/* Metrics */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px', marginTop: '20px' }}>
        {[
          { label: 'Total Conversations', value: totalConversations, color: 'var(--accent)' },
          { label: 'Active (7 days)', value: recentConversations.length, color: 'var(--success)' },
          { label: 'With Messages', value: withMessages.length, color: '#8B5CF6' },
          { label: 'Response Rate', value: `${activeRate}%`, color: '#F59E0B' },
        ].map((metric) => (
          <div key={metric.label} className="glass-card" style={{ padding: '20px', textAlign: 'center' }}>
            <div style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              {metric.label}
            </div>
            <div style={{ fontSize: '28px', fontWeight: 700, color: metric.color, marginTop: '8px' }}>
              {metric.value}
            </div>
          </div>
        ))}
      </div>

      {/* Recent conversations with actions */}
      <div style={{ marginTop: '28px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <h2 style={{ fontSize: '18px', fontWeight: 600 }}>Recent Conversations</h2>
          <button
            className="btn-secondary"
            onClick={() => router.push('/conversations')}
            style={{ fontSize: '13px' }}
          >
            View all {totalConversations} →
          </button>
        </div>

        {conversations.length === 0 ? (
          <div className="glass-card" style={{ padding: '48px', textAlign: 'center' }}>
            <p style={{ fontSize: '18px', marginBottom: '8px' }}>No conversations yet</p>
            <p style={{ fontSize: '14px', color: 'var(--text-muted)' }}>
              Connect your LinkedIn account and sync your chats to get started.
            </p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            {conversations.slice(0, 8).map((conv) => (
              <div
                key={conv.id}
                className="glass-card"
                onClick={() => router.push(`/conversations/${conv.id}`)}
                style={{
                  padding: '14px 18px', borderRadius: '8px',
                  cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '14px',
                  transition: 'all 0.15s',
                }}
                onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.04)'}
                onMouseLeave={(e) => e.currentTarget.style.background = ''}
              >
                <div className="avatar" style={{ width: '38px', height: '38px', fontSize: '13px', flexShrink: 0 }}>
                  {getInitials(conv.prospect_name)}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: '14px' }}>{conv.prospect_name}</div>
                  {conv.last_message_text ? (
                    <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {conv.last_message_text.substring(0, 80)}
                    </div>
                  ) : (
                    <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '2px', fontStyle: 'italic' }}>
                      {conv.message_count > 0 ? `${conv.message_count} messages` : 'No messages yet'}
                    </div>
                  )}
                </div>
                <div style={{ fontSize: '12px', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                  {timeAgo(conv.last_message_at)}
                </div>
                <span style={{ color: 'var(--text-muted)' }}>→</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
