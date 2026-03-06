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

const STATUS_CONFIG: Record<ProspectStatus, { label: string; color: string; bg: string; icon: string }> = {
  imported:      { label: 'Imported',     color: '#94a3b8', bg: 'rgba(148,163,184,0.12)', icon: '📥' },
  enriched:      { label: 'Ready',        color: '#818cf8', bg: 'rgba(129,140,248,0.12)', icon: '✨' },
  invite_sent:   { label: 'Invite Sent',  color: '#f59e0b', bg: 'rgba(245,158,11,0.12)', icon: '📨' },
  connected:     { label: 'Connected',    color: '#10b981', bg: 'rgba(16,185,129,0.12)',  icon: '🤝' },
  draft_created: { label: 'Draft Ready',  color: '#06b6d4', bg: 'rgba(6,182,212,0.12)',   icon: '📝' },
  messaged:      { label: 'Messaged',     color: '#22c55e', bg: 'rgba(34,197,94,0.12)',   icon: '💬' },
  rejected:      { label: 'Declined',     color: '#ef4444', bg: 'rgba(239,68,68,0.12)',   icon: '❌' },
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
  // Edit modal
  const [editingProspect, setEditingProspect] = useState<Prospect | null>(null);
  const [editMessage, setEditMessage] = useState('');
  const [editInstruction, setEditInstruction] = useState('');
  const [regenerating, setRegenerating] = useState(false);
  const [saving, setSaving] = useState(false);

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

  // Load saved instruction
  useEffect(() => {
    fetch('/api/prospects/instruction').then(r => r.json()).then(d => {
      if (d.instruction) setInstruction(d.instruction);
    }).catch(() => {});
  }, []);

  // Save instruction when it changes (debounced)
  useEffect(() => {
    const t = setTimeout(() => {
      if (instruction.trim()) {
        fetch('/api/prospects/instruction', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ instruction }),
        }).catch(() => {});
      }
    }, 1500);
    return () => clearTimeout(t);
  }, [instruction]);

  // Import
  const handleImport = async () => {
    if (!searchUrl.trim()) return;
    setImporting(true);
    setProcessStatus('');
    try {
      const res = await fetch('/api/prospects/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: searchUrl, maxResults: 25 }),
      });
      const data = await res.json();
      if (data.error) { setProcessStatus('❌ ' + data.error); return; }
      const parts = ['✅ ' + data.added + ' imported'];
      if (data.skipped > 0) parts.push(data.skipped + ' skipped');
      if (data.already_connected > 0) parts.push('🤝 ' + data.already_connected + ' connected');
      if (data.already_invited > 0) parts.push('📨 ' + data.already_invited + ' invited');
      setProcessStatus(parts.join(' · '));
      setSearchUrl('');
      loadProspects();
    } catch (e: any) {
      setProcessStatus('❌ ' + e.message);
    } finally {
      setImporting(false);
    }
  };

  // Enrich + Generate
  const handleEnrich = async () => {
    const ids = selected.size > 0 ? Array.from(selected) : undefined;
    setProcessing(true);
    setProcessStatus('⏳ Enriching profiles & generating messages (8-20s per prospect)...');
    try {
      const body: any = { prospect_ids: ids, maxCount: 25 };
      if (instruction.trim()) body.instruction = instruction;
      const res = await fetch('/api/prospects/enrich', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
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

  // Send Invites
  const handleSendInvites = async () => {
    const enriched = prospects.filter(p => p.status === 'enriched' && p.invite_message);
    if (enriched.length === 0) { setProcessStatus('⚠️ No enriched prospects with messages ready'); return; }
    if (!confirm('Send ' + enriched.length + ' connection requests? (50-70s interval between each)')) return;
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
      setProcessStatus('✅ ' + data.sent + ' invites sent (' + data.sent_today + '/' + data.daily_limit + ' today)');
      setSelected(new Set());
      loadProspects();
    } catch (e: any) {
      setProcessStatus('❌ ' + e.message);
    } finally {
      setProcessing(false);
    }
  };

  // Delete
  const handleDelete = async (ids: string[]) => {
    if (!confirm('Delete ' + ids.length + ' prospect(s)?')) return;
    try {
      await fetch('/api/prospects/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prospect_ids: ids }),
      });
      setSelected(new Set());
      loadProspects();
    } catch {}
  };

  // Edit modal actions
  const openEdit = (p: Prospect) => {
    setEditingProspect(p);
    setEditMessage(p.invite_message || '');
    setEditInstruction(instruction);
  };

  const saveMessage = async () => {
    if (!editingProspect) return;
    setSaving(true);
    try {
      await fetch('/api/prospects/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prospect_id: editingProspect.id, invite_message: editMessage }),
      });
      setEditingProspect(null);
      loadProspects();
    } catch {} finally { setSaving(false); }
  };

  const regenerateMessage = async () => {
    if (!editingProspect) return;
    setRegenerating(true);
    try {
      const res = await fetch('/api/prospects/regenerate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prospect_id: editingProspect.id, instruction: editInstruction || undefined }),
      });
      const data = await res.json();
      if (data.message) setEditMessage(data.message);
      else if (data.error) alert('Regenerate failed: ' + data.error);
    } catch (e: any) {
      alert('Failed: ' + e.message);
    } finally { setRegenerating(false); }
  };

  const toggleSelect = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    const next = new Set(selected);
    next.has(id) ? next.delete(id) : next.add(id);
    setSelected(next);
  };

  const selectAll = () => {
    setSelected(selected.size === prospects.length ? new Set() : new Set(prospects.map(p => p.id)));
  };

  const pipelineSteps: { status: ProspectStatus; label: string }[] = [
    { status: 'imported', label: '📥 Imported' },
    { status: 'enriched', label: '✨ Ready' },
    { status: 'invite_sent', label: '📨 Sent' },
    { status: 'connected', label: '🤝 Connected' },
    { status: 'messaged', label: '💬 Messaged' },
  ];

  const importedCount = stats?.imported || 0;
  const enrichedCount = stats?.enriched || 0;

  return (
    <div className="page-content">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <div>
          <h1 style={{ fontSize: '22px', fontWeight: 700 }}>🎯 Prospecting Pipeline</h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '13px' }}>Import → Enrich → Review → Send</p>
        </div>
      </div>

      {/* Pipeline Stats */}
      {stats && (
        <div style={{ display: 'flex', gap: '6px', marginBottom: '16px', overflowX: 'auto' }}>
          {pipelineSteps.map(step => (
            <button
              key={step.status}
              onClick={() => setFilter(filter === step.status ? 'all' : step.status)}
              style={{
                flex: 1, minWidth: '90px', padding: '10px 12px', borderRadius: '10px',
                cursor: 'pointer', textAlign: 'center', transition: 'all 0.2s',
                background: filter === step.status ? STATUS_CONFIG[step.status].bg : 'var(--bg-card)',
                border: '1px solid ' + (filter === step.status ? STATUS_CONFIG[step.status].color + '44' : 'var(--border)'),
              }}
            >
              <div style={{ fontSize: '18px', fontWeight: 700, color: STATUS_CONFIG[step.status].color }}>
                {stats[step.status] || 0}
              </div>
              <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginTop: '2px' }}>{step.label}</div>
            </button>
          ))}
        </div>
      )}

      {/* Import Section */}
      <div className="card" style={{ marginBottom: '12px', padding: '14px' }}>
        <div style={{ fontSize: '13px', fontWeight: 600, marginBottom: '8px', color: 'var(--text-secondary)' }}>
          📥 Import from Sales Navigator
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <input type="text" placeholder="Paste Sales Navigator URL..." value={searchUrl}
            onChange={e => setSearchUrl(e.target.value)}
            style={{ flex: 1, padding: '8px 12px', borderRadius: '8px', fontSize: '12px',
              background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}
          />
          <button onClick={handleImport} disabled={importing || !searchUrl.trim()}
            style={{ padding: '8px 16px', borderRadius: '8px', border: 'none', cursor: 'pointer',
              background: 'linear-gradient(135deg, #6366f1, #4f46e5)', color: 'white',
              fontWeight: 600, fontSize: '12px', opacity: importing ? 0.6 : 1, whiteSpace: 'nowrap' }}>
            {importing ? '⏳...' : '🔍 Import'}
          </button>
        </div>
      </div>

      {/* Enrich + Send */}
      <div className="card" style={{ marginBottom: '12px', padding: '14px' }}>
        <div style={{ fontSize: '13px', fontWeight: 600, marginBottom: '8px', color: 'var(--text-secondary)' }}>
          ✨ Enrich & Generate Messages
        </div>
        <textarea
          placeholder="(Optioneel) Instructie: bijv 'Ik zoek partnerships in tech. Refereer aan hun rol en bedrijf.'"
          value={instruction} onChange={e => setInstruction(e.target.value)} rows={2}
          style={{ width: '100%', padding: '8px 12px', borderRadius: '8px', fontSize: '12px', resize: 'vertical',
            background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text-primary)',
            fontFamily: 'inherit' }}
        />
        <div style={{ display: 'flex', gap: '8px', marginTop: '8px', flexWrap: 'wrap' }}>
          <button onClick={handleEnrich} disabled={processing || importedCount === 0}
            style={{ padding: '8px 16px', borderRadius: '8px', border: 'none', cursor: 'pointer',
              background: 'linear-gradient(135deg, #818cf8, #6366f1)', color: 'white',
              fontWeight: 600, fontSize: '12px', opacity: processing || importedCount === 0 ? 0.5 : 1 }}>
            {processing ? '⏳ Processing...' : '✨ Enrich & Generate (' + importedCount + ')'}
          </button>
          <button onClick={handleSendInvites} disabled={processing || enrichedCount === 0}
            style={{ padding: '8px 16px', borderRadius: '8px', border: 'none', cursor: 'pointer',
              background: 'linear-gradient(135deg, #10b981, #059669)', color: 'white',
              fontWeight: 600, fontSize: '12px', opacity: processing || enrichedCount === 0 ? 0.5 : 1 }}>
            📨 Send Invites ({enrichedCount})
          </button>
          {selected.size > 0 && (
            <button onClick={() => handleDelete(Array.from(selected))}
              style={{ padding: '8px 16px', borderRadius: '8px', border: '1px solid rgba(239,68,68,0.3)',
                background: 'rgba(239,68,68,0.1)', color: '#fca5a5', fontWeight: 600, fontSize: '12px',
                cursor: 'pointer', marginLeft: 'auto' }}>
              🗑️ Delete ({selected.size})
            </button>
          )}
        </div>
        {processStatus && (
          <div style={{
            marginTop: '8px', padding: '6px 10px', borderRadius: '8px', fontSize: '11px',
            background: processStatus.includes('❌') ? 'rgba(239,68,68,0.1)' : processStatus.includes('⏳') ? 'rgba(99,102,241,0.1)' : 'rgba(16,185,129,0.1)',
            color: processStatus.includes('❌') ? '#fca5a5' : processStatus.includes('⏳') ? '#a5b4fc' : '#86efac',
            border: '1px solid ' + (processStatus.includes('❌') ? 'rgba(239,68,68,0.2)' : processStatus.includes('⏳') ? 'rgba(99,102,241,0.2)' : 'rgba(16,185,129,0.2)'),
          }}>
            {processStatus}
          </div>
        )}
      </div>

      {/* Prospect List */}
      <div className="card" style={{ padding: '14px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
          <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)' }}>
            {filter === 'all' ? 'All Prospects' : STATUS_CONFIG[filter as ProspectStatus]?.label || filter} ({prospects.length})
          </span>
          <div style={{ display: 'flex', gap: '6px' }}>
            <button onClick={selectAll} style={{ padding: '3px 8px', borderRadius: '6px', border: '1px solid var(--border)',
              background: 'transparent', color: 'var(--text-muted)', fontSize: '10px', cursor: 'pointer' }}>
              {selected.size === prospects.length && prospects.length > 0 ? 'Deselect All' : 'Select All'}
            </button>
            <button onClick={() => setFilter('all')} style={{ padding: '3px 8px', borderRadius: '6px', border: '1px solid var(--border)',
              background: filter === 'all' ? 'var(--accent)' : 'transparent',
              color: filter === 'all' ? 'white' : 'var(--text-muted)', fontSize: '10px', cursor: 'pointer' }}>All</button>
          </div>
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>Loading...</div>
        ) : prospects.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>
            <div style={{ fontSize: '32px', marginBottom: '8px' }}>🎯</div>
            <p>No prospects yet. Import from Sales Navigator.</p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
            {prospects.map(p => (
              <div key={p.id} style={{
                display: 'flex', alignItems: 'flex-start', gap: '10px', padding: '10px 10px',
                borderRadius: '10px', transition: 'all 0.15s',
                background: selected.has(p.id) ? 'rgba(99,102,241,0.06)' : 'transparent',
                border: '1px solid ' + (selected.has(p.id) ? 'rgba(99,102,241,0.15)' : 'transparent'),
              }}>
                {/* Checkbox */}
                <div onClick={(e) => toggleSelect(e, p.id)} style={{
                  width: '16px', height: '16px', borderRadius: '4px', flexShrink: 0, cursor: 'pointer', marginTop: '2px',
                  border: '2px solid ' + (selected.has(p.id) ? '#6366f1' : 'var(--border)'),
                  background: selected.has(p.id) ? '#6366f1' : 'transparent',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  {selected.has(p.id) && <span style={{ color: 'white', fontSize: '10px', fontWeight: 700 }}>✓</span>}
                </div>

                {/* Avatar */}
                <div style={{
                  width: '34px', height: '34px', borderRadius: '50%', flexShrink: 0,
                  background: p.profile_picture_url ? 'none' : 'linear-gradient(135deg, #6366f1, #4f46e5)',
                  backgroundImage: p.profile_picture_url ? 'url(' + p.profile_picture_url + ')' : 'none',
                  backgroundSize: 'cover', backgroundPosition: 'center',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: 'white', fontWeight: 700, fontSize: '13px',
                }}>
                  {!p.profile_picture_url && (p.first_name?.[0] || '?')}
                </div>

                {/* Info + Message */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>{p.name}</span>
                    <span style={{
                      padding: '1px 6px', borderRadius: '4px', fontSize: '9px', fontWeight: 600,
                      color: STATUS_CONFIG[p.status]?.color || '#94a3b8',
                      background: STATUS_CONFIG[p.status]?.bg || 'rgba(148,163,184,0.1)',
                    }}>
                      {STATUS_CONFIG[p.status]?.icon} {STATUS_CONFIG[p.status]?.label || p.status}
                    </span>
                  </div>
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: '1px' }}>
                    {p.company && p.company + ' · '}{p.headline?.substring(0, 70)}
                  </div>
                  {/* Show message if exists */}
                  {p.invite_message && (
                    <div style={{
                      marginTop: '6px', padding: '6px 10px', borderRadius: '8px', fontSize: '11px',
                      background: 'rgba(99,102,241,0.06)', border: '1px solid rgba(99,102,241,0.1)',
                      color: '#c7d2fe', lineHeight: 1.4, position: 'relative',
                    }}>
                      <span style={{ color: '#818cf8', fontWeight: 600, fontSize: '10px' }}>💬 Message:</span>{' '}
                      {p.invite_message}
                      <span style={{ fontSize: '10px', color: '#4b5563', marginLeft: '4px' }}>
                        ({p.invite_message.length}/290)
                      </span>
                    </div>
                  )}
                </div>

                {/* Actions */}
                <div style={{ display: 'flex', gap: '4px', flexShrink: 0, marginTop: '2px' }}>
                  <button onClick={() => openEdit(p)} title="Edit message"
                    style={{ width: '28px', height: '28px', borderRadius: '6px', border: '1px solid var(--border)',
                      background: 'transparent', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: '12px', color: 'var(--text-muted)', transition: 'all 0.15s' }}
                    onMouseEnter={e => { e.currentTarget.style.borderColor = '#818cf8'; e.currentTarget.style.color = '#818cf8'; }}
                    onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--text-muted)'; }}>
                    ✏️
                  </button>
                  <button onClick={() => handleDelete([p.id])} title="Delete"
                    style={{ width: '28px', height: '28px', borderRadius: '6px', border: '1px solid var(--border)',
                      background: 'transparent', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: '12px', color: 'var(--text-muted)', transition: 'all 0.15s' }}
                    onMouseEnter={e => { e.currentTarget.style.borderColor = '#ef4444'; e.currentTarget.style.color = '#ef4444'; }}
                    onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--text-muted)'; }}>
                    🗑️
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Edit Modal */}
      {editingProspect && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex',
          alignItems: 'center', justifyContent: 'center', zIndex: 1000, backdropFilter: 'blur(4px)',
        }} onClick={() => setEditingProspect(null)}>
          <div onClick={e => e.stopPropagation()} style={{
            width: '480px', maxWidth: '90vw', background: 'var(--bg-card)', border: '1px solid var(--border)',
            borderRadius: '16px', padding: '20px', boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <div>
                <div style={{ fontSize: '15px', fontWeight: 700, color: 'var(--text-primary)' }}>
                  ✏️ {editingProspect.name}
                </div>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                  {editingProspect.company} · {editingProspect.headline?.substring(0, 50)}
                </div>
              </div>
              <button onClick={() => setEditingProspect(null)}
                style={{ width: '28px', height: '28px', borderRadius: '50%', border: 'none',
                  background: 'rgba(255,255,255,0.05)', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '14px' }}>×</button>
            </div>

            <div style={{ marginBottom: '12px' }}>
              <label style={{ fontSize: '11px', fontWeight: 600, color: '#818cf8', marginBottom: '4px', display: 'block' }}>
                Connection Request Message
              </label>
              <textarea value={editMessage} onChange={e => setEditMessage(e.target.value.substring(0, 290))} rows={5}
                style={{ width: '100%', padding: '10px 12px', borderRadius: '10px', fontSize: '12px', lineHeight: 1.5,
                  background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text-primary)',
                  fontFamily: 'inherit', resize: 'vertical' }} />
              <div style={{ fontSize: '10px', color: editMessage.length > 280 ? '#f59e0b' : '#4b5563', textAlign: 'right', marginTop: '2px' }}>
                {editMessage.length}/290
              </div>
            </div>

            <div style={{ marginBottom: '12px', padding: '10px', borderRadius: '10px', background: 'rgba(99,102,241,0.05)', border: '1px solid rgba(99,102,241,0.1)' }}>
              <label style={{ fontSize: '11px', fontWeight: 600, color: '#818cf8', marginBottom: '4px', display: 'block' }}>
                🔄 Regenerate with instruction
              </label>
              <textarea value={editInstruction} onChange={e => setEditInstruction(e.target.value)} rows={2}
                placeholder="Bijv: 'Maak het informeler' of 'Focus op AI partnerships'"
                style={{ width: '100%', padding: '8px 10px', borderRadius: '8px', fontSize: '11px',
                  background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text-primary)',
                  fontFamily: 'inherit', resize: 'none' }} />
              <button onClick={regenerateMessage} disabled={regenerating}
                style={{ marginTop: '6px', padding: '6px 14px', borderRadius: '8px', border: 'none', cursor: 'pointer',
                  background: regenerating ? '#4b5563' : 'linear-gradient(135deg, #6366f1, #8b5cf6)', color: 'white',
                  fontWeight: 600, fontSize: '11px' }}>
                {regenerating ? '⏳ Generating...' : '🔄 Regenerate'}
              </button>
            </div>

            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
              <button onClick={() => setEditingProspect(null)}
                style={{ padding: '8px 16px', borderRadius: '8px', border: '1px solid var(--border)',
                  background: 'transparent', color: 'var(--text-muted)', fontSize: '12px', cursor: 'pointer' }}>
                Cancel
              </button>
              <button onClick={saveMessage} disabled={saving}
                style={{ padding: '8px 20px', borderRadius: '8px', border: 'none', cursor: 'pointer',
                  background: 'linear-gradient(135deg, #10b981, #059669)', color: 'white',
                  fontWeight: 600, fontSize: '12px' }}>
                {saving ? '⏳...' : '💾 Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
