'use client';

import { useState, useEffect, useCallback, useRef } from 'react';

/* ═══════════════════════════════════════════
   Types
   ═══════════════════════════════════════════ */
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

const STATUS_META: Record<ProspectStatus, { label: string; cls: string; icon: string }> = {
  imported:      { label: 'Imported',    cls: 'state-new',       icon: '↓' },
  enriched:      { label: 'Ready',       cls: 'state-qualified', icon: '✦' },
  invite_sent:   { label: 'Sent',        cls: 'state-objection', icon: '→' },
  connected:     { label: 'Connected',   cls: 'state-engaged',   icon: '✓' },
  draft_created: { label: 'Draft',       cls: 'state-booked',    icon: '✎' },
  messaged:      { label: 'Messaged',    cls: 'state-engaged',   icon: '✓' },
  rejected:      { label: 'Declined',    cls: 'state-dead',      icon: '✕' },
};

/* ═══════════════════════════════════════════
   Component
   ═══════════════════════════════════════════ */
export default function ProspectsPage() {
  const [prospects, setProspects] = useState<Prospect[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<ProspectStatus | 'all'>('all');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [instruction, setInstruction] = useState('');
  const [processing, setProcessing] = useState(false);
  const [toast, setToast] = useState<{ msg: string; type: 'ok' | 'err' | 'info' } | null>(null);
  const [searchUrl, setSearchUrl] = useState('');
  const [importing, setImporting] = useState(false);
  const [editP, setEditP] = useState<Prospect | null>(null);
  const [editMsg, setEditMsg] = useState('');
  const [editInstr, setEditInstr] = useState('');
  const [regen, setRegen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toastTimer = useRef<NodeJS.Timeout | null>(null);

  function showToast(msg: string, type: 'ok' | 'err' | 'info' = 'info') {
    setToast({ msg, type });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 5000);
  }

  /* ── Data Loading ── */
  const loadProspects = useCallback(async () => {
    try {
      const url = filter === 'all' ? '/api/prospects' : `/api/prospects?status=${filter}`;
      const res = await fetch(url);
      const data = await res.json();
      setProspects(data.prospects || []);
      setStats(data.stats || null);
    } catch { showToast('Failed to load prospects', 'err'); }
    finally { setLoading(false); }
  }, [filter]);

  useEffect(() => { loadProspects(); }, [loadProspects]);

  useEffect(() => {
    fetch('/api/prospects/instruction').then(r => r.json()).then(d => {
      if (d.instruction) setInstruction(d.instruction);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    const t = setTimeout(() => {
      if (instruction.trim()) {
        fetch('/api/prospects/instruction', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ instruction }),
        }).catch(() => {});
      }
    }, 1500);
    return () => clearTimeout(t);
  }, [instruction]);

  /* ── Actions ── */
  const handleImport = async () => {
    if (!searchUrl.trim()) return;
    setImporting(true);
    try {
      const res = await fetch('/api/prospects/search', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: searchUrl, maxResults: 25 }),
      });
      const d = await res.json();
      if (d.error) { showToast(d.error, 'err'); return; }
      const parts = [`${d.added} imported`];
      if (d.skipped > 0) parts.push(`${d.skipped} skipped`);
      if (d.already_connected > 0) parts.push(`${d.already_connected} already connected`);
      if (d.already_invited > 0) parts.push(`${d.already_invited} already invited`);
      showToast(parts.join(' · '), 'ok');
      setSearchUrl('');
      loadProspects();
    } catch (e: any) { showToast(e.message, 'err'); }
    finally { setImporting(false); }
  };

  const handleEnrich = async () => {
    const ids = selected.size > 0 ? Array.from(selected) : undefined;
    setProcessing(true);
    showToast('Enriching profiles & generating messages…', 'info');
    try {
      const body: any = { prospect_ids: ids, maxCount: 25 };
      if (instruction.trim()) body.instruction = instruction;
      const res = await fetch('/api/prospects/enrich', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const d = await res.json();
      if (d.error) { showToast(d.error, 'err'); return; }
      showToast(`${d.processed}/${d.total} enriched with messages`, 'ok');
      setSelected(new Set());
      loadProspects();
    } catch (e: any) { showToast(e.message, 'err'); }
    finally { setProcessing(false); }
  };

  const handleSendInvites = async () => {
    const ready = prospects.filter(p => p.status === 'enriched' && p.invite_message);
    if (ready.length === 0) { showToast('No prospects with messages ready', 'err'); return; }
    if (!confirm(`Send ${ready.length} connection requests? (50-70s intervals)`)) return;
    setProcessing(true);
    showToast('Sending invites with human-like intervals…', 'info');
    try {
      const ids = selected.size > 0 ? Array.from(selected) : undefined;
      const res = await fetch('/api/prospects/invite', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prospect_ids: ids }),
      });
      const d = await res.json();
      if (d.error) { showToast(d.error, 'err'); return; }
      showToast(`${d.sent} invites sent (${d.sent_today}/${d.daily_limit}/day)`, 'ok');
      setSelected(new Set());
      loadProspects();
    } catch (e: any) { showToast(e.message, 'err'); }
    finally { setProcessing(false); }
  };

  const handleDelete = async (ids: string[]) => {
    if (!confirm(`Delete ${ids.length} prospect(s)?`)) return;
    try {
      await fetch('/api/prospects/delete', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prospect_ids: ids }),
      });
      setSelected(new Set());
      showToast(`${ids.length} removed`, 'ok');
      loadProspects();
    } catch { showToast('Delete failed', 'err'); }
  };

  const openEdit = (p: Prospect) => {
    setEditP(p);
    setEditMsg(p.invite_message || '');
    setEditInstr(instruction);
  };

  const saveMsg = async () => {
    if (!editP) return;
    setSaving(true);
    try {
      await fetch('/api/prospects/update', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prospect_id: editP.id, invite_message: editMsg }),
      });
      setEditP(null);
      showToast('Message saved', 'ok');
      loadProspects();
    } catch { showToast('Save failed', 'err'); }
    finally { setSaving(false); }
  };

  const regenMsg = async () => {
    if (!editP) return;
    setRegen(true);
    try {
      const res = await fetch('/api/prospects/regenerate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prospect_id: editP.id, instruction: editInstr || undefined }),
      });
      const d = await res.json();
      if (d.message) { setEditMsg(d.message); showToast('New message generated', 'ok'); }
      else if (d.error) showToast(d.error, 'err');
    } catch (e: any) { showToast(e.message, 'err'); }
    finally { setRegen(false); }
  };

  const toggleSelect = (id: string) => {
    const s = new Set(selected);
    s.has(id) ? s.delete(id) : s.add(id);
    setSelected(s);
  };

  const toggleExpand = (id: string) => {
    const s = new Set(expanded);
    s.has(id) ? s.delete(id) : s.add(id);
    setExpanded(s);
  };

  const selectAll = () => setSelected(selected.size === prospects.length ? new Set() : new Set(prospects.map(p => p.id)));

  const total = stats ? Object.values(stats).reduce((a, b) => a + b, 0) : prospects.length;
  const importedCount = stats?.imported || 0;
  const enrichedCount = stats?.enriched || 0;

  /* ═══ Styles (inline, scoped) ═══ */
  const s = {
    pipe: { display: 'flex', gap: '8px', marginBottom: '20px' } as React.CSSProperties,
    pipeBtn: (active: boolean, color: string) => ({
      flex: 1, padding: '14px 8px', borderRadius: '12px', cursor: 'pointer', textAlign: 'center' as const,
      background: active ? `${color}12` : 'var(--bg-card)', border: `1px solid ${active ? color + '30' : 'var(--border)'}`,
      transition: 'all 0.2s', minWidth: '80px',
    }),
    pipeNum: (color: string) => ({ fontSize: '22px', fontWeight: 800 as const, color, letterSpacing: '-0.5px', lineHeight: 1 }),
    pipeLbl: { fontSize: '10px', color: 'var(--text-muted)', marginTop: '4px', fontWeight: 600 as const, letterSpacing: '0.5px', textTransform: 'uppercase' as const },
    row: (sel: boolean) => ({
      display: 'flex', alignItems: 'center', gap: '14px', padding: '14px 18px', borderRadius: '12px',
      transition: 'all 0.2s', cursor: 'pointer',
      background: sel ? 'rgba(14, 165, 233, 0.04)' : 'transparent',
      border: `1px solid ${sel ? 'rgba(14, 165, 233, 0.12)' : 'transparent'}`,
    }),
    rowHover: { background: 'var(--bg-card-hover)' },
    check: (sel: boolean) => ({
      width: '18px', height: '18px', borderRadius: '5px', flexShrink: 0 as const, cursor: 'pointer',
      border: `2px solid ${sel ? 'var(--accent)' : 'var(--border)'}`, background: sel ? 'var(--accent)' : 'transparent',
      display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.15s',
    }),
    msgBox: {
      marginTop: '8px', padding: '12px 16px', borderRadius: '10px',
      background: 'var(--bg-secondary)', border: '1px solid var(--border)',
      fontSize: '13px', lineHeight: 1.6, color: 'var(--text-primary)', position: 'relative' as const,
    },
    actionBtn: {
      width: '32px', height: '32px', borderRadius: '8px', border: '1px solid var(--border)',
      background: 'transparent', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: '13px', color: 'var(--text-muted)', transition: 'all 0.15s',
    },
    overlay: {
      position: 'fixed' as const, inset: 0, background: 'rgba(0,0,0,0.75)', display: 'flex',
      alignItems: 'center', justifyContent: 'center', zIndex: 1000, backdropFilter: 'blur(8px)',
      animation: 'fadeIn 0.2s ease-out',
    },
    modal: {
      width: '540px', maxWidth: '92vw', maxHeight: '90vh', overflow: 'auto',
      background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '20px',
      padding: '28px', boxShadow: '0 32px 80px rgba(0,0,0,0.6)',
      animation: 'fadeIn 0.25s ease-out',
    },
  };

  /* ═══ Render ═══ */
  return (
    <div className="page-content">
      {/* Header */}
      <div style={{ marginBottom: '28px' }}>
        <h1 style={{ fontSize: '24px', fontWeight: 800, letterSpacing: '-0.5px' }}>Prospecting</h1>
        <p style={{ color: 'var(--text-muted)', fontSize: '13px', marginTop: '4px' }}>
          {total} total · Find → Enrich → Review → Send
        </p>
      </div>

      {/* Pipeline Stats */}
      {stats && (
        <div style={s.pipe}>
          {([
            { key: 'imported', label: 'Imported', color: '#38bdf8' },
            { key: 'enriched', label: 'Ready', color: '#a78bfa' },
            { key: 'invite_sent', label: 'Sent', color: '#fbbf24' },
            { key: 'connected', label: 'Connected', color: '#34d399' },
            { key: 'messaged', label: 'Messaged', color: '#22d3ee' },
          ] as const).map(step => (
            <div key={step.key}
              onClick={() => setFilter(filter === step.key ? 'all' : step.key)}
              style={s.pipeBtn(filter === step.key, step.color)}>
              <div style={s.pipeNum(step.color)}>{(stats as any)[step.key] || 0}</div>
              <div style={s.pipeLbl}>{step.label}</div>
            </div>
          ))}
        </div>
      )}

      {/* Import */}
      <div className="glass-card" style={{ padding: '20px', marginBottom: '12px' }}>
        <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.8px', textTransform: 'uppercase', marginBottom: '10px' }}>
          Import from Sales Navigator
        </div>
        <div style={{ display: 'flex', gap: '10px' }}>
          <input className="input-field" type="text" placeholder="Paste Sales Navigator list URL…"
            value={searchUrl} onChange={e => setSearchUrl(e.target.value)}
            style={{ flex: 1 }} onKeyDown={e => e.key === 'Enter' && handleImport()} />
          <button className="btn-primary" onClick={handleImport} disabled={importing || !searchUrl.trim()}
            style={{ minWidth: '110px', whiteSpace: 'nowrap' }}>
            {importing ? <span className="pulse-live">Importing…</span> : 'Import'}
          </button>
        </div>
      </div>

      {/* Instruction + Actions */}
      <div className="glass-card" style={{ padding: '20px', marginBottom: '20px' }}>
        <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.8px', textTransform: 'uppercase', marginBottom: '10px' }}>
          Message Instruction <span style={{ fontWeight: 400, letterSpacing: 0, textTransform: 'none', opacity: 0.5 }}>— optional, auto-saved</span>
        </div>
        <textarea className="input-field" value={instruction} onChange={e => setInstruction(e.target.value)} rows={2}
          placeholder="e.g. 'Ik zoek partnerships in tech. Refereer aan hun rol en bedrijf. Schrijf informeel.'"
          style={{ resize: 'vertical', fontSize: '13px', lineHeight: 1.6, fontFamily: 'inherit' }} />
        <div style={{ display: 'flex', gap: '10px', marginTop: '14px', flexWrap: 'wrap', alignItems: 'center' }}>
          <button className="btn-primary" onClick={handleEnrich} disabled={processing || importedCount === 0}
            style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {processing ? <span className="pulse-live">Processing…</span> : <>✦ Enrich &amp; Generate</>}
            {!processing && importedCount > 0 && <span className="badge badge-accent" style={{ fontSize: '10px' }}>{importedCount}</span>}
          </button>
          <button className="btn-success" onClick={handleSendInvites} disabled={processing || enrichedCount === 0}
            style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            Send Invites
            {enrichedCount > 0 && <span className="badge badge-success" style={{ fontSize: '10px' }}>{enrichedCount}</span>}
          </button>
          {selected.size > 0 && (
            <button className="btn-danger" onClick={() => handleDelete(Array.from(selected))} style={{ marginLeft: 'auto' }}>
              Delete {selected.size}
            </button>
          )}
        </div>
      </div>

      {/* Prospect List */}
      <div className="glass-card" style={{ padding: '20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
          <div style={{ fontSize: '14px', fontWeight: 700 }}>
            {filter === 'all' ? 'All Prospects' : STATUS_META[filter as ProspectStatus]?.label}
            <span style={{ color: 'var(--text-muted)', fontWeight: 500, marginLeft: '6px' }}>({prospects.length})</span>
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button className="btn-secondary" onClick={selectAll}
              style={{ padding: '6px 12px', fontSize: '11px', minHeight: '28px' }}>
              {selected.size === prospects.length && prospects.length > 0 ? 'Deselect' : 'Select All'}
            </button>
            {filter !== 'all' && (
              <button className="btn-secondary" onClick={() => setFilter('all')}
                style={{ padding: '6px 12px', fontSize: '11px', minHeight: '28px' }}>Show All</button>
            )}
          </div>
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--text-muted)' }}>
            <div className="pulse-live" style={{ fontSize: '14px' }}>Loading pipeline…</div>
          </div>
        ) : prospects.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '60px 0' }}>
            <div style={{ fontSize: '40px', marginBottom: '12px', opacity: 0.4 }}>Ø</div>
            <p style={{ color: 'var(--text-muted)', fontSize: '14px' }}>No prospects found</p>
            <p style={{ color: 'var(--text-muted)', fontSize: '12px', marginTop: '4px' }}>Import from Sales Navigator to get started</p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
            {prospects.map((p, idx) => {
              const meta = STATUS_META[p.status] || STATUS_META.imported;
              const isExpanded = expanded.has(p.id);
              return (
                <div key={p.id} className="animate-fadeIn" style={{ animationDelay: `${idx * 30}ms` }}>
                  <div style={s.row(selected.has(p.id))}
                    onMouseEnter={e => { if (!selected.has(p.id)) e.currentTarget.style.background = 'var(--bg-card)'; }}
                    onMouseLeave={e => { if (!selected.has(p.id)) e.currentTarget.style.background = 'transparent'; }}>

                    {/* Checkbox */}
                    <div style={s.check(selected.has(p.id))} onClick={e => { e.stopPropagation(); toggleSelect(p.id); }}>
                      {selected.has(p.id) && <svg width="10" height="10" viewBox="0 0 10 10"><path d="M2 5l2 2 4-4" stroke="white" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                    </div>

                    {/* Avatar */}
                    <div className="avatar" style={{
                      backgroundImage: p.profile_picture_url ? `url(${p.profile_picture_url})` : 'none',
                      backgroundSize: 'cover', backgroundPosition: 'center',
                      background: p.profile_picture_url ? `url(${p.profile_picture_url}) center/cover` : undefined,
                    }}>
                      {!p.profile_picture_url && (p.first_name?.[0] || '?')}
                    </div>

                    {/* Info */}
                    <div style={{ flex: 1, minWidth: 0 }} onClick={() => p.invite_message && toggleExpand(p.id)}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{ fontSize: '14px', fontWeight: 600 }}>{p.name}</span>
                        <span className={`state-badge ${meta.cls}`} style={{ fontSize: '10px', padding: '2px 8px' }}>
                          {meta.icon} {meta.label}
                        </span>
                      </div>
                      <div style={{ fontSize: '12px', color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: '2px' }}>
                        {[p.company, p.headline?.substring(0, 60)].filter(Boolean).join(' · ')}
                      </div>
                      {/* Collapsed message preview */}
                      {p.invite_message && !isExpanded && (
                        <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '500px' }}>
                          <span style={{ color: 'var(--accent)', opacity: 0.6 }}>▸</span> {p.invite_message.substring(0, 80)}…
                        </div>
                      )}
                    </div>

                    {/* Actions */}
                    <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
                      <button style={s.actionBtn} title="Edit message" onClick={e => { e.stopPropagation(); openEdit(p); }}
                        onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--accent)'; e.currentTarget.style.color = 'var(--accent)'; }}
                        onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--text-muted)'; }}>
                        ✎
                      </button>
                      <button style={s.actionBtn} title="Delete" onClick={e => { e.stopPropagation(); handleDelete([p.id]); }}
                        onMouseEnter={e => { e.currentTarget.style.borderColor = '#ef4444'; e.currentTarget.style.color = '#ef4444'; }}
                        onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--text-muted)'; }}>
                        ✕
                      </button>
                    </div>
                  </div>

                  {/* Expanded message */}
                  {isExpanded && p.invite_message && (
                    <div style={{ ...s.msgBox, marginLeft: '76px', marginRight: '70px', marginBottom: '4px', animation: 'fadeIn 0.2s ease-out' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                        <span style={{ fontSize: '10px', fontWeight: 700, color: 'var(--accent)', letterSpacing: '0.5px', textTransform: 'uppercase' }}>
                          Connection Request
                        </span>
                        <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
                          {p.invite_message.length}/290
                        </span>
                      </div>
                      {p.invite_message}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ═══ Toast ═══ */}
      {toast && (
        <div style={{
          position: 'fixed', bottom: '24px', right: '24px', zIndex: 2000,
          padding: '12px 20px', borderRadius: '12px', fontSize: '13px', fontWeight: 600,
          maxWidth: '400px', animation: 'fadeIn 0.2s ease-out',
          background: toast.type === 'ok' ? 'rgba(16,185,129,0.15)' : toast.type === 'err' ? 'rgba(239,68,68,0.15)' : 'rgba(14,165,233,0.15)',
          border: `1px solid ${toast.type === 'ok' ? 'rgba(16,185,129,0.25)' : toast.type === 'err' ? 'rgba(239,68,68,0.25)' : 'rgba(14,165,233,0.25)'}`,
          color: toast.type === 'ok' ? '#34d399' : toast.type === 'err' ? '#f87171' : '#38bdf8',
          backdropFilter: 'blur(12px)',
        }}>
          {toast.type === 'ok' ? '✓ ' : toast.type === 'err' ? '✕ ' : '→ '}{toast.msg}
        </div>
      )}

      {/* ═══ Edit Modal ═══ */}
      {editP && (
        <div style={s.overlay} onClick={() => setEditP(null)}>
          <div style={s.modal} onClick={e => e.stopPropagation()}>
            {/* Modal Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '24px' }}>
              <div style={{ display: 'flex', gap: '14px', alignItems: 'center' }}>
                <div className="avatar" style={{
                  width: '48px', height: '48px', fontSize: '18px',
                  backgroundImage: editP.profile_picture_url ? `url(${editP.profile_picture_url})` : 'none',
                  backgroundSize: 'cover', backgroundPosition: 'center',
                  background: editP.profile_picture_url ? `url(${editP.profile_picture_url}) center/cover` : undefined,
                }}>
                  {!editP.profile_picture_url && (editP.first_name?.[0] || '?')}
                </div>
                <div>
                  <div style={{ fontSize: '17px', fontWeight: 700 }}>{editP.name}</div>
                  <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '2px' }}>
                    {[editP.company, editP.headline?.substring(0, 50)].filter(Boolean).join(' · ')}
                  </div>
                </div>
              </div>
              <button onClick={() => setEditP(null)} style={{
                width: '32px', height: '32px', borderRadius: '50%', border: '1px solid var(--border)',
                background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '16px',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>×</button>
            </div>

            {/* Message */}
            <div style={{ marginBottom: '20px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                <label style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.5px', textTransform: 'uppercase' }}>
                  Connection Request
                </label>
                <span style={{ fontSize: '11px', color: editMsg.length > 280 ? 'var(--warning)' : 'var(--text-muted)', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                  {editMsg.length}<span style={{ opacity: 0.4 }}>/290</span>
                </span>
              </div>
              <textarea className="input-field" value={editMsg} onChange={e => setEditMsg(e.target.value.substring(0, 290))}
                rows={5} style={{ fontSize: '14px', lineHeight: 1.65, fontFamily: 'inherit', resize: 'vertical' }} />
            </div>

            {/* Regenerate */}
            <div className="glass-card" style={{ padding: '16px', marginBottom: '24px' }}>
              <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.5px', textTransform: 'uppercase', marginBottom: '8px' }}>
                Regenerate with new instruction
              </div>
              <textarea className="input-field" value={editInstr} onChange={e => setEditInstr(e.target.value)}
                rows={2} placeholder="e.g. 'Maak het informeler' of 'Focus meer op AI'"
                style={{ fontSize: '12px', lineHeight: 1.5, fontFamily: 'inherit', resize: 'none', marginBottom: '10px' }} />
              <button className="btn-secondary" onClick={regenMsg} disabled={regen}
                style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', padding: '8px 14px', minHeight: '34px' }}>
                {regen ? <span className="pulse-live">Generating…</span> : '↻ Regenerate'}
              </button>
            </div>

            {/* Footer */}
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
              <button className="btn-secondary" onClick={() => setEditP(null)}>Cancel</button>
              <button className="btn-success" onClick={saveMsg} disabled={saving}>
                {saving ? 'Saving…' : 'Save Message'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
