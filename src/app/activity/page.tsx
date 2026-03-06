'use client';

import { useState, useEffect } from 'react';

interface Activity {
  id: string;
  type: string;
  prospect: string;
  details: any;
  timestamp: string;
}

interface Label {
  chat_id: string;
  prospect_name: string;
  label: string;
  color: string;
  updated_at: string;
}

const typeConfig: Record<string, { icon: string; label: string; color: string }> = {
  draft_created: { icon: '📝', label: 'Draft aangemaakt', color: 'rgba(59,130,246,0.15)' },
  draft_approved: { icon: '✅', label: 'Draft goedgekeurd', color: 'rgba(16,185,129,0.15)' },
  draft_rejected: { icon: '❌', label: 'Draft verwijderd', color: 'rgba(239,68,68,0.15)' },
  message_sent: { icon: '📤', label: 'Bericht verzonden', color: 'rgba(16,185,129,0.2)' },
  reply_received: { icon: '💬', label: 'Antwoord ontvangen', color: 'rgba(251,191,36,0.15)' },
  label_changed: { icon: '🏷️', label: 'Label gewijzigd', color: 'rgba(168,85,247,0.15)' },
  mode_changed: { icon: '⚙️', label: 'Mode gewijzigd', color: 'rgba(255,255,255,0.05)' },
};

const labelOptions = [
  { value: 'actief', emoji: '🟢', color: '#10b981' },
  { value: 'wacht', emoji: '🟡', color: '#f59e0b' },
  { value: 'warm', emoji: '🔥', color: '#ef4444' },
  { value: 'call_gepland', emoji: '📞', color: '#3b82f6' },
  { value: 'afgewezen', emoji: '🔴', color: '#6b7280' },
  { value: 'klant', emoji: '⭐', color: '#8b5cf6' },
];

