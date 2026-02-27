import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AI Appointment Setter — LinkedIn DM Agent",
  description: "AI-powered LinkedIn DM management and appointment setting dashboard",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="nl">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
      </head>
      <body>
        <div style={{ display: 'flex' }}>
          {/* Sidebar */}
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

            <a href="/" className="sidebar-link active">
              <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <rect x="3" y="3" width="7" height="7" rx="1" />
                <rect x="14" y="3" width="7" height="7" rx="1" />
                <rect x="3" y="14" width="7" height="7" rx="1" />
                <rect x="14" y="14" width="7" height="7" rx="1" />
              </svg>
              Dashboard
            </a>

            <a href="/conversations" className="sidebar-link">
              <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
              Conversations
            </a>

            <a href="/settings" className="sidebar-link">
              <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <circle cx="12" cy="12" r="3" />
                <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
              </svg>
              Settings
            </a>

            <div style={{ flex: 1 }} />

            <div style={{
              padding: '16px',
              background: 'var(--bg-card)',
              borderRadius: '12px',
              border: '1px solid var(--border)',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                <div className="pulse-live" style={{
                  width: '8px', height: '8px', borderRadius: '50%',
                  background: 'var(--success)'
                }} />
                <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--success)' }}>
                  Agent Active
                </span>
              </div>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                Connected to Unipile
              </div>
            </div>
          </nav>

          {/* Main content */}
          <main className="main-content">
            {children}
          </main>
        </div>
      </body>
    </html>
  );
}
