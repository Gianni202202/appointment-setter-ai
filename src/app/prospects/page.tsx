'use client';

import { useState, useEffect, useCallback } from 'react';

type ProspectStatus = 'imported' | 'enriched' | 'invite_sent' | 'connected' | 'draft_created' | 'messaged' | 'rejected';

interface Prospect {
  id: string;
  name: string;
  first_name: string;
  last_name: string;
  headline: string;
  company: string;
  location: string;
  profile_url: string;
  profile_picture_url: string;
  network_distance: string;
  status: ProspectStatus;
  enriched: boolean;
  invite_message?: string;
  invite_sent_at?: string;
  connected_at?: string;
  imported_at: string;
  source: string;
}

interface Stats {
  imported: number;
  enriched: number;
  invite_sent: number;
  connected: number;
  draft_created: number;
  messaged: number;
  rejected: number;
}

const STATUS_CONFIG: Record<ProspectStatus, { label: string; color: string; bg: string }> = {
  imported: { label: '📥 Imported', color: '#94a3b8', bg: 'rgba(148,163,184,0.1)' },
  enriched: { label: '✨ Ready', color: '#818cf8', bg: 'rgba(129,140,248,0.1)' },
  invite_sent: { label: '📨 Sent', color: '#f59e0b', bg: 'rgba(245,158,11,0.1)' },
  connected: { label: '🤝 Connected', color: '#10b981', bg: 'rgba(16,185,129,0.1)' },
  draft_created: { label: '📝 Draft', color: '#06b6d4', bg: 'rgba(6,182,212,0.1)' },
  messaged: { label: '💬 Messaged', color: '#22c55e', bg: 'rgba(34,197,94,0.1)' },
  rejected: { label: '❌ Rejected', color: '#ef4444', bg: 'rgba(239,68,68,0.1)' },
};

