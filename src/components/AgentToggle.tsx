'use client';

import { useState } from 'react';

interface AgentToggleProps {
  initialEnabled: boolean;
}

export default function AgentToggle({ initialEnabled }: AgentToggleProps) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [loading, setLoading] = useState(false);

  async function toggle() {
    const newState = !enabled;

    // Confirmation when turning ON
    if (newState) {
      const confirmed = confirm(
        '⚠️ Are you sure you want to ACTIVATE the AI agent?\n\n' +
        'The agent will automatically respond to incoming LinkedIn messages based on your settings.\n\n' +
        'Safety measures are in place:\n' +
        '• Random delays (45s – 8min)\n' +
        '• Max 15 messages/day\n' +
        '• Working hours only (9:00 – 18:00)\n' +
        '• No weekend responses\n' +
        '• Loop prevention active'
      );
      if (!confirmed) return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/agent/toggle', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: newState }),
      });
      if (res.ok) {
        const data = await res.json();
        setEnabled(data.enabled);
      }
    } catch (err) {
      console.error('Toggle failed:', err);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="glass-card" style={{
      padding: '24px',
      borderLeft: `4px solid ${enabled ? 'var(--success)' : 'var(--danger)'}`,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
            <div style={{
              width: '12px', height: '12px', borderRadius: '50%',
              background: enabled ? 'var(--success)' : 'var(--danger)',
              boxShadow: enabled ? '0 0 12px rgba(16, 185, 129, 0.5)' : '0 0 12px rgba(239, 68, 68, 0.3)',
              animation: enabled ? 'pulse 2s infinite' : 'none',
            }} />
            <h2 style={{ fontSize: '18px', fontWeight: 700, margin: 0 }}>
              AI Agent — {enabled ? 'Active' : 'Inactive'}
            </h2>
          </div>
          <p style={{ fontSize: '13px', color: 'var(--text-secondary)', margin: 0 }}>
            {enabled
              ? 'Agent is responding to incoming LinkedIn messages automatically.'
              : 'Agent is paused. No automatic responses will be sent.'
            }
          </p>
          {enabled && (
            <div style={{
              display: 'flex', gap: '16px', marginTop: '12px',
              fontSize: '11px', color: 'var(--text-muted)',
            }}>
              <span>🕐 Working hours only</span>
              <span>🔄 Max 15/day</span>
              <span>⏱️ Random delays</span>
              <span>🛡️ Loop protection</span>
            </div>
          )}
        </div>

        <button
          onClick={toggle}
          disabled={loading}
          style={{
            position: 'relative',
            width: '64px', height: '34px',
            borderRadius: '17px',
            border: 'none',
            cursor: loading ? 'wait' : 'pointer',
            transition: 'all 0.3s ease',
            background: enabled
              ? 'linear-gradient(135deg, #10b981, #34d399)'
              : 'linear-gradient(135deg, #374151, #4b5563)',
            boxShadow: enabled
              ? '0 0 20px rgba(16, 185, 129, 0.4)'
              : '0 2px 4px rgba(0,0,0,0.2)',
          }}
        >
          <div style={{
            position: 'absolute',
            top: '3px',
            left: enabled ? '33px' : '3px',
            width: '28px', height: '28px',
            borderRadius: '14px',
            background: 'white',
            transition: 'left 0.3s ease',
            boxShadow: '0 2px 4px rgba(0,0,0,0.2)',
          }} />
        </button>
      </div>
    </div>
  );
}
