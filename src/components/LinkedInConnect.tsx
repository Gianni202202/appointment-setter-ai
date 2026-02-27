'use client';

import { useState, useEffect, useRef } from 'react';

interface SyncedConversation {
  id: string;
  chat_id: string;
  name: string;
  headline: string;
  company: string;
  auto_respond: boolean;
}

export default function LinkedInConnect() {
  const [status, setStatus] = useState<{
    connected: boolean;
    name?: string;
    account_id?: string;
    status?: string;
    reason?: string;
  }>({ connected: false });
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<{
    synced_count: number;
    synced: SyncedConversation[];
    message: string;
  } | null>(null);
  const pollRef = useRef<NodeJS.Timeout | null>(null);
  const pollCountRef = useRef(0);
  const MAX_POLLS = 12; // Max 60 seconds of polling

  useEffect(() => {
    checkStatus();
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  async function checkStatus() {
    try {
      const res = await fetch('/api/unipile/status');
      if (res.ok) {
        const data = await res.json();
        setStatus(data);
        // Stop polling if connected
        if (data.connected && pollRef.current) {
          clearInterval(pollRef.current);
          pollRef.current = null;
          setConnecting(false);
        }
      }
    } catch (err) {
      console.error('Status check failed:', err);
    } finally {
      setLoading(false);
    }
  }

  async function connectLinkedIn() {
    setConnecting(true);
    try {
      const res = await fetch('/api/unipile/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ redirect_url: window.location.origin }),
      });

      if (res.ok) {
        const data = await res.json();
        if (data.url) {
          // Open auth popup
          const popup = window.open(data.url, '_blank', 'width=600,height=700');

          // Start polling for connection status every 5 seconds (max 60s)
          pollCountRef.current = 0;
          // The user will complete auth in the popup, and we'll detect it
          pollRef.current = setInterval(() => {
            pollCountRef.current++;
            if (pollCountRef.current >= MAX_POLLS) {
              if (pollRef.current) clearInterval(pollRef.current);
              pollRef.current = null;
              setConnecting(false);
              return;
            }
            checkStatus();
          }, 5000);

          // Also detect popup close
          const checkPopup = setInterval(() => {
            if (popup && popup.closed) {
              clearInterval(checkPopup);
              // Give it a moment, then check status
              setTimeout(() => checkStatus(), 2000);
            }
          }, 1000);
        } else {
          alert('No auth URL received. Check your Unipile configuration.');
          setConnecting(false);
        }
      } else {
        const err = await res.json();
        alert(`Connection failed: ${err.error}\n\nMake sure UNIPILE_DSN and UNIPILE_API_KEY are set in your environment variables.`);
        setConnecting(false);
      }
    } catch (err) {
      console.error('Connect failed:', err);
      alert('Failed to connect. Check console for details.');
      setConnecting(false);
    }
  }

  async function syncChats() {
    setSyncing(true);
    setSyncResult(null);
    try {
      const res = await fetch('/api/unipile/sync', { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        setSyncResult(data);
      } else {
        const err = await res.json();
        alert(`Sync failed: ${err.error}\n${err.details || ''}`);
      }
    } catch (err) {
      console.error('Sync failed:', err);
    } finally {
      setSyncing(false);
    }
  }

  if (loading) {
    return (
      <div className="glass-card" style={{ padding: '24px' }}>
        <div style={{ fontSize: '13px', color: 'var(--text-muted)' }}>Checking LinkedIn connection...</div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {/* Connection Status Card */}
      <div className="glass-card" style={{
        padding: '24px',
        borderLeft: `4px solid ${status.connected ? 'var(--success)' : '#f59e0b'}`,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="#0A66C2">
                <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/>
              </svg>
              <h2 style={{ fontSize: '18px', fontWeight: 700, margin: 0 }}>
                LinkedIn — {status.connected ? 'Connected' : 'Not Connected'}
              </h2>
            </div>
            {status.connected ? (
              <div>
                <p style={{ fontSize: '13px', color: 'var(--text-secondary)', margin: '0 0 4px 0' }}>
                  Account: <strong>{status.name}</strong>
                </p>
                <p style={{ fontSize: '11px', color: 'var(--text-muted)', margin: 0 }}>
                  Status: {status.status || 'Active'} • ID: {status.account_id}
                </p>
              </div>
            ) : (
              <p style={{ fontSize: '13px', color: 'var(--text-secondary)', margin: 0 }}>
                {connecting
                  ? 'Waiting for you to complete LinkedIn authentication...'
                  : status.reason === 'no_credentials'
                    ? 'Unipile API credentials not configured. Add UNIPILE_DSN and UNIPILE_API_KEY to your environment variables.'
                    : 'Connect your LinkedIn account to sync conversations and start the AI agent.'
                }
              </p>
            )}
          </div>

          <div style={{ display: 'flex', gap: '8px', flexShrink: 0 }}>
            {status.connected ? (
              <>
                <button className="btn-secondary" style={{ fontSize: '13px' }} onClick={checkStatus}>
                  🔄 Refresh
                </button>
                <button
                  className="btn-primary"
                  style={{
                    fontSize: '13px', padding: '10px 20px',
                    opacity: syncing ? 0.6 : 1,
                  }}
                  onClick={syncChats}
                  disabled={syncing}
                >
                  {syncing ? '⏳ Syncing...' : '📥 Sync Chats'}
                </button>
              </>
            ) : (
              <button
                className="btn-primary"
                style={{
                  fontSize: '14px', padding: '12px 24px',
                  background: 'linear-gradient(135deg, #0A66C2, #004182)',
                  opacity: connecting ? 0.6 : 1,
                }}
                onClick={connectLinkedIn}
                disabled={connecting}
              >
                {connecting ? '⏳ Waiting for auth...' : '🔗 Connect LinkedIn'}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Sync Results */}
      {syncResult && (
        <div className="glass-card" style={{ padding: '24px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
            <h3 style={{ fontSize: '16px', fontWeight: 700, margin: 0 }}>
              📥 Synced Conversations
            </h3>
            <span style={{
              fontSize: '12px', padding: '4px 12px', borderRadius: '12px',
              background: 'rgba(16, 185, 129, 0.15)', color: '#34d399', fontWeight: 600,
            }}>
              {syncResult.synced_count} new
            </span>
          </div>

          <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '16px' }}>
            {syncResult.message}
          </p>

          {syncResult.synced.length > 0 && (
            <div style={{
              border: '1px solid var(--border)', borderRadius: '12px', overflow: 'hidden',
            }}>
              <div style={{
                padding: '12px 16px', fontSize: '11px', fontWeight: 600,
                color: 'var(--text-muted)', textTransform: 'uppercase',
                background: 'var(--bg-secondary)', letterSpacing: '0.05em',
              }}>
                ⚠️ All conversations start with auto-respond OFF. Go to each conversation to review and enable.
              </div>
              {syncResult.synced.map((conv, i) => (
                <a
                  key={conv.id}
                  href={`/conversations/${conv.id}`}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '12px',
                    padding: '14px 16px', textDecoration: 'none', color: 'inherit',
                    borderTop: i > 0 ? '1px solid var(--border)' : 'none',
                    transition: 'background 0.2s ease',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-secondary)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                >
                  <div className="avatar">
                    {conv.name.split(' ').map(n => n[0]).join('').slice(0, 2)}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600, fontSize: '14px' }}>{conv.name}</div>
                    {conv.headline && (
                      <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{conv.headline}</div>
                    )}
                  </div>
                  <span style={{
                    fontSize: '11px', padding: '4px 10px', borderRadius: '8px',
                    background: 'rgba(239, 68, 68, 0.1)', color: '#f87171', fontWeight: 600,
                  }}>
                    Auto-respond OFF
                  </span>
                  <span style={{ fontSize: '13px', color: 'var(--accent)' }}>Review →</span>
                </a>
              ))}
            </div>
          )}
        </div>
      )}

      {/* How it works card — only show when not connected and not connecting */}
      {!status.connected && !connecting && (
        <div className="glass-card" style={{ padding: '24px' }}>
          <h3 style={{ fontSize: '14px', fontWeight: 700, marginBottom: '16px' }}>
            🛡️ How it works — Your safety is guaranteed
          </h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div style={{ display: 'flex', alignItems: 'start', gap: '10px' }}>
                <span style={{ fontSize: '18px' }}>1️⃣</span>
                <div>
                  <div style={{ fontSize: '13px', fontWeight: 600, marginBottom: '2px' }}>Connect</div>
                  <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                    Log in with your LinkedIn credentials via Unipile&apos;s secure auth
                  </div>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'start', gap: '10px' }}>
                <span style={{ fontSize: '18px' }}>2️⃣</span>
                <div>
                  <div style={{ fontSize: '13px', fontWeight: 600, marginBottom: '2px' }}>Sync</div>
                  <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                    Pull in your existing LinkedIn conversations — nothing gets sent
                  </div>
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div style={{ display: 'flex', alignItems: 'start', gap: '10px' }}>
                <span style={{ fontSize: '18px' }}>3️⃣</span>
                <div>
                  <div style={{ fontSize: '13px', fontWeight: 600, marginBottom: '2px' }}>Review</div>
                  <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                    Choose which conversations the agent may handle — you decide per person
                  </div>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'start', gap: '10px' }}>
                <span style={{ fontSize: '18px' }}>4️⃣</span>
                <div>
                  <div style={{ fontSize: '13px', fontWeight: 600, marginBottom: '2px' }}>Test First</div>
                  <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                    Preview what the AI would say — nothing is sent until you approve
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