export default function ProspectsPage() {
  const [prospects, setProspects] = useState<Prospect[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<ProspectStatus | 'all'>('all');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [instruction, setInstruction] = useState('');
  const [processing, setProcessing] = useState(false);
  const [processStatus, setProcessStatus] = useState('');
  const [searchUrl, setSearchUrl] = useState('');
  const [importing, setImporting] = useState(false);

  const loadProspects = useCallback(async () => {
    try {
      const url = filter === 'all' ? '/api/prospects' : '/api/prospects?status=' + filter;
      const res = await fetch(url);
      const data = await res.json();
      setProspects(data.prospects || []);
      setStats(data.stats || null);
    } catch (e) {
      console.error('Failed to load prospects:', e);
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => { loadProspects(); }, [loadProspects]);

  // ── Import from Sales Nav URL ──
  const handleImport = async () => {
    if (!searchUrl.trim()) return;
    setImporting(true);
    try {
      const res = await fetch('/api/prospects/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: searchUrl, maxResults: 25 }),
      });
      const data = await res.json();
      if (data.error) { alert(data.error); return; }
      setProcessStatus('✅ ' + data.added + ' prospects imported (' + data.skipped + ' duplicates skipped)');
      setSearchUrl('');
      loadProspects();
    } catch (e: any) {
      alert('Import failed: ' + e.message);
    } finally {
      setImporting(false);
    }
  };

  // ── Enrich + Generate Messages ──
  const handleEnrich = async () => {
    if (!instruction.trim()) { alert('Geef eerst een instructie op voor het connectieverzoek'); return; }
    const ids = selected.size > 0 ? Array.from(selected) : undefined;
    setProcessing(true);
    setProcessStatus('⏳ Enriching profiles & generating messages (8-20s per prospect)...');
    try {
      const res = await fetch('/api/prospects/enrich', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prospect_ids: ids, instruction, maxCount: 25 }),
      });
      const data = await res.json();
      if (data.error) { setProcessStatus('❌ ' + data.error); return; }
      setProcessStatus('✅ ' + data.processed + '/' + data.total + ' enriched & messages generated');
      setSelected(new Set());
      loadProspects();
    } catch (e: any) {
      setProcessStatus('❌ ' + e.message);
    } finally {
      setProcessing(false);
    }
  };

  // ── Send Invites ──
  const handleSendInvites = async () => {
    const enriched = prospects.filter(p => p.status === 'enriched' && p.invite_message);
    if (enriched.length === 0) { alert('Geen verrijkte prospects met berichten klaar om te versturen'); return; }
    if (!confirm('Verstuur ' + enriched.length + ' connectieverzoeken? (50-70s interval per verzoek)')) return;
    
    setProcessing(true);
    setProcessStatus('📨 Sending invites (50-70s per invite)...');
    try {
      const ids = selected.size > 0 ? Array.from(selected) : undefined;
      const res = await fetch('/api/prospects/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prospect_ids: ids }),
      });
      const data = await res.json();
      if (data.error) { setProcessStatus('❌ ' + data.error); return; }
      setProcessStatus('✅ ' + data.sent + ' invites verstuurd (' + data.sent_today + '/' + data.daily_limit + ' today)');
      setSelected(new Set());
      loadProspects();
    } catch (e: any) {
      setProcessStatus('❌ ' + e.message);
    } finally {
      setProcessing(false);
    }
  };

  const toggleSelect = (id: string) => {
    const next = new Set(selected);
    next.has(id) ? next.delete(id) : next.add(id);
    setSelected(next);
  };

  const selectAll = () => {
    if (selected.size === prospects.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(prospects.map(p => p.id)));
    }
  };

  const pipelineSteps: { status: ProspectStatus; label: string }[] = [
    { status: 'imported', label: '📥 Imported' },
    { status: 'enriched', label: '✨ Ready to Send' },
    { status: 'invite_sent', label: '📨 Invite Sent' },
    { status: 'connected', label: '🤝 Connected' },
    { status: 'messaged', label: '💬 Messaged' },
  ];

  return (
    <div className="page-content">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
        <div>
          <h1 style={{ fontSize: '24px', fontWeight: 700 }}>🎯 Prospects</h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '14px' }}>Import, enrich, and connect with prospects from Sales Navigator</p>
        </div>
      </div>

      {/* Pipeline Overview */}
      {stats && (
        <div style={{ display: 'flex', gap: '8px', marginBottom: '20px', overflowX: 'auto' }}>
          {pipelineSteps.map((step, i) => (
            <button
              key={step.status}
              onClick={() => setFilter(filter === step.status ? 'all' : step.status)}
              style={{
                flex: 1, minWidth: '120px', padding: '12px 16px', borderRadius: '12px',
                cursor: 'pointer', textAlign: 'center', transition: 'all 0.2s',
                background: filter === step.status ? STATUS_CONFIG[step.status].bg : 'var(--bg-card)',
                border: '1px solid ' + (filter === step.status ? STATUS_CONFIG[step.status].color + '44' : 'var(--border)'),
              }}
            >
              <div style={{ fontSize: '22px', fontWeight: 700, color: STATUS_CONFIG[step.status].color }}>
                {stats[step.status] || 0}
              </div>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>{step.label}</div>
              {i < pipelineSteps.length - 1 && (
                <span style={{ position: 'absolute', right: '-8px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }}>→</span>
              )}
            </button>
          ))}
        </div>
      )}

      {/* Import Section */}
      <div className="card" style={{ marginBottom: '16px', padding: '16px' }}>
        <h3 style={{ fontSize: '14px', fontWeight: 600, marginBottom: '10px', color: 'var(--text-secondary)' }}>
          📥 Import from Sales Navigator
        </h3>
        <div style={{ display: 'flex', gap: '8px' }}>
          <input
            type="text"
            placeholder="Paste Sales Navigator search URL..."
            value={searchUrl}
            onChange={(e) => setSearchUrl(e.target.value)}
            style={{
              flex: 1, padding: '10px 14px', borderRadius: '8px', fontSize: '13px',
              background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text-primary)',
            }}
          />
          <button
            onClick={handleImport}
            disabled={importing || !searchUrl.trim()}
            style={{
              padding: '10px 20px', borderRadius: '8px', border: 'none', cursor: 'pointer',
              background: 'linear-gradient(135deg, #6366f1, #4f46e5)', color: 'white',
              fontWeight: 600, fontSize: '13px', opacity: importing ? 0.6 : 1,
              whiteSpace: 'nowrap',
            }}
          >
            {importing ? '⏳ Importing...' : '🔍 Import'}
          </button>
        </div>
        <p style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '6px' }}>
          Or use the Chrome Extension to import directly from Sales Navigator
        </p>
      </div>

      {/* Enrich + Send Section */}
      <div className="card" style={{ marginBottom: '16px', padding: '16px' }}>
        <h3 style={{ fontSize: '14px', fontWeight: 600, marginBottom: '10px', color: 'var(--text-secondary)' }}>
          ✨ Enrich & Generate Messages
        </h3>
        <textarea
          placeholder="Instructie voor het connectieverzoek, bijv: 'Ik ben op zoek naar partnerships in de tech sector. Refereer aan hun huidige rol en bedrijf.'"
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          rows={3}
          style={{
            width: '100%', padding: '10px 14px', borderRadius: '8px', fontSize: '13px', resize: 'vertical',
            background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text-primary)',
            fontFamily: 'inherit',
          }}
        />
        <div style={{ display: 'flex', gap: '8px', marginTop: '10px' }}>
          <button
            onClick={handleEnrich}
            disabled={processing || !instruction.trim()}
            style={{
              padding: '10px 20px', borderRadius: '8px', border: 'none', cursor: 'pointer',
              background: 'linear-gradient(135deg, #818cf8, #6366f1)', color: 'white',
              fontWeight: 600, fontSize: '13px', opacity: processing ? 0.6 : 1,
            }}
          >
            {processing ? '⏳ Processing...' : '✨ Enrich & Generate (' + (selected.size || stats?.imported || 0) + ')'}
          </button>
          <button
            onClick={handleSendInvites}
            disabled={processing || (stats?.enriched || 0) === 0}
            style={{
              padding: '10px 20px', borderRadius: '8px', border: 'none', cursor: 'pointer',
              background: 'linear-gradient(135deg, #10b981, #059669)', color: 'white',
              fontWeight: 600, fontSize: '13px', opacity: processing || (stats?.enriched || 0) === 0 ? 0.6 : 1,
            }}
          >
            📨 Send Invites ({stats?.enriched || 0})
          </button>
        </div>
        {processStatus && (
          <div style={{
            marginTop: '10px', padding: '8px 12px', borderRadius: '8px', fontSize: '12px',
            background: processStatus.includes('❌') ? 'rgba(239,68,68,0.1)' : 'rgba(16,185,129,0.1)',
            color: processStatus.includes('❌') ? '#fca5a5' : '#86efac',
            border: '1px solid ' + (processStatus.includes('❌') ? 'rgba(239,68,68,0.2)' : 'rgba(16,185,129,0.2)'),
          }}>
            {processStatus}
          </div>
        )}
      </div>

      {/* Prospect List */}
      <div className="card" style={{ padding: '16px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
          <h3 style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-secondary)' }}>
            {filter === 'all' ? 'All Prospects' : STATUS_CONFIG[filter as ProspectStatus]?.label || 'Prospects'} ({prospects.length})
          </h3>
          <div style={{ display: 'flex', gap: '6px' }}>
            <button onClick={selectAll} style={{
              padding: '4px 10px', borderRadius: '6px', border: '1px solid var(--border)',
              background: 'transparent', color: 'var(--text-muted)', fontSize: '11px', cursor: 'pointer',
            }}>
              {selected.size === prospects.length ? 'Deselect All' : 'Select All'}
            </button>
            <button onClick={() => setFilter('all')} style={{
              padding: '4px 10px', borderRadius: '6px', border: '1px solid var(--border)',
              background: filter === 'all' ? 'var(--accent)' : 'transparent',
              color: filter === 'all' ? 'white' : 'var(--text-muted)', fontSize: '11px', cursor: 'pointer',
            }}>All</button>
          </div>
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>Loading...</div>
        ) : prospects.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>
            <div style={{ fontSize: '32px', marginBottom: '8px' }}>🎯</div>
            <p>No prospects yet. Import from Sales Navigator to get started.</p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            {prospects.map(p => (
              <div
                key={p.id}
                onClick={() => toggleSelect(p.id)}
                style={{
                  display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 12px',
                  borderRadius: '10px', cursor: 'pointer', transition: 'all 0.15s',
                  background: selected.has(p.id) ? 'rgba(99,102,241,0.08)' : 'transparent',
                  border: '1px solid ' + (selected.has(p.id) ? 'rgba(99,102,241,0.2)' : 'transparent'),
                }}
              >
                <div style={{
                  width: '18px', height: '18px', borderRadius: '4px', flexShrink: 0,
                  border: '2px solid ' + (selected.has(p.id) ? '#6366f1' : 'var(--border)'),
                  background: selected.has(p.id) ? '#6366f1' : 'transparent',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  {selected.has(p.id) && <span style={{ color: 'white', fontSize: '11px', fontWeight: 700 }}>✓</span>}
                </div>
                
                <div style={{
                  width: '36px', height: '36px', borderRadius: '50%', flexShrink: 0,
                  background: p.profile_picture_url ? 'none' : 'linear-gradient(135deg, #6366f1, #4f46e5)',
                  backgroundImage: p.profile_picture_url ? 'url(' + p.profile_picture_url + ')' : 'none',
                  backgroundSize: 'cover', backgroundPosition: 'center',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: 'white', fontWeight: 700, fontSize: '14px',
                }}>
                  {!p.profile_picture_url && (p.first_name?.[0] || '?')}
                </div>
                
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>{p.name}</div>
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {p.company && p.company + ' · '}{p.headline?.substring(0, 60)}
                  </div>
                </div>
                
                <div style={{
                  padding: '3px 8px', borderRadius: '6px', fontSize: '10px', fontWeight: 600,
                  color: STATUS_CONFIG[p.status]?.color || '#94a3b8',
                  background: STATUS_CONFIG[p.status]?.bg || 'rgba(148,163,184,0.1)',
                  whiteSpace: 'nowrap',
                }}>
                  {STATUS_CONFIG[p.status]?.label || p.status}
                </div>

                {p.invite_message && (
                  <div title={p.invite_message} style={{
                    width: '20px', height: '20px', borderRadius: '50%',
                    background: 'rgba(129,140,248,0.15)', color: '#818cf8',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: '10px', flexShrink: 0, cursor: 'help',
                  }}>💬</div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
