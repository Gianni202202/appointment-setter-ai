'use client';

import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { useState, useEffect } from 'react';

export default function Sidebar() {
  const pathname = usePathname();
  const [agentActive, setAgentActive] = useState(false);
  const [linkedInConnected, setLinkedInConnected] = useState(false);

  useEffect(() => {
    fetch('/api/agent/toggle')
      .then(res => res.json())
      .then(data => setAgentActive(data.enabled))
      .catch(() => setAgentActive(false));

    fetch('/api/unipile/status')
      .then(res => res.json())
      .then(data => setLinkedInConnected(data.connected))
      .catch(() => setLinkedInConnected(false));
  }, []);

  useEffect(() => {
    fetch('/api/agent/toggle')
      .then(res => res.json())
      .then(data => setAgentActive(data.enabled))
      .catch(() => {});
  }, [pathname]);

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
    { href: '/settings', label: 'Settings', icon: (
      <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="3" />
        <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
      </svg>
    )},
  ];

  return (
    <nav className="sidebar">
      <div style={{ marginBottom: '32px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '0 16px' }}>
          <div style={{
            width: '36px', height: '36px', borderRadius: '10px',
            background: 'linear-gradient(135deg, #1d4ed8, #3b82f6)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontWeight: 800, fontSize: '16px'
          }}>
            AI
          </div>
          <div>
            <div style={{ fontWeight: 700, fontSize: '16px', color: 'var(--text-primary)' }}>
              AppointmentAI
            </div>
            <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
              LinkedIn DM Agent
            </div>
          </div>
        </div>
      </div>

      {links.map(link => {
        const isActive = link.href === '/'
          ? pathname === '/'
          : pathname.startsWith(link.href);

        return (
          <Link
            key={link.href}
            href={link.href}
            className={`sidebar-link ${isActive ? 'active' : ''}`}
          >
            {link.icon}
            {link.label}
          </Link>
        );
      })}

      <div style={{ flex: 1 }} />

      <div style={{
        padding: '16px',
        background: 'var(--bg-card)',
        borderRadius: '12px',
        border: '1px solid var(--border)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
          <div style={{
            width: '8px', height: '8px', borderRadius: '50%',
            background: agentActive ? 'var(--success)' : 'var(--danger)',
            ...(agentActive ? { animation: 'pulse 2s infinite' } : {}),
          }} />
          <span style={{
            fontSize: '12px', fontWeight: 600,
            color: agentActive ? 'var(--success)' : 'var(--danger)',
          }}>
            Agent {agentActive ? 'Active' : 'Inactive'}
          </span>
        </div>
        <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
          {linkedInConnected
            ? (agentActive ? 'Responding to messages' : 'LinkedIn connected · Agent paused')
            : 'LinkedIn not connected'
          }
        </div>
      </div>
    </nav>
  );
}
