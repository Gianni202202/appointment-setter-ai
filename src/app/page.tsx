'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';

type AgentMode = 'auto' | 'copilot' | 'off';

interface ChatItem {
  chat_id: string;
  prospect_name: string;
  last_message_preview: string;
  last_message_at: string;
  has_draft: boolean;
}

interface DraftMessage {
  id: string;
  chat_id: string;
  prospect_name: string;
  prospect_headline?: string;
  message: string;
  reasoning: string;
  phase?: string;
  status: string;
  created_at: string;
  scheduled_send_at?: string;
}

export default function Dashboard() {
  const [mode, setMode] = useState<AgentMode>('off');
  const [linkedInConnected, setLinkedInConnected] = useState(false);
  const [loading, setLoading] = useState(true);

  // Copilot state
  const [chatsNeedingAttention, setChatsNeedingAttention] = useState<ChatItem[]>([]);
  const [selectedChatIds, setSelectedChatIds] = useState<Set<string>>(new Set());
  const [generating, setGenerating] = useState(false);
  const [generatingProgress, setGeneratingProgress] = useState('');

  // Draft queue
  const [drafts, setDrafts] = useState<DraftMessage[]>([]);
  const [sentToday, setSentToday] = useState(0);
  const [maxDaily, setMaxDaily] = useState(15);
  const [sendingBatch, setSendingBatch] = useState(false);

  // Sync
  const [syncing, setSyncing] = useState(false);
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' | 'info' } | null>(null);
  const [loadingChats, setLoadingChats] = useState(false);

  const router = useRouter();

  function showToast(msg: string, type: 'success' | 'error' | 'info' = 'info') {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 5000);
  }

  // Load everything on mount
  const loadAll = useCallback(async () => {
    try {
      const [modeRes, statusRes, queueRes] = await Promise.all([
        fetch('/api/agent/mode'),
        fetch('/api/unipile/status'),
        fetch('/api/agent/queue'),
      ]);
      if (modeRes.ok) { const d = await modeRes.json(); setMode(d.mode || 'off'); }
      if (statusRes.ok) { const d = await statusRes.json(); setLinkedInConnected(d.connected || false); }
      if (queueRes.ok) {
        const q = await queueRes.json();
        setDrafts(q.drafts || []);
        setSentToday(q.sent_today || 0);
        setMaxDaily(q.max_daily || 15);
      }
    } catch (err) { console.error('Load error:', err); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  // Load chats needing attention when in copilot mode
  const loadCopilotChats = useCallback(async () => {
    if (!linkedInConnected) return;
    setLoadingChats(true);
    try {
      const res = await fetch('/api/agent/copilot-scan');
      if (res.ok) {
        const data = await res.json();
        setChatsNeedingAttention(data.needs_attention || []);
      }
    } catch (err) { console.error('Copilot chats load error:', err); }
    finally { setLoadingChats(false); }
  }, [linkedInConnected]);

  // Auto-load copilot chats when entering copilot mode
  useEffect(() => {
    if (mode === 'copilot') loadCopilotChats();
  }, [mode, loadCopilotChats]);

  // Auto-refresh drafts every 15s when active
  useEffect(() => {
    if (mode === 'off') return;
    const interval = setInterval(async () => {
      try {
        const res = await fetch('/api/agent/queue');
        if (res.ok) {
          const q = await res.json();
          setDrafts(q.drafts || []);
          setSentToday(q.sent_today || 0);
        }
      } catch {}
    }, 15000);
    return () => clearInterval(interval);
  }, [mode]);

  async function changeMode(newMode: AgentMode) {
    if (newMode === 'auto') {
      const ok = confirm(
        '⚠️ AUTO MODE\n\nThe agent will automatically respond to messages using human-like timing, style mirroring, and warmth curve.\n\nActivate?'
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
        window.dispatchEvent(new CustomEvent('agent-mode-changed', { detail: d.mode }));
        if (d.mode === 'copilot') showToast('Copilot mode activated — select chats to generate drafts', 'success');
      }
    } catch (err) { showToast('Mode change failed: ' + err, 'error'); }
  }

  function toggleChatSelection(chatId: string) {
    setSelectedChatIds(prev => {
      const next = new Set(prev);
      if (next.has(chatId)) next.delete(chatId);
      else next.add(chatId);
      return next;
    });
  }

  function selectAllChats() {
    setSelectedChatIds(new Set(chatsNeedingAttention.map(c => c.chat_id)));
  }

  function deselectAllChats() {
    setSelectedChatIds(new Set());
  }

  async function generateDraftsForSelected() {
    if (selectedChatIds.size === 0) { showToast('Select at least one chat', 'error'); return; }
    setGenerating(true);
    setGeneratingProgress(`Generating drafts for ${selectedChatIds.size} chats...`);
    try {
      const res = await fetch('/api/agent/copilot-scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_ids: Array.from(selectedChatIds) }),
      });
      if (res.ok) {
        const data = await res.json();
        showToast(`✓ Created ${data.drafts_created} drafts out of ${data.processed} chats`, 'success');
        setSelectedChatIds(new Set());
        // Refresh both lists
        await Promise.all([loadAll(), loadCopilotChats()]);
      } else {
        const err = await res.json();
        showToast('✕ ' + (err.error || 'Generation failed'), 'error');
      }
    } catch (err) { showToast('✕ Error: ' + err, 'error'); }
    finally { setGenerating(false); setGeneratingProgress(''); }
  }

  async function handleDraftAction(draftId: string, action: 'approve' | 'reject') {
    try {
      await fetch('/api/agent/queue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ draft_id: draftId, action }),
      });
      await loadAll();
    } catch (err) { showToast('Action failed: ' + err, 'error'); }
  }

  async function sendApproved() {
    const approvedIds = drafts.filter(d => d.status === 'approved').map(d => d.id);
    if (approvedIds.length === 0) { showToast('No approved drafts to send', 'error'); return; }
    setSendingBatch(true);
    try {
      const res = await fetch('/api/agent/queue', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ draft_ids: approvedIds }),
      });
      if (res.ok) {
        const data = await res.json();
        showToast(`✓ ${data.scheduled_count} messages scheduled with human-like timing`, 'success');
        await loadAll();
      } else {
        const err = await res.json();
        showToast('✕ ' + (err.error || 'Send failed'), 'error');
      }
    } catch (err) { showToast('✕ Error: ' + err, 'error'); }
    finally { setSendingBatch(false); }
  }

  async function syncChats() {
    if (syncing) return;
    setSyncing(true);
    try {
      const res = await fetch('/api/unipile/sync', { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        showToast(`✓ Synced ${data.synced_count} conversations`, 'success');
        if (mode === 'copilot') loadCopilotChats();
      } else {
        const err = await res.json();
        showToast('✕ ' + (err.error || 'Sync failed'), 'error');
      }
    } catch (err) { showToast('✕ Error: ' + err, 'error'); }
    finally { setSyncing(false); }
  }

  function timeAgo(dateStr: string): string {
    if (!dateStr) return '';
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);
    if (mins < 1) return 'just now';
    if (mins < 60) return mins + 'm ago';
    if (hours < 24) return hours + 'h ago';
    if (days < 7) return days + 'd ago';
    return new Date(dateStr).toLocaleDateString('nl-NL', { day: 'numeric', month: 'short' });
  }

  function getInitials(name: string): string {
    return name.split(' ').map(w => w[0]).join('').substring(0, 2).toUpperCase();
  }

  const pendingDrafts = drafts.filter(d => d.status === 'pending');
  const approvedDrafts = drafts.filter(d => d.status === 'approved');
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

  return (
    <div style={{ maxWidth: '1100px' }}>
      {/* Toast notification */}
      {toast && (
        <div style={{
          position: 'fixed', top: '20px', right: '20px', zIndex: 9999,
          padding: '12px 20px', borderRadius: '12px', fontSize: '13px', fontWeight: 500,
          background: toast.type === 'success' ? 'rgba(16,185,129,0.15)' : toast.type === 'error' ? 'rgba(239,68,68,0.15)' : 'rgba(59,130,246,0.15)',
          color: toast.type === 'success' ? '#10b981' : toast.type === 'error' ? '#ef4444' : '#3b82f6',
          border: '1px solid ' + (toast.type === 'success' ? 'rgba(16,185,129,0.3)' : toast.type === 'error' ? 'rgba(239,68,68,0.3)' : 'rgba(59,130,246,0.3)'),
          backdropFilter: 'blur(10px)',
          boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
          maxWidth: '400px',
        }}>
          {toast.msg}
        </div>
      )}

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '16px', marginBottom: '24px' }}>
        <div>
          <h1 style={{ fontSize: '24px', fontWeight: 700 }}>Dashboard</h1>
          <p style={{ fontSize: '14px', color: 'var(--text-muted)', marginTop: '4px' }}>
            AI Appointment Setter — Powered by Claude Opus 4
          </p>
        </div>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <button className="btn-secondary" onClick={loadAll} style={{ fontSize: '13px', padding: '8px 14px' }}>
            🔄 Refresh
          </button>
          <button
            className="btn-primary"
            onClick={syncChats}
            disabled={syncing || !linkedInConnected}
            style={{ fontSize: '13px', padding: '8px 14px', opacity: (syncing || !linkedInConnected) ? 0.5 : 1 }}
          >
            {syncing ? '⏳ Syncing...' : '📥 Sync LinkedIn'}
          </button>
        </div>
      </div>

      {/* Mode Selector */}
      <div className="glass-card" style={{ padding: '20px', marginBottom: '20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
          <div>
            <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '1px' }}>
              Agent Mode
            </div>
            <div className="mode-selector">
              {(['off', 'copilot', 'auto'] as AgentMode[]).map(m => (
                <button
                  key={m}
                  className={`mode-pill ${mode === m ? 'active-' + m : ''}`}
                  onClick={() => changeMode(m)}
                >
                  {m === 'off' && '⏸ Off'}
                  {m === 'copilot' && '👤 Copilot'}
                  {m === 'auto' && '🤖 Auto'}
                  {m === 'copilot' && (pendingDrafts.length > 0) && (
                    <span className="badge badge-warning">{pendingDrafts.length}</span>
                  )}
                </button>
              ))}
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Sent today</div>
              <div style={{ fontSize: '18px', fontWeight: 700, color: sentToday >= maxDaily ? 'var(--danger)' : 'var(--text-primary)' }}>
                {sentToday}/{maxDaily}
              </div>
            </div>
            <div style={{
              width: '10px', height: '10px', borderRadius: '50%',
              background: linkedInConnected ? 'var(--success)' : 'var(--danger)',
            }} className={linkedInConnected ? 'pulse-live' : ''} />
          </div>
        </div>
      </div>

      {/* ==================== COPILOT MODE ==================== */}
      {mode === 'copilot' && (
        <>
          {/* Step 1: Select Chats */}
          <div className="glass-card" style={{ padding: '20px', marginBottom: '16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', flexWrap: 'wrap', gap: '8px' }}>
              <div>
                <h2 style={{ fontSize: '16px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{
                    width: '24px', height: '24px', borderRadius: '50%', display: 'inline-flex',
                    alignItems: 'center', justifyContent: 'center', fontSize: '12px', fontWeight: 700,
                    background: 'rgba(59,130,246,0.2)', color: 'var(--accent)',
                  }}>1</span>
                  Select Chats
                </h2>
                <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '4px', marginLeft: '32px' }}>
                  Conversations where the prospect sent the last message
                </p>
              </div>
              <div style={{ display: 'flex', gap: '6px' }}>
                <button className="btn-secondary" onClick={loadCopilotChats} disabled={loadingChats} style={{ fontSize: '12px', padding: '6px 12px' }}>
                  {loadingChats ? '⏳' : '🔄'} Refresh
                </button>
                {chatsNeedingAttention.length > 0 && (
                  <>
                    <button className="btn-secondary" onClick={selectAllChats} style={{ fontSize: '12px', padding: '6px 12px' }}>
                      Select All ({chatsNeedingAttention.length})
                    </button>
                    {selectedChatIds.size > 0 && (
                      <button className="btn-secondary" onClick={deselectAllChats} style={{ fontSize: '12px', padding: '6px 12px' }}>
                        Deselect
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>

            {loadingChats ? (
              <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '13px' }}>
                ⏳ Scanning conversations...
              </div>
            ) : chatsNeedingAttention.length === 0 ? (
              <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '13px' }}>
                ✓ All caught up! No conversations need a response right now.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', maxHeight: '300px', overflowY: 'auto' }}>
                {chatsNeedingAttention.map(chat => {
                  const isSelected = selectedChatIds.has(chat.chat_id);
                  return (
                    <div
                      key={chat.chat_id}
                      onClick={() => toggleChatSelection(chat.chat_id)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: '12px',
                        padding: '10px 14px', borderRadius: '10px', cursor: 'pointer',
                        background: isSelected ? 'rgba(59,130,246,0.1)' : 'transparent',
                        border: isSelected ? '1px solid rgba(59,130,246,0.3)' : '1px solid transparent',
                        transition: 'all 0.15s',
                      }}
                    >
                      <div style={{
                        width: '20px', height: '20px', borderRadius: '6px', flexShrink: 0,
                        border: isSelected ? '2px solid var(--accent)' : '2px solid var(--border)',
                        background: isSelected ? 'var(--accent)' : 'transparent',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        transition: 'all 0.15s',
                      }}>
                        {isSelected && <span style={{ color: '#fff', fontSize: '11px', fontWeight: 700 }}>✓</span>}
                      </div>
                      <div className="avatar" style={{ width: '32px', height: '32px', fontSize: '11px', flexShrink: 0 }}>
                        {getInitials(chat.prospect_name)}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 600, fontSize: '13px' }}>{chat.prospect_name}</div>
                        <div style={{ fontSize: '11px', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {chat.last_message_preview || 'No preview'}
                        </div>
                      </div>
                      <div style={{ fontSize: '11px', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                        {timeAgo(chat.last_message_at)}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Generate button */}
            {selectedChatIds.size > 0 && (
              <div style={{ marginTop: '12px', display: 'flex', justifyContent: 'flex-end', gap: '8px', alignItems: 'center' }}>
                {generatingProgress && (
                  <span style={{ fontSize: '12px', color: 'var(--accent)' }}>{generatingProgress}</span>
                )}
                <button
                  className="btn-primary"
                  onClick={generateDraftsForSelected}
                  disabled={generating}
                  style={{ fontSize: '13px', padding: '10px 20px' }}
                >
                  {generating ? '⏳ Generating...' : `🤖 Generate ${selectedChatIds.size} Draft${selectedChatIds.size > 1 ? 's' : ''}`}
                </button>
              </div>
            )}
          </div>

          {/* Step 2: Review & Approve Drafts */}
          {(pendingDrafts.length > 0 || approvedDrafts.length > 0) && (
            <div className="glass-card" style={{ padding: '20px', marginBottom: '16px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', flexWrap: 'wrap', gap: '8px' }}>
                <h2 style={{ fontSize: '16px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{
                    width: '24px', height: '24px', borderRadius: '50%', display: 'inline-flex',
                    alignItems: 'center', justifyContent: 'center', fontSize: '12px', fontWeight: 700,
                    background: 'rgba(245,158,11,0.2)', color: '#F59E0B',
                  }}>2</span>
                  Review Drafts
                  {pendingDrafts.length > 0 && <span className="badge badge-warning">{pendingDrafts.length} pending</span>}
                </h2>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {[...pendingDrafts, ...approvedDrafts].map(draft => (
                  <div key={draft.id} style={{
                    padding: '14px', borderRadius: '12px',
                    border: draft.status === 'approved' ? '1px solid rgba(16,185,129,0.3)' : '1px solid var(--border)',
                    background: draft.status === 'approved' ? 'rgba(16,185,129,0.05)' : 'rgba(255,255,255,0.02)',
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px', flexWrap: 'wrap' }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px', flexWrap: 'wrap' }}>
                          <span style={{ fontWeight: 600, fontSize: '14px' }}>{draft.prospect_name}</span>
                          {draft.phase && (
                            <span style={{ fontSize: '11px', padding: '2px 8px', borderRadius: '6px', background: 'rgba(255,255,255,0.05)', color: 'var(--text-muted)' }}>
                              {phaseEmoji[draft.phase] || '📊'} {draft.phase}
                            </span>
                          )}
                          {draft.status === 'approved' && (
                            <span style={{ fontSize: '11px', padding: '2px 8px', borderRadius: '6px', background: 'rgba(16,185,129,0.1)', color: 'var(--success)' }}>
                              ✓ Approved
                            </span>
                          )}
                        </div>
                        <div style={{
                          fontSize: '13px', color: 'var(--text-secondary)', lineHeight: '1.6',
                          padding: '10px 14px', borderRadius: '10px',
                          background: 'rgba(255,255,255,0.03)',
                          whiteSpace: 'pre-wrap',
                        }}>
                          {draft.message}
                        </div>
                        {draft.reasoning && (
                          <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '6px', fontStyle: 'italic' }}>
                            💭 {draft.reasoning.substring(0, 200)}{draft.reasoning.length > 200 ? '...' : ''}
                          </div>
                        )}
                        {draft.scheduled_send_at && (
                          <div style={{ fontSize: '11px', color: 'var(--success)', marginTop: '4px' }}>
                            ⏰ Scheduled: {new Date(draft.scheduled_send_at).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' })}
                          </div>
                        )}
                      </div>
                      {draft.status === 'pending' && (
                        <div style={{ display: 'flex', gap: '6px', flexShrink: 0, flexDirection: 'column' }}>
                          <button
                            className="btn-success"
                            onClick={() => handleDraftAction(draft.id, 'approve')}
                            style={{ padding: '8px 16px', fontSize: '12px' }}
                          >
                            ✓ Approve
                          </button>
                          <button
                            className="btn-danger"
                            onClick={() => handleDraftAction(draft.id, 'reject')}
                            style={{ padding: '8px 16px', fontSize: '12px' }}
                          >
                            ✕ Reject
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Step 3: Send Approved */}
          {approvedDrafts.length > 0 && (
            <div className="glass-card" style={{ padding: '20px', marginBottom: '20px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
                <h2 style={{ fontSize: '16px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{
                    width: '24px', height: '24px', borderRadius: '50%', display: 'inline-flex',
                    alignItems: 'center', justifyContent: 'center', fontSize: '12px', fontWeight: 700,
                    background: 'rgba(16,185,129,0.2)', color: 'var(--success)',
                  }}>3</span>
                  Send with Human Timing
                </h2>
                <button
                  className="btn-success"
                  onClick={sendApproved}
                  disabled={sendingBatch}
                  style={{ fontSize: '13px', padding: '10px 24px' }}
                >
                  {sendingBatch ? '⏳ Scheduling...' : `🚀 Send ${approvedDrafts.length} Approved`}
                </button>
              </div>
              <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '6px', marginLeft: '32px' }}>
                Messages will be staggered with phase-aware delays, cross-chat gaps, and read receipts to mimic human behavior.
              </p>
            </div>
          )}
        </>
      )}

      {/* ==================== AUTO MODE ==================== */}
      {mode === 'auto' && (
        <div className="glass-card" style={{ padding: '20px', marginBottom: '20px', border: '1px solid rgba(16,185,129,0.3)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
            <div className="pulse-live" style={{ width: '10px', height: '10px', borderRadius: '50%', background: 'var(--success)' }} />
            <h2 style={{ fontSize: '16px', fontWeight: 600 }}>Auto Mode Active</h2>
          </div>
          <p style={{ fontSize: '13px', color: 'var(--text-secondary)', lineHeight: '1.5' }}>
            The agent is monitoring incoming messages and will respond automatically with human-like timing.
            All responses go through the quality gate before sending.
          </p>
          <div style={{ marginTop: '10px', display: 'flex', gap: '6px', flexWrap: 'wrap', fontSize: '11px' }}>
            {['Style Mirror', 'Warmth Curve', 'Phase Timing', 'Cross-Chat Stagger', 'Read Delay', 'Message Variance', 'Claude Opus 4'].map(feat => (
              <span key={feat} style={{
                padding: '3px 8px', borderRadius: '6px',
                background: 'rgba(16,185,129,0.1)', color: 'var(--success)',
                border: '1px solid rgba(16,185,129,0.2)',
              }}>✓ {feat}</span>
            ))}
          </div>
        </div>
      )}

      {/* ==================== OFF MODE PROMPT ==================== */}
      {mode === 'off' && !loading && (
        <div className="glass-card" style={{ padding: '32px', textAlign: 'center', marginBottom: '20px' }}>
          <div style={{ fontSize: '32px', marginBottom: '12px' }}>⏸</div>
          <h2 style={{ fontSize: '18px', fontWeight: 600, marginBottom: '8px' }}>Agent is Off</h2>
          <p style={{ fontSize: '14px', color: 'var(--text-muted)', marginBottom: '16px' }}>
            Switch to <strong>Copilot</strong> to review drafts before sending, or <strong>Auto</strong> for fully automatic responses.
          </p>
          <div style={{ display: 'flex', gap: '8px', justifyContent: 'center' }}>
            <button className="btn-primary" onClick={() => changeMode('copilot')} style={{ padding: '10px 24px' }}>
              👤 Start Copilot
            </button>
            <button className="btn-secondary" onClick={() => changeMode('auto')} style={{ padding: '10px 24px' }}>
              🤖 Start Auto
            </button>
          </div>
        </div>
      )}

      {/* Recent Conversations (always visible) */}
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
          <h2 style={{ fontSize: '18px', fontWeight: 600 }}>Recent Activity</h2>
          <button className="btn-secondary" onClick={() => router.push('/conversations')} style={{ fontSize: '13px', padding: '8px 14px' }}>
            View All →
          </button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '10px', marginBottom: '12px' }}>
          {[
            { label: 'Sent Today', value: sentToday, color: 'var(--accent)', icon: '📤' },
            { label: 'Pending', value: pendingDrafts.length, color: '#F59E0B', icon: '⏳' },
            { label: 'Approved', value: approvedDrafts.length, color: 'var(--success)', icon: '✓' },
            { label: 'Daily Limit', value: maxDaily, color: 'var(--text-muted)', icon: '📊' },
          ].map(m => (
            <div key={m.label} className="glass-card" style={{ padding: '14px', textAlign: 'center' }}>
              <div style={{ fontSize: '14px', marginBottom: '2px' }}>{m.icon}</div>
              <div style={{ fontSize: '20px', fontWeight: 700, color: m.color }}>{m.value}</div>
              <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginTop: '2px' }}>{m.label}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
