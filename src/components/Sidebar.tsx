'use client';

import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { useState, useEffect, useCallback } from 'react';

export default function Sidebar() {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [agentMode, setAgentMode] = useState('off');
  const [queueCount, setQueueCount] = useState(0);

  const refreshStatus = useCallback(() => {
    // Read mode from localStorage (source of truth — survives Vercel cold starts)
    const savedMode = typeof window !== 'undefined' ? localStorage.getItem('agent-mode') : null;
    if (savedMode && ['off', 'copilot', 'auto'].includes(savedMode)) {
      setAgentMode(savedMode);
    }
    fetch('/api/agent/queue')
      .then(r => r.json())
      .then(d => setQueueCount(d.counts?.pending || 0))
      .catch(() => {});
  }, []);

  // Refresh on pathname change
  useEffect(() => { refreshStatus(); }, [pathname, refreshStatus]);

  // Listen for mode changes from dashboard
  useEffect(() => {
    const handler = (e: CustomEvent) => {
      setAgentMode(e.detail);
    };
    window.addEventListener('agent-mode-changed', handler as EventListener);
    return () => window.removeEventListener('agent-mode-changed', handler as EventListener);
  }, []);

  // Auto-poll every 10 seconds when in active mode
  useEffect(() => {
    if (agentMode === 'off') return;
    const interval = setInterval(refreshStatus, 10000);
    return () => clearInterval(interval);
  }, [agentMode, refreshStatus]);

  useEffect(() => { setMobileOpen(false); }, [pathname]);

  const links = [
    { href: '/', label: 'Dashboard', icon: (
      <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
        <rect x="3" y="3" width="7" height="7" rx="1" />
        <rect x="14" y="3" width="7" height="7" rx="1" />
        <rect x="3" y="14" width="7" height="7" rx="1" />
        <rect x="14" y="14" width="7" height="7" rx="1" />
      </svg>
    )},
    { href: '/conversations', label: 'Conversations', icon: (
      <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      </svg>
    )},
    { href: '/activity', label: 'Activity & CRM', icon: (
      <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
        <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
      </svg>
    )},
    { href: '/learning', label: 'Learning', icon: (
      <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
        <path d="M12 2L2 7l10 5 10-5-10-5z" />
        <path d="M2 17l10 5 10-5" />
        <path d="M2 12l10 5 10-5" />
      </svg>
    )},
    { href: '/settings', label: 'Settings', icon: (
      <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="3" />
        <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
      </svg>
    )},
  ];

  const modeColors: Record<string, string> = {
    auto: 'var(--success)',
    copilot: 'var(--accent)',
    off: 'var(--text-muted)',
  };

  const modeLabels: Record<string, string> = {
    auto: '🤖 Auto Mode',
    copilot: '👤 Copilot Mode',
    off: '⏸ Agent Off',
  };

  const modeDescriptions: Record<string, string> = {
    auto: 'Responding automatically with human timing',
    copilot: queueCount > 0 ? queueCount + ' drafts pending review' : 'Monitoring chats for new messages',
    off: 'No automatic responses',
  };

  return (
    <>
      <button className="hamburger-btn" onClick={() => setMobileOpen(!mobileOpen)}>
        {mobileOpen ? '✕' : '☰'}
      </button>

      <div
        className={`sidebar-overlay ${mobileOpen ? 'open' : ''}`}
        onClick={() => setMobileOpen(false)}
      />

      <nav className={`sidebar ${mobileOpen ? 'open' : ''}`}>
        <div style={{ marginBottom: '32px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '0 16px' }}>
            <div style={{
              width: '36px', height: '36px', borderRadius: '10px',
              background: 'linear-gradient(135deg, #0ea5e9, #06b6d4)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontWeight: 800, fontSize: '16px'
            }}>
              👻
            </div>
            <div>
              <div style={{ fontWeight: 700, fontSize: '16px', color: 'var(--text-primary)' }}>
                GhostDM
              </div>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                by Jarvis
              </div>
            </div>
          </div>
        </div>

        {links.map(link => {
          const isActive = link.href === '/' ? pathname === '/' : pathname.startsWith(link.href);
          return (
            <Link key={link.href} href={link.href} className={`sidebar-link ${isActive ? 'active' : ''}`}>
              {link.icon}
              <span style={{ flex: 1 }}>{link.label}</span>
              {link.href === '/' && queueCount > 0 && (
                <span className="badge badge-warning">{queueCount}</span>
              )}
            </Link>
          );
        })}

        <div style={{ flex: 1 }} />

        <div style={{
          padding: '14px 16px',
          background: 'var(--bg-card)',
          borderRadius: '12px',
          border: `1px solid ${agentMode === 'auto' ? 'rgba(16,185,129,0.3)' : agentMode === 'copilot' ? 'rgba(59,130,246,0.3)' : 'var(--border)'}`,
          transition: 'border-color 0.3s ease',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
            <div style={{
              width: '8px', height: '8px', borderRadius: '50%',
              background: modeColors[agentMode] || 'var(--text-muted)',
            }} className={agentMode !== 'off' ? 'pulse-live' : ''} />
            <span style={{
              fontSize: '12px', fontWeight: 600,
              color: modeColors[agentMode] || 'var(--text-muted)',
            }}>
              {modeLabels[agentMode] || 'Unknown'}
            </span>
          </div>
          <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
            {modeDescriptions[agentMode] || 'No automatic responses'}
          </div>
        </div>
      </nav>
    </>
  );
}
