'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import AgentChat from '@/components/AgentChat';

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
  const [expandedDrafts, setExpandedDrafts] = useState<Record<string, any[]>>({});
  const [loadingConversation, setLoadingConversation] = useState<string | null>(null);

  // Draft queue
  const [drafts, setDrafts] = useState<DraftMessage[]>([]);
  const [sentToday, setSentToday] = useState(0);
  const [maxDaily, setMaxDaily] = useState(15);
  const [sendingBatch, setSendingBatch] = useState(false);

  // Smart Copilot
  const [copilotMode, setCopilotMode] = useState<'manual' | 'autoscan'>('manual');
  const [autoScanning, setAutoScanning] = useState(false);
  const [scanResults, setScanResults] = useState<any[]>([]);
  const [scanLimit, setScanLimit] = useState(50);
  const [scanProgress, setScanProgress] = useState('');
  const [generatingForChat, setGeneratingForChat] = useState<string | null>(null);

  // Sync
  const [syncing, setSyncing] = useState(false);
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' | 'info' } | null>(null);
  const [loadingChats, setLoadingChats] = useState(false);

  const router = useRouter();

  // === DRAFT PERSISTENCE ===
  // Server uses /tmp which Vercel wipes on cold starts.
  // We keep localStorage as backup and merge intelligently.
  function saveDraftsToLocal(d: DraftMessage[]) {
    try { localStorage.setItem('drafts-backup', JSON.stringify(d)); } catch {}
  }
  function loadDraftsFromLocal(): DraftMessage[] {
    try {
      const s = localStorage.getItem('drafts-backup');
      return s ? JSON.parse(s) : [];
    } catch { return []; }
  }
  // Merge server drafts with local backup — keep the most complete set
  function mergeDrafts(serverDrafts: DraftMessage[], localDrafts: DraftMessage[]): DraftMessage[] {
    const byId = new Map<string, DraftMessage>();
    // Local first (as baseline)
    for (const d of localDrafts) byId.set(d.id, d);
    // Server overrides (server is authoritative if it has data)
    for (const d of serverDrafts) byId.set(d.id, d);
    // Filter out rejected/sent (unless sent today)
    const today = new Date().toISOString().split('T')[0];
    return Array.from(byId.values()).filter(d =>
      d.status === 'pending' || d.status === 'approved' ||
      (d.status === 'sent' && (d as any).sent_at?.startsWith(today))
    );
  }
  function smartSetDrafts(serverDrafts: DraftMessage[]) {
    const localDrafts = loadDraftsFromLocal();
    // If server returned empty but we have local data, DON'T overwrite
    // (This means Vercel cold-started and lost /tmp)
    if (serverDrafts.length === 0 && localDrafts.length > 0) {
      console.log('[Drafts] Server returned empty, keeping local backup (' + localDrafts.length + ' drafts)');
      setDrafts(localDrafts);
      return;
    }
    const merged = mergeDrafts(serverDrafts, localDrafts);
    setDrafts(merged);
    saveDraftsToLocal(merged);
  }


  function showToast(msg: string, type: 'success' | 'error' | 'info' = 'info') {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 5000);
  }

  // Load everything on mount
  const loadAll = useCallback(async () => {
    try {
      // Read mode from localStorage (Vercel serverless instances don't share memory)
      const savedMode = typeof window !== 'undefined' ? localStorage.getItem('agent-mode') : null;
      if (savedMode && ['off', 'copilot', 'auto'].includes(savedMode)) {
        setMode(savedMode as AgentMode);
      }

      const [statusRes, queueRes] = await Promise.all([
        fetch('/api/unipile/status'),
        fetch('/api/agent/queue'),
      ]);
      if (statusRes.ok) { const d = await statusRes.json(); setLinkedInConnected(d.connected || false); }

      // Also sync mode to API in background (fire and forget)
      if (savedMode && savedMode !== 'off') {
        fetch('/api/agent/mode', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mode: savedMode }),
        }).catch(() => {});
      }

      if (queueRes.ok) {
        const q = await queueRes.json();
        smartSetDrafts(q.drafts || []);
        setSentToday(q.sent_today || 0);
        setMaxDaily(q.max_daily || 15);
      }
    } catch (err) { console.error('Load error:', err); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  // Load chats for copilot — uses /api/conversations (same API that works on Conversations page)
  const loadCopilotChats = useCallback(async () => {
    setLoadingChats(true);
    try {
      const res = await fetch('/api/conversations');
      if (res.ok) {
        const conversations = await res.json();
        if (Array.isArray(conversations)) {
          // Transform to copilot format with chat selection
          const chatItems: ChatItem[] = conversations.map((c: any) => ({
            chat_id: c.id || c.unipile_chat_id,
            prospect_name: c.prospect_name || 'LinkedIn Contact',
            last_message_preview: (c.last_message_text || '').substring(0, 120),
            last_message_at: c.last_message_at || '',
            has_draft: false,
            is_prospect_last: true, // Show all for selection
            message_count: c.message_count || 0,
          }));
          setChatsNeedingAttention(chatItems);
        }
      }
    } catch (err) { console.error('Copilot chats load error:', err); }
    finally { setLoadingChats(false); }
  }, []);

  // Auto-load copilot chats when entering copilot mode
  useEffect(() => {
    if (mode === 'copilot') loadCopilotChats();
  }, [mode, loadCopilotChats]);

  // Auto-refresh drafts every 15s when active
  // But skip refresh if user just took an action (prevents UI flash)
  useEffect(() => {
    if (mode === 'off') return;
    const interval = setInterval(async () => {
      // Skip if generating or user action was recent
      if (generating || autoScanning) return;
      try {
        const res = await fetch('/api/agent/queue');
        if (res.ok) {
          const q = await res.json();
          smartSetDrafts(q.drafts || []);
          setSentToday(q.sent_today || 0);
        }
      } catch {}
    }, 20000); // Increased to 20s to reduce flashing
    return () => clearInterval(interval);
  }, [mode, generating, autoScanning]);

  async function changeMode(newMode: AgentMode) {
    if (newMode === 'auto') {
      const ok = confirm(
        '⚠️ AUTO MODE\n\nThe agent will automatically respond to messages using human-like timing, style mirroring, and warmth curve.\n\nActivate?'
      );
      if (!ok) return;
    }

    // Save to localStorage IMMEDIATELY (survives Vercel instance resets)
    localStorage.setItem('agent-mode', newMode);
    setMode(newMode);
    window.dispatchEvent(new CustomEvent('agent-mode-changed', { detail: newMode }));

    // Sync to API in background
    try {
      await fetch('/api/agent/mode', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: newMode }),
      });
    } catch (err) { console.error('Mode sync to API failed:', err); }

    if (newMode === 'copilot') showToast('🤖 Copilot mode activated — select chats to generate drafts', 'success');
    else if (newMode === 'auto') showToast('🚀 Auto mode activated — agent is working autonomously', 'success');
    else showToast('Agent turned off', 'info');
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

  async function startCopilotAutoScan() {
    setAutoScanning(true);
    setScanResults([]);
    setScanProgress('🔍 Chats ophalen uit LinkedIn...');

    try {
      // Phase 1: Fast scan — just fetch and score all chats
      const scanRes: Response = await fetch('/api/agent/copilot-autoscan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'scan', target_count: scanLimit }),
      });

      if (!scanRes.ok) {
        showToast('Scan mislukt', 'error');
        setAutoScanning(false);
        setScanProgress('');
        return;
      }

      const data = await scanRes.json();
      const results = data.results || [];
      setScanResults(results);
      setScanProgress('');
      setAutoScanning(false);

      const interesting = results.filter((r: any) => r.status === 'interesting');
      showToast(
        results.length + ' chats gescand — ' + interesting.length + ' interessant',
        interesting.length > 0 ? 'success' : 'info'
      );

      // Phase 2: Generate drafts for ALL interesting chats, one by one
      if (interesting.length > 0) {
        let draftsMade = 0;
        let draftsFailed = 0;

        for (let idx = 0; idx < interesting.length; idx++) {
          const chat = interesting[idx];
          setGeneratingForChat(chat.chat_id);
          setScanProgress('✏️ Draft ' + (idx + 1) + '/' + interesting.length + ': ' + chat.name + '...');

          try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 55000); // 55s timeout client-side

            const genRes: Response = await fetch('/api/agent/copilot-autoscan', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ action: 'generate_draft', chat_id: chat.chat_id }),
              signal: controller.signal,
            });
            clearTimeout(timeoutId);

            if (genRes.ok) {
              const genData = await genRes.json();
              if (genData.success && genData.draft) {
                draftsMade++;
                setScanResults(prev => prev.map(r =>
                  r.chat_id === chat.chat_id
                    ? { ...r, status: 'draft_ready', draft: genData.draft }
                    : r
                ));
              } else {
                draftsFailed++;
                setScanResults(prev => prev.map(r =>
                  r.chat_id === chat.chat_id
                    ? { ...r, status: 'draft_failed', reason: 'AI kon geen draft genereren' }
                    : r
                ));
              }
            } else {
              draftsFailed++;
              setScanResults(prev => prev.map(r =>
                r.chat_id === chat.chat_id
                  ? { ...r, status: 'draft_failed', reason: 'Server error (' + genRes.status + ')' }
                  : r
              ));
            }
          } catch (err: any) {
            draftsFailed++;
            const reason = err?.name === 'AbortError' ? 'Timeout (te lang)' : 'Verbindingsfout';
            setScanResults(prev => prev.map(r =>
              r.chat_id === chat.chat_id
                ? { ...r, status: 'draft_failed', reason }
                : r
            ));
          }

          // Small delay between calls to avoid rate limiting
          if (idx < interesting.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 500));
          }
        }

        setGeneratingForChat(null);
        setScanProgress('');

        // Refresh drafts from server
        try {
          const qRes: Response = await fetch('/api/agent/queue');
          if (qRes.ok) {
            const q = await qRes.json();
            smartSetDrafts(q.drafts || []);
            setSentToday(q.sent_today || 0);
          }
        } catch {}

        showToast(
          '✓ ' + draftsMade + '/' + interesting.length + ' drafts gemaakt' + (draftsFailed > 0 ? ' (' + draftsFailed + ' gefaald)' : ''),
          draftsMade > 0 ? 'success' : 'error'
        );
      }
    } catch (err) {
      setAutoScanning(false);
      setScanProgress('');
      showToast('Scan error: ' + err, 'error');
    }
  }

  async function generateDraftsForSelected() {
    if (selectedChatIds.size === 0) { showToast('Select at least one chat', 'error'); return; }
    const chatIds = Array.from(selectedChatIds);
    setGenerating(true);
    setGeneratingProgress(`⏳ Generating drafts for ${chatIds.length} chat${chatIds.length > 1 ? 's' : ''}... working in background.`);
    setSelectedChatIds(new Set());
    showToast(`🤖 Generating ${chatIds.length} draft${chatIds.length > 1 ? 's' : ''} in background — you can navigate away safely`, 'success');

    // Fire-and-forget: the server processes all chats regardless of browser state
    // We use a global promise that persists even if component unmounts
    const generatePromise = fetch('/api/agent/copilot-scan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_ids: chatIds }),
    }).then(async (res) => {
      if (res.ok) {
        const data = await res.json();
        // If we're still on the page, update UI
        try {
          const qRes = await fetch('/api/agent/queue');
          if (qRes.ok) {
            const q = await qRes.json();
            smartSetDrafts(q.drafts || []);
            setSentToday(q.sent_today || 0);
          }
        } catch {}
        setGenerating(false);
        setGeneratingProgress('');
        showToast(data.drafts_created > 0 ? `✓ Created ${data.drafts_created} draft${data.drafts_created > 1 ? 's' : ''} — check Step 2` : '⚠️ No drafts could be generated', data.drafts_created > 0 ? 'success' : 'error');
      } else {
        setGenerating(false);
        setGeneratingProgress('');
        showToast('✕ Generation failed', 'error');
      }
    }).catch(() => {
      setGenerating(false);
      setGeneratingProgress('');
    });

    // Store promise globally so it survives component unmount
    (window as any).__draftGeneration = generatePromise;
  }

  async function toggleConversation(draftId: string, chatId: string) {
    if (expandedDrafts[draftId]) {
      setExpandedDrafts(prev => { const next = {...prev}; delete next[draftId]; return next; });
      return;
    }
    setLoadingConversation(draftId);
    try {
      const res = await fetch(`/api/messages?chat_id=${chatId}&limit=15`);
      if (res.ok) {
        const data = await res.json();
        const msgs = data.messages || data.items || data || [];
        setExpandedDrafts(prev => ({ ...prev, [draftId]: msgs }));
      }
    } catch (e) {
      console.error('Failed to load conversation:', e);
    }
    setLoadingConversation(null);
  }

  async function regenerateDraft(draftId: string, chatId: string) {
    setRegeneratingDraftId(draftId);

    try {
      // Remove old draft on server (but keep it in UI with loading state)
      await fetch('/api/agent/queue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ draft_id: draftId, action: 'reject' }),
      });

      // Small delay
      await new Promise(r => setTimeout(r, 300));

      // Generate new draft for this chat
      const res = await fetch('/api/agent/copilot-scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_ids: [chatId] }),
      });

      if (res.ok) {
        const data = await res.json();
        // Refresh from server to get the new draft (replaces old one)
        const qRes = await fetch('/api/agent/queue');
        if (qRes.ok) {
          const q = await qRes.json();
          smartSetDrafts(q.drafts || []);
        }
        showToast(data.drafts_created > 0 ? '✓ Draft opnieuw gegenereerd' : '⚠️ Kon geen nieuw draft maken — probeer nogmaals', data.drafts_created > 0 ? 'success' : 'error');
      } else {
        showToast('✕ Regeneratie mislukt — probeer nogmaals', 'error');
      }
    } catch (err) { showToast('✕ Error: ' + err, 'error'); }
    finally { setRegeneratingDraftId(null); }
  }

  // Guard to prevent double-click / double-fire on draft actions
  const [actionInProgress, setActionInProgress] = useState<string | null>(null);
  const [regeneratingDraftId, setRegeneratingDraftId] = useState<string | null>(null);

  async function handleDraftAction(draftId: string, action: 'approve' | 'reject') {
    if (actionInProgress) return; // Prevent double-fire
    setActionInProgress(draftId);
    try {
      const draft = drafts.find(d => d.id === draftId);

      // Update UI immediately (optimistic update)
      if (action === 'approve') {
        setDrafts(prev => {
          const updated = prev.map(d => d.id === draftId ? { ...d, status: 'approved', approved_at: new Date().toISOString() } : d);
          saveDraftsToLocal(updated);
          return updated;
        });
      } else {
        setDrafts(prev => {
          const updated = prev.filter(d => d.id !== draftId);
          saveDraftsToLocal(updated);
          return updated;
        });
      }

      // Then sync to server
      const res = await fetch('/api/agent/queue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ draft_id: draftId, action }),
      });

      if (!res.ok) {
        showToast('Server sync failed — but local update applied', 'error');
      }

      // Record outcome for self-learning (fire and forget)
      if (draft) {
        fetch('/api/agent/learn', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'record_outcome',
            chat_id: draft.chat_id,
            phase: (draft as any).phase || 'unknown',
            original_message: draft.message,
            outcome: action === 'approve' ? 'approved' : 'rejected',
            sentiment: (draft as any).sentiment || 'neutral',
          }),
        }).catch(() => {});
      }

      showToast(action === 'approve' ? '✓ Draft approved — go to Step 3 to send' : '✗ Draft removed', action === 'approve' ? 'success' : 'info');
    } catch (err) { showToast('Action failed: ' + err, 'error'); }
    finally { setActionInProgress(null); }
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
        // Refresh only drafts, not full page
        try {
          const qRes = await fetch('/api/agent/queue');
          if (qRes.ok) {
            const q = await qRes.json();
            setDrafts(q.drafts || []);
            setSentToday(q.sent_today || 0);
          }
        } catch {}
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
    <>
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
          {/* Step 1: Copilot Mode */}
          <div className="glass-card" style={{ padding: '20px', marginBottom: '16px' }}>
            {/* Toggle: Smart Copilot vs Manual */}
            <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
              <button
                onClick={() => setCopilotMode('autoscan')}
                style={{
                  flex: 1, padding: '14px 16px', borderRadius: '12px', border: 'none', cursor: 'pointer',
                  background: copilotMode === 'autoscan' ? 'linear-gradient(135deg, #3b82f6, #1d4ed8)' : 'rgba(255,255,255,0.04)',
                  color: copilotMode === 'autoscan' ? '#fff' : 'var(--text-muted)',
                  fontSize: '13px', fontWeight: 600, transition: 'all 0.2s',
                  boxShadow: copilotMode === 'autoscan' ? '0 4px 20px rgba(59,130,246,0.3)' : 'none',
                }}
              >
                🚀 Smart Copilot
                <div style={{ fontSize: '11px', fontWeight: 400, marginTop: '4px', opacity: 0.8 }}>
                  Laat de AI zelf interessante chats vinden
                </div>
              </button>
              <button
                onClick={() => setCopilotMode('manual')}
                style={{
                  flex: 1, padding: '14px 16px', borderRadius: '12px', border: 'none', cursor: 'pointer',
                  background: copilotMode === 'manual' ? 'rgba(59,130,246,0.15)' : 'rgba(255,255,255,0.04)',
                  color: copilotMode === 'manual' ? 'var(--accent)' : 'var(--text-muted)',
                  fontSize: '13px', fontWeight: 600, transition: 'all 0.2s',
                }}
              >
                ✋ Handmatig Selecteren
                <div style={{ fontSize: '11px', fontWeight: 400, marginTop: '4px', opacity: 0.8 }}>
                  Kies zelf welke chats een draft krijgen
                </div>
              </button>
            </div>

            {copilotMode === 'autoscan' ? (
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', flexWrap: 'wrap', gap: '8px' }}>
                  <div>
                    <h2 style={{ fontSize: '16px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{
                        width: '24px', height: '24px', borderRadius: '50%', display: 'inline-flex',
                        alignItems: 'center', justifyContent: 'center', fontSize: '12px', fontWeight: 700,
                        background: 'rgba(59,130,246,0.2)', color: 'var(--accent)',
                      }}>1</span>
                      🚀 Smart Scan
                    </h2>
                    <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '4px', marginLeft: '32px' }}>
                      Scant al je chats, beoordeelt ze en maakt drafts klaar
                    </p>
                  </div>
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <select
                      value={scanLimit}
                      onChange={(e) => setScanLimit(Number(e.target.value))}
                      disabled={autoScanning}
                      style={{
                        padding: '8px 12px', borderRadius: '8px', fontSize: '12px',
                        background: 'rgba(255,255,255,0.06)', color: 'var(--text-primary)',
                        border: '1px solid var(--border)', cursor: 'pointer',
                      }}
                    >
                      <option value={25}>Laatste 25 chats</option>
                      <option value={50}>Laatste 50 chats</option>
                      <option value={100}>Laatste 100 chats</option>
                    </select>
                    <button
                      className="btn-primary"
                      onClick={startCopilotAutoScan}
                      disabled={autoScanning}
                      style={{ fontSize: '13px', padding: '10px 24px' }}
                    >
                      {autoScanning ? '⏳ Scanning...' : '🚀 Start Scan'}
                    </button>
                  </div>
                </div>

                {/* Scanning progress */}
                {autoScanning && (
                  <div style={{ padding: '16px', textAlign: 'center' }}>
                    <div className="spinner" style={{ margin: '0 auto 8px', width: '24px', height: '24px' }} />
                    <div style={{ fontSize: '13px', color: 'var(--accent)' }}>{scanProgress}</div>
                  </div>
                )}

                {/* Results: ALL chats with assessment */}
                {scanResults.length > 0 && (
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px', fontSize: '12px', color: 'var(--text-muted)' }}>
                      <span>📊 {scanResults.length} chats gescand</span>
                      <span>🎯 {scanResults.filter((r: any) => r.status === 'interesting' || r.status === 'draft_ready').length} interessant
                        {generatingForChat ? ' · ⏳ Drafts genereren...' : ''}
                      </span>
                    </div>
                    <div style={{ maxHeight: '500px', overflowY: 'auto', borderRadius: '8px', border: '1px solid var(--border)' }}>
                      {scanResults.map((r: any, i: number) => (
                        <div key={r.chat_id || i} style={{
                          padding: '10px 14px',
                          borderBottom: '1px solid var(--border)',
                          display: 'flex', alignItems: 'center', gap: '10px',
                          background: r.status === 'draft_ready' ? 'rgba(34,197,94,0.06)'
                            : r.status === 'interesting' ? 'rgba(59,130,246,0.06)'
                            : r.status === 'draft_failed' ? 'rgba(239,68,68,0.06)'
                            : 'transparent',
                          fontSize: '13px',
                          opacity: r.status === 'not_interesting' || r.status === 'skipped' || r.status === 'empty' ? 0.5 : 1,
                        }}>
                          {/* Status icon */}
                          <span style={{ fontSize: '16px', flexShrink: 0, width: '22px', textAlign: 'center' }}>
                            {generatingForChat === r.chat_id ? '⏳'
                              : r.status === 'draft_ready' ? '✅'
                              : r.status === 'interesting' ? '🎯'
                              : r.status === 'draft_failed' ? '❌'
                              : r.status === 'has_draft' ? '📝'
                              : r.status === 'skipped' ? '🚫'
                              : r.status === 'empty' ? '💬'
                              : r.status === 'error' ? '⚠️'
                              : r.status === 'not_interesting' ? '—'
                              : '—'}
                          </span>

                          {/* Name + details */}
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {r.name}
                            </div>
                            <div style={{ fontSize: '11px', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {r.reason}
                              {r.last_message_age ? ' · ' + r.last_message_age : ''}
                              {r.message_count ? ' · ' + r.message_count + ' berichten' : ''}
                              {r.turns ? ' · ' + r.turns + ' beurten' : ''}
                            </div>
                            {/* Show generated draft preview */}
                            {r.status === 'draft_ready' && r.draft && (
                              <div style={{ fontSize: '11px', color: 'var(--success)', marginTop: '4px', fontStyle: 'italic' }}>
                                ✏️ &ldquo;{r.draft.message.substring(0, 120)}...&rdquo;
                              </div>
                            )}
                            {generatingForChat === r.chat_id && (
                              <div style={{ fontSize: '11px', color: 'var(--accent)', marginTop: '4px' }}>
                                ⏳ Draft aan het genereren...
                              </div>
                            )}
                          </div>

                          {/* Interest score badge */}
                          {r.interest_score > 0 && (
                            <span style={{
                              padding: '2px 8px', borderRadius: '10px', fontSize: '11px', fontWeight: 700, flexShrink: 0,
                              background: r.interest_score >= 4 ? 'rgba(34,197,94,0.15)' : r.interest_score >= 2 ? 'rgba(59,130,246,0.15)' : 'rgba(255,255,255,0.06)',
                              color: r.interest_score >= 4 ? 'var(--success)' : r.interest_score >= 2 ? 'var(--accent)' : 'var(--text-muted)',
                            }}>
                              {r.interest_score}/10
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                    {!autoScanning && !generatingForChat && (
                      <div style={{ fontSize: '11px', color: 'var(--text-muted)', padding: '8px 0', textAlign: 'center' }}>
                        ↓ Drafts staan klaar in Step 2 hieronder — beoordeel en keur goed
                      </div>
                    )}
                  </div>
                )}

                {/* Empty state */}
                {!autoScanning && scanResults.length === 0 && (
                  <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '13px' }}>
                    Klik op <strong>Start Scan</strong> om je inbox te laten analyseren.<br/>
                    <span style={{ fontSize: '11px' }}>De copilot loopt door al je chats, beoordeelt ze, en maakt drafts klaar voor de interessante.</span>
                  </div>
                )}
              </div>
            ) : (
              <div>
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
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', maxHeight: '400px', overflowY: 'auto' }}>
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
            )}
          </div>

          {/* Step 2: Review & Approve Drafts — always visible in copilot */}
          {(
            <div className="glass-card" style={{ padding: '20px', marginBottom: '16px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', flexWrap: 'wrap', gap: '8px' }}>
                <h2 style={{ fontSize: '16px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{
                    width: '24px', height: '24px', borderRadius: '50%', display: 'inline-flex',
                    alignItems: 'center', justifyContent: 'center', fontSize: '12px', fontWeight: 700,
                    background: 'rgba(245,158,11,0.2)', color: '#F59E0B',
                  }}>2</span>
                  Review Drafts
                  <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 400, marginLeft: '8px' }}>(approving does NOT send)</span>
                  {pendingDrafts.length > 0 && <span className="badge badge-warning">{pendingDrafts.length} pending</span>}
                </h2>
              </div>

              {pendingDrafts.length === 0 && approvedDrafts.length === 0 ? (
                <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '13px' }}>
                  No drafts yet — select chats in Step 1 and click Generate
                </div>
              ) : (
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
                        <button
                          onClick={() => toggleConversation(draft.id, draft.chat_id)}
                          style={{
                            marginTop: '8px', padding: '4px 10px', fontSize: '11px',
                            background: expandedDrafts[draft.id] ? 'rgba(59,130,246,0.15)' : 'rgba(255,255,255,0.05)',
                            border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px',
                            color: 'var(--text-muted)', cursor: 'pointer',
                          }}
                        >
                          {loadingConversation === draft.id ? '⏳ Loading...' : expandedDrafts[draft.id] ? '▼ Hide Conversation' : '▶ View Conversation'}
                        </button>
                        {expandedDrafts[draft.id] && (
                          <div style={{
                            marginTop: '8px', padding: '10px', borderRadius: '8px',
                            background: 'rgba(0,0,0,0.2)', maxHeight: '300px', overflowY: 'auto',
                            border: '1px solid rgba(255,255,255,0.06)',
                          }}>
                            {expandedDrafts[draft.id].length === 0 ? (
                              <div style={{ color: 'var(--text-muted)', fontSize: '12px' }}>No messages found</div>
                            ) : (
                              expandedDrafts[draft.id].map((msg: any, i: number) => (
                                <div key={i} style={{
                                  marginBottom: '6px', padding: '6px 10px', borderRadius: '8px',
                                  background: msg.is_sender || msg.sender?.is_me
                                    ? 'rgba(59,130,246,0.15)'
                                    : 'rgba(255,255,255,0.05)',
                                  marginLeft: msg.is_sender || msg.sender?.is_me ? '40px' : '0',
                                  marginRight: msg.is_sender || msg.sender?.is_me ? '0' : '40px',
                                }}>
                                  <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginBottom: '2px' }}>
                                    {msg.is_sender || msg.sender?.is_me ? '🟦 Jij' : '🟢 ' + draft.prospect_name}
                                    {msg.timestamp && <span> · {new Date(msg.timestamp || msg.date).toLocaleDateString('nl-NL', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>}
                                  </div>
                                  <div style={{ fontSize: '12px', color: 'var(--text-primary)', whiteSpace: 'pre-wrap' }}>
                                    {msg.text || msg.body || '(no text)'}
                                  </div>
                                </div>
                              ))
                            )}
                          </div>
                        )}
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
                            title="Approve this draft — it will NOT be sent yet. You send in Step 3."
                          >
                            ✓ Approve Draft
                          </button>
                          <button
                            className="btn-secondary"
                            onClick={() => regenerateDraft(draft.id, draft.chat_id)}
                            disabled={generating || regeneratingDraftId !== null}
                            style={{ padding: '8px 16px', fontSize: '12px', color: 'var(--accent)' }}
                            title="Generate a new draft for this conversation"
                          >
                            🔄 Regenerate
                          </button>
                          <button
                            className="btn-secondary"
                            onClick={() => handleDraftAction(draft.id, 'reject')}
                            style={{ padding: '8px 16px', fontSize: '12px', color: 'var(--danger)' }}
                            title="Remove this draft"
                          >
                            ✕ Remove
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

      {/* Agent Chat Interface */}
      <AgentChat
        onModeChange={(m) => { setMode(m as AgentMode); localStorage.setItem('agent-mode', m); }}
        onRefreshDashboard={async () => {
          try {
            const qRes = await fetch('/api/agent/queue');
            if (qRes.ok) {
              const q = await qRes.json();
              smartSetDrafts(q.drafts || []);
              setSentToday(q.sent_today || 0);
            }
          } catch {}
        }}
      />
    </>
  );
}
