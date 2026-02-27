import { getConfig } from '@/lib/database';

export const dynamic = 'force-dynamic';

export default function SettingsPage() {
  const config = getConfig();

  return (
    <div>
      <div style={{ marginBottom: '32px' }}>
        <h1 style={{ fontSize: '28px', fontWeight: 800, marginBottom: '4px' }}>
          Agent Settings
        </h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: '14px' }}>
          Configure how your AI appointment setter behaves
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
        {/* ICP Settings */}
        <div className="glass-card" style={{ padding: '24px' }}>
          <h2 style={{ fontSize: '16px', fontWeight: 700, marginBottom: '20px' }}>
            �� Ideal Customer Profile
          </h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div>
              <label style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 600, display: 'block', marginBottom: '6px' }}>
                TARGET INDUSTRIES
              </label>
              <input className="input-field" defaultValue={config.icp.industries.join(', ')} />
            </div>
            <div>
              <label style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 600, display: 'block', marginBottom: '6px' }}>
                TARGET ROLES
              </label>
              <input className="input-field" defaultValue={config.icp.roles.join(', ')} />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <div>
                <label style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 600, display: 'block', marginBottom: '6px' }}>
                  MIN COMPANY SIZE
                </label>
                <input className="input-field" type="number" defaultValue={config.icp.company_size_min} />
              </div>
              <div>
                <label style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 600, display: 'block', marginBottom: '6px' }}>
                  MAX COMPANY SIZE
                </label>
                <input className="input-field" type="number" defaultValue={config.icp.company_size_max} />
              </div>
            </div>
            <div>
              <label style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 600, display: 'block', marginBottom: '6px' }}>
                KEY SIGNALS / KEYWORDS
              </label>
              <input className="input-field" defaultValue={config.icp.keywords.join(', ')} />
            </div>
            <div>
              <label style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 600, display: 'block', marginBottom: '6px' }}>
                ICP DESCRIPTION
              </label>
              <textarea className="input-field" rows={3} defaultValue={config.icp.description} style={{ resize: 'vertical' }} />
            </div>
          </div>
        </div>

        {/* Tone Settings */}
        <div className="glass-card" style={{ padding: '24px' }}>
          <h2 style={{ fontSize: '16px', fontWeight: 700, marginBottom: '20px' }}>
            🗣️ Tone of Voice
          </h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div>
              <label style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 600, display: 'block', marginBottom: '6px' }}>
                YOUR NAME (used in messages)
              </label>
              <input className="input-field" defaultValue={config.tone.first_person_name} />
            </div>
            <div>
              <label style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 600, display: 'block', marginBottom: '6px' }}>
                COMMUNICATION STYLE
              </label>
              <select className="input-field" defaultValue={config.tone.style}>
                <option value="professional">Professional</option>
                <option value="casual">Casual</option>
                <option value="friendly">Friendly</option>
                <option value="authoritative">Authoritative</option>
              </select>
            </div>
            <div>
              <label style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 600, display: 'block', marginBottom: '6px' }}>
                LANGUAGE
              </label>
              <select className="input-field" defaultValue={config.tone.language}>
                <option value="nl">Nederlands</option>
                <option value="en">English</option>
                <option value="de">Deutsch</option>
              </select>
            </div>
            <div>
              <label style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 600, display: 'block', marginBottom: '6px' }}>
                MAX MESSAGE LENGTH (characters)
              </label>
              <input className="input-field" type="number" defaultValue={config.tone.max_message_length} />
            </div>
            <div>
              <label style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 600, display: 'block', marginBottom: '6px' }}>
                EXAMPLE MESSAGES (one per line)
              </label>
              <textarea className="input-field" rows={4} defaultValue={config.tone.example_messages.join('\n')} style={{ resize: 'vertical' }} />
            </div>
          </div>
        </div>

        {/* Rules */}
        <div className="glass-card" style={{ padding: '24px' }}>
          <h2 style={{ fontSize: '16px', fontWeight: 700, marginBottom: '20px' }}>
            📋 Agent Rules
          </h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div>
              <label style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 600, display: 'block', marginBottom: '6px' }}>
                YOUR OFFER / SERVICE
              </label>
              <textarea className="input-field" rows={3} defaultValue={config.rules.offer_description} style={{ resize: 'vertical' }} />
            </div>
            <div>
              <label style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 600, display: 'block', marginBottom: '6px' }}>
                CONVERSATION GOAL
              </label>
              <textarea className="input-field" rows={2} defaultValue={config.rules.goal} style={{ resize: 'vertical' }} />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <div>
                <label style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 600, display: 'block', marginBottom: '6px' }}>
                  MAX FOLLOW-UPS
                </label>
                <input className="input-field" type="number" defaultValue={config.rules.max_follow_ups} />
              </div>
              <div>
                <label style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 600, display: 'block', marginBottom: '6px' }}>
                  FOLLOW-UP DELAY (hours)
                </label>
                <input className="input-field" type="number" defaultValue={config.rules.follow_up_delay_hours} />
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <div>
                <label style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 600, display: 'block', marginBottom: '6px' }}>
                  WORKING HOURS START
                </label>
                <input className="input-field" type="number" defaultValue={config.rules.working_hours_start} min={0} max={23} />
              </div>
              <div>
                <label style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 600, display: 'block', marginBottom: '6px' }}>
                  WORKING HOURS END
                </label>
                <input className="input-field" type="number" defaultValue={config.rules.working_hours_end} min={0} max={23} />
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '8px' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer' }}>
                <input type="checkbox" defaultChecked={config.rules.no_links_first_touch} />
                <span style={{ fontSize: '13px' }}>No links in first message</span>
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer' }}>
                <input type="checkbox" defaultChecked={config.rules.no_calendar_first_touch} />
                <span style={{ fontSize: '13px' }}>No calendar links in first message</span>
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer' }}>
                <input type="checkbox" defaultChecked={config.rules.auto_respond} />
                <span style={{ fontSize: '13px' }}>Auto-respond to new messages (agent mode)</span>
              </label>
            </div>
          </div>
        </div>

        {/* Blacklist */}
        <div className="glass-card" style={{ padding: '24px' }}>
          <h2 style={{ fontSize: '16px', fontWeight: 700, marginBottom: '20px' }}>
            🚫 Blacklist
          </h2>
          <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '16px' }}>
            People or companies the agent should never contact. One per line.
          </p>
          <textarea
            className="input-field"
            rows={8}
            placeholder="jan.janssen@example.com&#10;CompetitorBV&#10;..."
            defaultValue={config.blacklist.join('\n')}
            style={{ resize: 'vertical' }}
          />
        </div>
      </div>

      {/* Save button */}
      <div style={{ marginTop: '24px', display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
        <button className="btn-secondary">Reset to Defaults</button>
        <button className="btn-primary" style={{ padding: '14px 32px', fontSize: '15px' }}>
          💾 Save Settings
        </button>
      </div>
    </div>
  );
}
