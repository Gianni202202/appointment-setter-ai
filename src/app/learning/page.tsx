'use client';

import { useState, useEffect } from 'react';

interface LearningInsights {
  total_drafts: number;
  approval_rate: number;
  edit_rate: number;
  rejection_rate: number;
  reply_rate: number;
  best_phases: { phase: string; approval_rate: number; count: number }[];
  best_opener_styles: { style: string; approval_rate: number; count: number }[];
  optimal_length_range: { min: number; max: number };
  common_edits: string[];
  human_preferred_patterns: string[];
  top_rejection_reasons: { reason: string; count: number }[];
  top_messages: { message: string; phase: string; got_reply: boolean }[];
  last_updated: string;
}

const phaseEmoji: Record<string, string> = {
  koud: '❄️', lauw: '🌤', warm: '🔥', proof: '📹', call: '📞', weerstand: '🛡️', unknown: '❓',
};

export default function LearningPage() {
  const [insights, setInsights] = useState<LearningInsights | null>(null);
  const [loading, setLoading] = useState(true);
  const [reportText, setReportText] = useState('');
  const [generatingReport, setGeneratingReport] = useState(false);

  useEffect(() => {
    fetchInsights();
  }, []);

  async function fetchInsights() {
    try {
      const res = await fetch('/api/agent/learn/insights');
      if (res.ok) setInsights(await res.json());
    } catch (e) { console.error('Failed to load insights:', e); }
    finally { setLoading(false); }
  }

  function generateReport() {
    if (!insights) return;
    setGeneratingReport(true);

    let report = '=== LEARNING REPORT ===\n';
    report += 'Generated: ' + new Date().toLocaleString('nl-NL') + '\n';
    report += 'Based on ' + insights.total_drafts + ' drafts\n\n';

    report += '📊 OVERALL PERFORMANCE:\n';
    report += '- Approval rate: ' + insights.approval_rate + '%\n';
    report += '- Edit rate: ' + insights.edit_rate + '%\n';
    report += '- Rejection rate: ' + insights.rejection_rate + '%\n';
    report += '- Prospect reply rate: ' + insights.reply_rate + '%\n\n';

    if (insights.best_opener_styles.length > 0) {
      report += '🎯 BEST OPENER STYLES:\n';
      insights.best_opener_styles.forEach(s => {
        report += '- "' + s.style + '": ' + s.approval_rate + '% goedgekeurd (' + s.count + ' samples)\n';
      });
      report += '\n';
    }

    if (insights.best_phases.length > 0) {
      report += '📈 PHASE PERFORMANCE:\n';
      insights.best_phases.forEach(p => {
        report += '- ' + p.phase + ': ' + p.approval_rate + '% success (' + p.count + ' drafts)\n';
      });
      report += '\n';
    }

    report += '📏 OPTIMAL MESSAGE LENGTH: ' + insights.optimal_length_range.min + '-' + insights.optimal_length_range.max + ' tekens\n\n';

    if (insights.top_rejection_reasons.length > 0) {
      report += '❌ TOP AFWIJSREDENEN:\n';
      insights.top_rejection_reasons.forEach(r => {
        report += '- "' + r.reason + '" (' + r.count + 'x)\n';
      });
      report += '\n';
    }

    if (insights.common_edits.length > 0) {
      report += '✏️ CORRECTIE PATRONEN:\n';
      insights.common_edits.forEach(e => { report += '- ' + e + '\n'; });
      report += '\n';
    }

    if (insights.human_preferred_patterns.length > 0) {
      report += '✅ VOORKEURSPATRONEN:\n';
      insights.human_preferred_patterns.forEach(p => { report += '- ' + p + '\n'; });
      report += '\n';
    }

    if (insights.top_messages.length > 0) {
      report += '🏆 TOP BERICHTEN (goedgekeurd + reactie ontvangen):\n';
      insights.top_messages.forEach((m, i) => {
        report += (i + 1) + '. [' + m.phase + '] "' + m.message + '"\n';
      });
      report += '\n';
    }

    report += '=== SUGGESTED BEST PRACTICES ===\n';
    report += 'Kopieer relevante punten naar Settings → Best Practices:\n\n';
    if (insights.optimal_length_range.max > 0) {
      report += '- Houd berichten tussen ' + insights.optimal_length_range.min + '-' + insights.optimal_length_range.max + ' tekens\n';
    }
    if (insights.best_opener_styles.length > 0) {
      report += '- Gebruik bij voorkeur een "' + insights.best_opener_styles[0].style + '" opener\n';
    }
    insights.top_rejection_reasons.slice(0, 3).forEach(r => {
      report += '- VERMIJD: ' + r.reason + '\n';
    });

    setReportText(report);
    setGeneratingReport(false);
  }

  function copyReport() {
    navigator.clipboard.writeText(reportText);
  }

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }}>
        <div className="spinner" />
      </div>
    );
  }

  if (!insights || insights.total_drafts === 0) {
    return (
      <div style={{ maxWidth: '800px', margin: '0 auto' }}>
        <h1 style={{ fontSize: '24px', fontWeight: 700, marginBottom: '8px' }}>🧠 Learning & Insights</h1>
        <div className="glass-card" style={{ padding: '48px', textAlign: 'center' }}>
          <div style={{ fontSize: '48px', marginBottom: '16px' }}>📭</div>
          <h2 style={{ fontSize: '18px', fontWeight: 600, marginBottom: '8px' }}>Nog geen learning data</h2>
          <p style={{ color: 'var(--text-muted)', fontSize: '14px', maxWidth: '400px', margin: '0 auto' }}>
            Begin met het goedkeuren of afwijzen van drafts in de Copilot. Na 5+ Draft interacties verschijnen hier de eerste insights.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: '900px', margin: '0 auto' }}>
      <div style={{ marginBottom: '24px' }}>
        <h1 style={{ fontSize: '24px', fontWeight: 700, marginBottom: '4px' }}>🧠 Learning & Insights</h1>
        <p style={{ color: 'var(--text-muted)', fontSize: '14px' }}>
          Leer van {insights.total_drafts} draft interacties — wat werkt, wat niet, en hoe de AI verbetert
        </p>
      </div>

      {/* Stats row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px', marginBottom: '20px' }}>
        {[
          { label: 'Goedgekeurd', value: insights.approval_rate + '%', color: '#10b981', bg: 'rgba(16,185,129,0.12)' },
          { label: 'Bewerkt', value: insights.edit_rate + '%', color: '#f59e0b', bg: 'rgba(245,158,11,0.12)' },
          { label: 'Afgewezen', value: insights.rejection_rate + '%', color: '#ef4444', bg: 'rgba(239,68,68,0.12)' },
          { label: 'Prospect reply rate', value: insights.reply_rate + '%', color: '#3b82f6', bg: 'rgba(59,130,246,0.12)' },
        ].map(stat => (
          <div key={stat.label} className="glass-card" style={{ padding: '16px', textAlign: 'center' }}>
            <div style={{ fontSize: '28px', fontWeight: 800, color: stat.color }}>{stat.value}</div>
            <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{stat.label}</div>
            <div style={{ height: '4px', borderRadius: '2px', background: 'rgba(255,255,255,0.06)', marginTop: '8px', overflow: 'hidden' }}>
              <div style={{ height: '100%', width: stat.value, background: stat.bg, borderRadius: '2px' }} />
            </div>
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '20px' }}>
        {/* Best opener styles */}
        <div className="glass-card" style={{ padding: '20px' }}>
          <h2 style={{ fontSize: '15px', fontWeight: 700, marginBottom: '12px' }}>🎯 Opener Stijlen</h2>
          {insights.best_opener_styles.length === 0 ? (
            <p style={{ color: 'var(--text-muted)', fontSize: '13px' }}>Nog niet genoeg data (min. 2 per stijl)</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {insights.best_opener_styles.map(s => (
                <div key={s.style} style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <div style={{ minWidth: '80px', fontSize: '13px', fontWeight: 600 }}>{s.style}</div>
                  <div style={{ flex: 1, height: '20px', borderRadius: '4px', background: 'rgba(255,255,255,0.06)', overflow: 'hidden', position: 'relative' }}>
                    <div style={{ height: '100%', width: s.approval_rate + '%', background: s.approval_rate > 70 ? 'rgba(16,185,129,0.4)' : s.approval_rate > 50 ? 'rgba(245,158,11,0.4)' : 'rgba(239,68,68,0.3)', borderRadius: '4px', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', paddingRight: '6px' }}>
                      <span style={{ fontSize: '10px', fontWeight: 600, color: '#fff' }}>{s.approval_rate}%</span>
                    </div>
                  </div>
                  <span style={{ fontSize: '11px', color: 'var(--text-muted)', minWidth: '24px' }}>{s.count}x</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Phase performance */}
        <div className="glass-card" style={{ padding: '20px' }}>
          <h2 style={{ fontSize: '15px', fontWeight: 700, marginBottom: '12px' }}>📈 Fase Performance</h2>
          {insights.best_phases.length === 0 ? (
            <p style={{ color: 'var(--text-muted)', fontSize: '13px' }}>Nog niet genoeg data (min. 3 per fase)</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {insights.best_phases.map(p => (
                <div key={p.phase} style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <div style={{ minWidth: '80px', fontSize: '13px', fontWeight: 600 }}>
                    {phaseEmoji[p.phase] || '❓'} {p.phase}
                  </div>
                  <div style={{ flex: 1, height: '20px', borderRadius: '4px', background: 'rgba(255,255,255,0.06)', overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: p.approval_rate + '%', background: p.approval_rate > 70 ? 'rgba(16,185,129,0.4)' : 'rgba(245,158,11,0.4)', borderRadius: '4px', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', paddingRight: '6px' }}>
                      <span style={{ fontSize: '10px', fontWeight: 600, color: '#fff' }}>{p.approval_rate}%</span>
                    </div>
                  </div>
                  <span style={{ fontSize: '11px', color: 'var(--text-muted)', minWidth: '24px' }}>{p.count}x</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '20px' }}>
        {/* Rejection reasons */}
        <div className="glass-card" style={{ padding: '20px' }}>
          <h2 style={{ fontSize: '15px', fontWeight: 700, marginBottom: '12px' }}>❌ Afwijsredenen</h2>
          {insights.top_rejection_reasons.length === 0 ? (
            <p style={{ color: 'var(--text-muted)', fontSize: '13px' }}>Nog geen afwijzingen met feedback</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {insights.top_rejection_reasons.map((r, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 10px', borderRadius: '6px', background: 'rgba(239,68,68,0.06)', fontSize: '13px' }}>
                  <span>{r.reason}</span>
                  <span style={{ color: 'var(--danger)', fontWeight: 600, fontSize: '12px' }}>{r.count}x</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Message length + corrections */}
        <div className="glass-card" style={{ padding: '20px' }}>
          <h2 style={{ fontSize: '15px', fontWeight: 700, marginBottom: '12px' }}>📏 Optimale Lengte & Correcties</h2>
          <div style={{ padding: '12px', borderRadius: '8px', background: 'rgba(59,130,246,0.06)', marginBottom: '12px' }}>
            <div style={{ fontSize: '20px', fontWeight: 700, color: 'var(--accent)' }}>
              {insights.optimal_length_range.min} — {insights.optimal_length_range.max} tekens
            </div>
            <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>Optimale berichtlengte (p25-p75 van goedgekeurde berichten)</div>
          </div>
          {insights.common_edits.length > 0 && (
            <div>
              <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '6px' }}>CORRECTIE PATRONEN:</div>
              {insights.common_edits.map((e, i) => (
                <div key={i} style={{ fontSize: '13px', padding: '4px 0', color: 'var(--text-secondary)' }}>• {e}</div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Top messages */}
      {insights.top_messages.length > 0 && (
        <div className="glass-card" style={{ padding: '20px', marginBottom: '20px' }}>
          <h2 style={{ fontSize: '15px', fontWeight: 700, marginBottom: '12px' }}>🏆 Best Performing Messages</h2>
          <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '12px' }}>Goedgekeurde berichten die een prospect-reactie hebben gekregen</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {insights.top_messages.map((m, i) => (
              <div key={i} style={{ padding: '12px', borderRadius: '8px', background: 'rgba(16,185,129,0.06)', border: '1px solid rgba(16,185,129,0.15)' }}>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '6px' }}>
                  <span style={{ fontSize: '11px', padding: '2px 6px', borderRadius: '4px', background: 'rgba(59,130,246,0.15)', color: 'var(--accent)' }}>
                    {phaseEmoji[m.phase] || ''} {m.phase}
                  </span>
                  {m.got_reply && <span style={{ fontSize: '11px', color: 'var(--success)' }}>✅ Positieve reactie</span>}
                </div>
                <div style={{ fontSize: '13px', color: 'var(--text-secondary)', fontStyle: 'italic' }}>"{m.message}"</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Generate Report */}
      <div className="glass-card" style={{ padding: '20px' }}>
        <h2 style={{ fontSize: '15px', fontWeight: 700, marginBottom: '8px' }}>📋 Learning Report</h2>
        <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '12px' }}>
          Genereer een samenvatting van alle learning data. Kopieer relevante punten naar Settings → Best Practices om de AI te verbeteren.
        </p>
        <div style={{ display: 'flex', gap: '8px', marginBottom: reportText ? '12px' : '0' }}>
          <button className="btn-primary" onClick={generateReport} disabled={generatingReport} style={{ fontSize: '13px', padding: '10px 20px' }}>
            {generatingReport ? '⏳ Genereren...' : '📊 Genereer Report'}
          </button>
          {reportText && (
            <button className="btn-secondary" onClick={copyReport} style={{ fontSize: '13px', padding: '10px 20px' }}>
              📋 Kopieer Report
            </button>
          )}
        </div>
        {reportText && (
          <pre style={{
            padding: '16px', borderRadius: '8px', background: 'rgba(0,0,0,0.3)',
            fontSize: '12px', color: 'var(--text-secondary)', whiteSpace: 'pre-wrap',
            border: '1px solid var(--border)', maxHeight: '400px', overflowY: 'auto',
          }}>
            {reportText}
          </pre>
        )}
      </div>
    </div>
  );
}