export default function ActivityPage() {
  const [activities, setActivities] = useState<Activity[]>([]);
  const [labels, setLabels] = useState<Label[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>('all');

  useEffect(() => { fetchData(); }, []);

  async function fetchData() {
    try {
      const res = await fetch('/api/activity?limit=100');
      if (res.ok) {
        const data = await res.json();
        setActivities(data.activities || []);
        setLabels(data.labels || []);
      }
    } catch (e) { console.error('Activity load error:', e); }
    finally { setLoading(false); }
  }

  async function setLabelForProspect(chatId: string, prospectName: string, label: string) {
    try {
      await fetch('/api/activity', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, prospect_name: prospectName, label }),
      });
      fetchData();
    } catch (e) { console.error('Label error:', e); }
  }

  const filteredActivities = filter === 'all'
    ? activities
    : activities.filter(a => a.type === filter);

  const prospectSummary = new Map<string, { count: number; lastActivity: string; chatId: string; label?: Label }>();
  for (const a of activities) {
    const key = a.prospect;
    if (!prospectSummary.has(key)) {
      const lbl = labels.find(l => l.prospect_name === a.prospect);
      prospectSummary.set(key, { count: 0, lastActivity: a.timestamp, chatId: a.details?.chat_id || '', label: lbl });
    }
    prospectSummary.get(key)!.count++;
  }

  if (loading) {
    return (<div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }}><div className="spinner" /></div>);
  }

  return (
    <div style={{ maxWidth: '1100px', margin: '0 auto' }}>
      <div style={{ marginBottom: '24px' }}>
        <h1 style={{ fontSize: '24px', fontWeight: 700, marginBottom: '4px' }}>📊 Activity & CRM</h1>
        <p style={{ color: 'var(--text-muted)', fontSize: '14px' }}>Overzicht van alle agent-activiteit, prospect tracking en labels</p>
      </div>

      {prospectSummary.size > 0 && (
        <div className="glass-card" style={{ padding: '20px', marginBottom: '20px' }}>
          <h2 style={{ fontSize: '16px', fontWeight: 600, marginBottom: '12px' }}>👥 Prospects ({prospectSummary.size})</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '10px' }}>
            {Array.from(prospectSummary.entries()).map(([name, info]) => (
              <div key={name} style={{ padding: '12px', borderRadius: '10px', border: '1px solid var(--border)', background: 'rgba(255,255,255,0.02)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: '13px', marginBottom: '4px' }}>{name}</div>
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{info.count} activiteiten · {new Date(info.lastActivity).toLocaleDateString('nl-NL')}</div>
                  {info.label && (<span style={{ fontSize: '10px', padding: '2px 6px', borderRadius: '4px', background: info.label.color || 'rgba(255,255,255,0.1)', color: '#fff', marginTop: '4px', display: 'inline-block' }}>{labelOptions.find(l => l.value === info.label!.label)?.emoji} {info.label.label}</span>)}
                </div>
                <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                  {labelOptions.map(opt => (
                    <button key={opt.value} onClick={() => setLabelForProspect(info.chatId, name, opt.value)} title={opt.value} style={{ width: '24px', height: '24px', borderRadius: '6px', border: 'none', background: info.label?.label === opt.value ? opt.color : 'rgba(255,255,255,0.05)', cursor: 'pointer', fontSize: '12px', opacity: info.label?.label === opt.value ? 1 : 0.5 }}>{opt.emoji}</button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="glass-card" style={{ padding: '12px 16px', marginBottom: '16px', display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
        <button onClick={() => setFilter('all')} style={{ padding: '4px 10px', borderRadius: '6px', fontSize: '12px', border: 'none', background: filter === 'all' ? 'var(--accent)' : 'rgba(255,255,255,0.06)', color: filter === 'all' ? '#fff' : 'var(--text-muted)', cursor: 'pointer' }}>Alles ({activities.length})</button>
        {Object.entries(typeConfig).map(([key, cfg]) => {
          const count = activities.filter(a => a.type === key).length;
          if (count === 0) return null;
          return (<button key={key} onClick={() => setFilter(key)} style={{ padding: '4px 10px', borderRadius: '6px', fontSize: '12px', border: 'none', background: filter === key ? cfg.color : 'rgba(255,255,255,0.06)', color: filter === key ? '#fff' : 'var(--text-muted)', cursor: 'pointer' }}>{cfg.icon} {cfg.label} ({count})</button>);
        })}
      </div>

      <div className="glass-card" style={{ padding: '20px' }}>
        <h2 style={{ fontSize: '16px', fontWeight: 600, marginBottom: '12px' }}>📋 Activiteit Timeline</h2>
        {filteredActivities.length === 0 ? (
          <div style={{ padding: '32px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '13px' }}>
            <div style={{ fontSize: '32px', marginBottom: '8px' }}>📭</div>
            Nog geen activiteit. Genereer drafts of zet de copilot aan om te beginnen.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            {filteredActivities.map(activity => {
              const cfg = typeConfig[activity.type] || { icon: '📌', label: activity.type, color: 'rgba(255,255,255,0.05)' };
              return (
                <div key={activity.id} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 12px', borderRadius: '8px', background: cfg.color, fontSize: '13px' }}>
                  <span style={{ fontSize: '16px', flexShrink: 0 }}>{cfg.icon}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ fontWeight: 600 }}>{activity.prospect}</span>
                    <span style={{ color: 'var(--text-muted)', marginLeft: '6px' }}>{cfg.label}</span>
                    {activity.details?.source && (<span style={{ fontSize: '11px', color: 'var(--text-muted)', marginLeft: '6px' }}>({activity.details.source === 'webhook_auto' ? 'auto' : 'handmatig'})</span>)}
                    {activity.details?.phase && (<span style={{ fontSize: '11px', marginLeft: '6px', color: 'var(--text-muted)' }}>· fase: {activity.details.phase}</span>)}
                  </div>
                  <span style={{ fontSize: '11px', color: 'var(--text-muted)', flexShrink: 0 }}>{new Date(activity.timestamp).toLocaleString('nl-NL', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
