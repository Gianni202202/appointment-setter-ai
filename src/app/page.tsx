'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';

interface Conversation {
  id: string;
  prospect_name: string;
  prospect_headline: string;
  last_message_at: string;
  last_message_text: string;
  message_count: number;
}

interface DraftMessage {
  id: string;
  chat_id: string;
  prospect_name: string;
  message: string;
  reasoning: string;
  phase?: string;
  created_at: string;
  status: string;
  scheduled_send_at?: string;
}

type AgentMode = 'auto' | 'copilot' | 'off';

export default function Dashboard() {
  const [mode, setMode] = useState<AgentMode>('off');
  const [linkedInStatus, setLinkedInStatus] = useState<any>({ connected: false });
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [drafts, setDrafts] = useState<DraftMessage[]>([]);
  const [draftCounts, setDraftCounts] = useState({ pending: 0, approved: 0, sent: 0, rejected: 0 });
  const [sentToday, setSentToday] = useState(0);
  const [maxDaily, setMaxDaily] = useState(15);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState('');
  const [sendingBatch, setSendingBatch] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scanResult, setScanResult] = useState('');
  const [selectedDrafts, setSelectedDrafts] = useState<Set<string>>(new Set());
  const router = useRouter();

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [modeRes, statusRes, convRes, queueRes] = await Promise.all([
        fetch('/api/agent/mode'),
        fetch('/api/unipile/status'),
        fetch('/api/conversations'),
        fetch('/api/agent/queue'),
      ]);
      if (modeRes.ok) { const d = await modeRes.json(); setMode(d.mode || 'off'); }
      if (statusRes.ok) { setLinkedInStatus(await statusRes.json()); }
      if (convRes.ok) { setConversations(await convRes.json()); }
      if (queueRes.ok) {
        const q = await queueRes.json();
        setDrafts(q.drafts || []);
        setDraftCounts(q.counts || { pending: 0, approved: 0, sent: 0, rejected: 0 });
        setSentToday(q.sent_today || 0);
        setMaxDaily(q.max_daily || 15);
      }
    } catch (err) { console.error('Dashboard load error:', err); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  // Auto-refresh drafts every 15 seconds when in copilot mode
  useEffect(() => {
    if (mode !== 'copilot') return;
    const interval = setInterval(async () => {
      try {
        const queueRes = await fetch('/api/agent/queue');
        if (queueRes.ok) {
          const q = await queueRes.json();
          setDrafts(q.drafts || []);
          setDraftCounts(q.counts || { pending: 0, approved: 0, sent: 0, rejected: 0 });
          setSentToday(q.sent_today || 0);
        }
      } catch {}
    }, 15000);
    return () => clearInterval(interval);
  }, [mode]);

  async function changeMode(newMode: AgentMode) {
    if (newMode === 'auto') {
      const ok = confirm(
        '⚠️ FULL AUTO MODE\n\n' +
        'The agent will automatically respond to incoming messages.\n\n' +
        'Safety measures active:\n' +
        '• Quality gate checks every message\n' +
        '• Phase-aware timing (5min - 12h delays)\n' +
        '• Dynamic daily capacity\n' +
        '• Working hours only (8:30-18:30 CET)\n' +
        '• Unsafe messages flagged for review\n' +
        '• Style mirroring & warmth curve active\n\n' +
        'Activate Auto Mode?'
      );
      if (!ok) return;
    }
    try {
      const res = await fetch('/api/agent/mode', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: newMode }),
      });
      if (res.ok) {
        const d = await res.json();
        setMode(d.mode);
        // Force sidebar to re-read mode
        window.dispatchEvent(new CustomEvent('agent-mode-changed', { detail: d.mode }));
      }
    } catch (err) { console.error('Mode change failed:', err); }
  }

  async function syncChats() {
    if (syncing) return;
    setSyncing(true); setSyncResult('');
    try {
      const res = await fetch('/api/unipile/sync', { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        setSyncResult(`✓ Synced ${data.synced_count} conversations`);
        const convRes = await fetch('/api/conversations');
        if (convRes.ok) setConversations(await convRes.json());
      } else {
        const err = await res.json();
        setSyncResult(`✕ ${err.error}`);
      }
    } catch (err) { setSyncResult(`✕ Error: ${err}`); }
    finally { setSyncing(false); setTimeout(() => setSyncResult(''), 5000); }
  }

  async function runCopilotScan() {
    if (scanning) return;
    setScanning(true); setScanResult('Scanning conversations...');
    try {
      const res = await fetch('/api/agent/copilot-scan', { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        setScanResult(`✓ Scanned ${data.scanned} chats, created ${data.drafts_created} drafts`);
        loadAll(); // Refresh everything
      } else {
        const err = await res.json();
        setScanResult(`✕ ${err.error}`);
      }
    } catch (err) { setScanResult(`✕ Error: ${err}`); }
    finally { setScanning(false); setTimeout(() => setScanResult(''), 8000); }
  }

  async function handleDraftAction(draftId: string, action: 'approve' | 'reject') {
    try {
      await fetch('/api/agent/queue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ draft_id: draftId, action }),
      });
      if (action === 'approve') {
        setSelectedDrafts(prev => { const next = new Set(prev); next.add(draftId); return next; });
      }
      loadAll();
    } catch (err) { console.error('Draft action failed:', err); }
  }

  async function sendApproved() {
    setSendingBatch(true);
    try {
      const approvedIds = drafts.filter(d => d.status === 'approved').map(d => d.id);
      if (approvedIds.length === 0) { alert('No approved drafts to send.'); return; }
      const res = await fetch('/api/agent/queue', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ draft_ids: approvedIds }),
      });
      if (res.ok) {
        const data = await res.json();
        alert(`✓ ${data.scheduled_count} messages scheduled with human-like timing\n\nEach will be sent at staggered intervals with phase-aware delays.`);
        loadAll();
      } else {
        const err = await res.json();
        alert(`✕ ${err.error}`);
      }
    } catch (err) { alert(`Error: ${err}`); }
    finally { setSendingBatch(false); }
  }

  const totalConversations = conversations.length;
  const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const recentConversations = conversations.filter(c => new Date(c.last_message_at) > oneWeekAgo);
  const withMessages = conversations.filter(c => c.message_count > 0);
  const activeRate = totalConversations > 0 ? Math.round((withMessages.length / totalConversations) * 100) : 0;

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

  const phaseEmoji: Record<string, string> = {
    koud: '❄️', lauw: '🌤', warm: '🔥', proof: '📹', call: '📞', weerstand: '🛡️',
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '80vh', flexDirection: 'column', gap: '12px' }}>
        <div className="pulse-live" style={{ width: '24px', height: '24px', borderRadius: '50%', background: 'var(--accent)' }} />
        <span style={{ color: 'var(--text-muted)', fontSize: '14px' }}>Loading dashboard...</span>
      </div>
    );
  }

  const pendingDrafts = drafts.filter(d => d.status === 'pending');
  const approvedDrafts = drafts.filter(d => d.status === 'approved');

  return (
    <div style={{ maxWidth: '1100px' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '16px', marginBottom: '24px' }}>
        <div>
          <h1 style={{ fontSize: '24px', fontWeight: 700 }}>Dashboard</h1>
          <p style={{ fontSize: '14px', color: 'var(--text-muted)', marginTop: '4px' }}>
            AI-powered LinkedIn DM appointment setter
          </p>
        </div>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <button className="btn-secondary" onClick={loadAll} style={{ fontSize: '13px', padding: '8px 14px' }}>
            🔄 Refresh
          </button>
          <button
            className="btn-primary"
            onClick={syncChats}
            disabled={syncing || !linkedInStatus.connected}
            style={{ fontSize: '13px', padding: '8px 14px', opacity: (syncing || !linkedInStatus.connected) ? 0.5 : 1 }}
          >
            {syncing ? '⏳ Syncing...' : '📥 Sync Chats'}
          </button>
        </div>
      </div>

      {syncResult && (
        <div style={{
          marginBottom: '16px', fontSize: '13px', padding: '10px 16px', borderRadius: '10px',
          background: syncResult.startsWith('✓') ? 'rgba(16,185,129,0.1)' : 'rgba(239,68,68,0.1)',
          color: syncResult.startsWith('✓') ? 'var(--success)' : 'var(--danger)',
        }}>
          {syncResult}
        </div>
      )}

      {scanResult && (
        <div style={{
          marginBottom: '16px', fontSize: '13px', padding: '10px 16px', borderRadius: '10px',
          background: scanResult.startsWith('✓') ? 'rgba(16,185,129,0.1)' : scanResult.startsWith('Scan') ? 'rgba(59,130,246,0.1)' : 'rgba(239,68,68,0.1)',
          color: scanResult.startsWith('✓') ? 'var(--success)' : scanResult.startsWith('Scan') ? 'var(--accent)' : 'var(--danger)',
        }}>
          {scanning && '⏳ '}{scanResult}
        </div>
      )}

      {/* Mode Selector */}
      <div className="glass-card" style={{ padding: '20px', marginBottom: '20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
          <div>
            <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              Agent Mode
            </div>
            <div className="mode-selector">
              <button
                className={`mode-pill ${mode === 'off' ? 'active-off' : ''}`}
                onClick={() => changeMode('off')}
              >
                ⏸ Off
              </button>
              <button
                className={`mode-pill ${mode === 'copilot' ? 'active-copilot' : ''}`}
                onClick={() => changeMode('copilot')}
              >
                👤 Copilot
                {draftCounts.pending > 0 && <span className="badge badge-warning">{draftCounts.pending}</span>}
              </button>
              <button
                className={`mode-pill ${mode === 'auto' ? 'active-auto' : ''}`}
                onClick={() => changeMode('auto')}
              >
                🤖 Auto
              </button>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            {mode === 'copilot' && (
              <button
                className="btn-primary"
                onClick={runCopilotScan}
                disabled={scanning || !linkedInStatus.connected}
                style={{ fontSize: '13px', padding: '8px 16px', opacity: (scanning || !linkedInStatus.connected) ? 0.5 : 1 }}
              >
                {scanning ? '⏳ Scanning...' : '🔍 Scan All Chats'}
              </button>
            )}
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Sent today</div>
              <div style={{ fontSize: '18px', fontWeight: 700, color: sentToday >= maxDaily ? 'var(--danger)' : 'var(--text-primary)' }}>
                {sentToday}/{maxDaily}
              </div>
            </div>
            <div style={{
              width: '10px', height: '10px', borderRadius: '50%',
              background: linkedInStatus.connected ? 'var(--success)' : 'var(--danger)',
            }} className={linkedInStatus.connected ? 'pulse-live' : ''} title={linkedInStatus.connected ? 'LinkedIn Connected' : 'LinkedIn Disconnected'} />
          </div>
        </div>

        {/* Legendary features indicator */}
        {mode !== 'off' && (
          <div style={{ marginTop: '12px', display: 'flex', gap: '6px', flexWrap: 'wrap', fontSize: '11px' }}>
            {['Style Mirror', 'Warmth Curve', 'Phase-Aware Timing', 'Cross-Chat Stagger', 'Read Delay', 'Message Variance'].map(feat => (
              <span key={feat} style={{
                padding: '3px 8px', borderRadius: '6px',
                background: 'rgba(16,185,129,0.1)', color: 'var(--success)',
                border: '1px solid rgba(16,185,129,0.2)',
              }}>✓ {feat}</span>
            ))}
            <span style={{
              padding: '3px 8px', borderRadius: '6px',
              background: 'rgba(59,130,246,0.1)', color: 'var(--accent)',
              border: '1px solid rgba(59,130,246,0.2)',
            }}>🧠 Claude Opus 4</span>
          </div>
        )}
      </div>

      {/* Metrics */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '12px', marginBottom: '20px' }}>
        {[
          { label: 'Total', value: totalConversations, color: 'var(--accent)', icon: '💬' },
          { label: 'Active (7d)', value: recentConversations.length, color: 'var(--success)', icon: '🟢' },
          { label: 'With Messages', value: withMessages.length, color: '#8B5CF6', icon: '📨' },
          { label: 'Response Rate', value: `${activeRate}%`, color: '#F59E0B', icon: '📊' },
        ].map((m) => (
          <div key={m.label} className="glass-card" style={{ padding: '16px', textAlign: 'center' }}>
            <div style={{ fontSize: '18px', marginBottom: '4px' }}>{m.icon}</div>
            <div style={{ fontSize: '24px', fontWeight: 700, color: m.color }}>{m.value}</div>
            <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>{m.label}</div>
          </div>
        ))}
      </div>

      {/* Copilot Queue */}
      {(mode === 'copilot' || pendingDrafts.length > 0 || approvedDrafts.length > 0) && (
        <div style={{ marginBottom: '24px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', flexWrap: 'wrap', gap: '8px' }}>
            <div>
              <h2 style={{ fontSize: '18px', fontWeight: 600 }}>
                📋 Copilot Queue
                {pendingDrafts.length > 0 && <span className="badge badge-warning" style={{ marginLeft: '8px' }}>{pendingDrafts.length}</span>}
              </h2>
              <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '2px' }}>
                Review drafts, approve individually, then batch-send with human timing
              </p>
            </div>
            {approvedDrafts.length > 0 && (
              <button
                className="btn-success"
                onClick={sendApproved}
                disabled={sendingBatch}
                style={{ fontSize: '13px', padding: '10px 20px' }}
              >
                {sendingBatch ? '⏳ Scheduling...' : `🚀 Send ${approvedDrafts.length} Approved`}
              </button>
            )}
          </div>

          {pendingDrafts.length === 0 && approvedDrafts.length === 0 ? (
            <div className="glass-card" style={{ padding: '32px', textAlign: 'center' }}>
              <p style={{ color: 'var(--text-muted)', fontSize: '14px', marginBottom: '12px' }}>
                {mode === 'copilot' ? 'No pending drafts. Click "Scan All Chats" to generate drafts for conversations with unread messages.' : 'Queue is empty.'}
              </p>
              {mode === 'copilot' && (
                <button
                  className="btn-primary"
                  onClick={runCopilotScan}
                  disabled={scanning || !linkedInStatus.connected}
                  style={{ fontSize: '13px', padding: '10px 20px' }}
                >
                  {scanning ? '⏳ Scanning...' : '🔍 Scan All Chats for Drafts'}
                </button>
              )}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {[...pendingDrafts, ...approvedDrafts].map((draft) => (
                <div key={draft.id} className={`draft-card ${draft.status}`}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px', flexWrap: 'wrap' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px', flexWrap: 'wrap' }}>
                        <span style={{ fontWeight: 600, fontSize: '14px' }}>{draft.prospect_name}</span>
                        <span className={`state-badge ${draft.status === 'approved' ? 'state-engaged' : 'state-objection'}`}>
                          {draft.status === 'approved' ? '✓ Approved' : '⏳ Pending'}
                        </span>
                        {draft.phase && (
                          <span style={{
                            fontSize: '11px', padding: '2px 6px', borderRadius: '4px',
                            background: 'rgba(255,255,255,0.05)', color: 'var(--text-muted)',
                          }}>
                            {phaseEmoji[draft.phase] || '📊'} {draft.phase}
                          </span>
                        )}
                      </div>
                      <div style={{
                        fontSize: '13px', color: 'var(--text-secondary)',
                        background: 'rgba(255,255,255,0.03)', borderRadius: '10px',
                        padding: '10px 14px', lineHeight: '1.5',
                      }}>
                        {draft.message}
                      </div>
                      {draft.reasoning && (
                        <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '6px', fontStyle: 'italic' }}>
                          💭 {draft.reasoning}
                        </div>
                      )}
                      {draft.scheduled_send_at && (
                        <div style={{ fontSize: '11px', color: 'var(--success)', marginTop: '4px' }}>
                          ⏰ Scheduled: {new Date(draft.scheduled_send_at).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' })}
                        </div>
                      )}
                    </div>
                    {draft.status === 'pending' && (
                      <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
                        <button
                          className="btn-success"
                          onClick={() => handleDraftAction(draft.id, 'approve')}
                          style={{ padding: '8px 14px', fontSize: '12px' }}
                        >
                          ✓ Approve
                        </button>
                        <button
                          className="btn-danger"
                          onClick={() => handleDraftAction(draft.id, 'reject')}
                          style={{ padding: '8px 14px', fontSize: '12px' }}
                        >
                          ✕ Reject
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Recent Conversations */}
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', flexWrap: 'wrap', gap: '8px' }}>
          <h2 style={{ fontSize: '18px', fontWeight: 600 }}>Recent Conversations</h2>
          <button className="btn-secondary" onClick={() => router.push('/conversations')} style={{ fontSize: '13px', padding: '8px 14px' }}>
            View all {totalConversations} →
          </button>
        </div>

        {conversations.length === 0 ? (
          <div className="glass-card" style={{ padding: '48px', textAlign: 'center' }}>
            <p style={{ fontSize: '18px', marginBottom: '8px' }}>No conversations yet</p>
            <p style={{ fontSize: '14px', color: 'var(--text-muted)' }}>
              Connect LinkedIn and sync your chats to get started.
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
                  padding: '14px 18px', borderRadius: '12px',
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
