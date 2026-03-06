'use client';

import { useState } from 'react';

interface AgentConfig {
  icp: {
    industries: string[];
    roles: string[];
    company_size_min: number;
    company_size_max: number;
    keywords: string[];
    description: string;
  };
  tone: {
    style: string;
    language: string;
    max_message_length: number;
    first_person_name: string;
    example_messages: string[];
  };
  rules: {
    no_links_first_touch: boolean;
    no_calendar_first_touch: boolean;
    max_follow_ups: number;
    follow_up_delay_hours: number;
    auto_respond: boolean;
    working_hours_start: number;
    working_hours_end: number;
    goal: string;
    offer_description: string;
  };
  blacklist: string[];
  best_practices: string;
  strategies: { id: string; name: string; scenario: string; template: string; instruction: string; active: boolean }[];
}

interface SettingsFormProps {
  initialConfig: AgentConfig;
}

export default function SettingsForm({ initialConfig }: SettingsFormProps) {
  const [config, setConfig] = useState(initialConfig);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  function updateIcp(key: string, value: unknown) {
    setConfig(prev => ({ ...prev, icp: { ...prev.icp, [key]: value } }));
  }

  function updateTone(key: string, value: unknown) {
    setConfig(prev => ({ ...prev, tone: { ...prev.tone, [key]: value } }));
  }

  function updateRules(key: string, value: unknown) {
    setConfig(prev => ({ ...prev, rules: { ...prev.rules, [key]: value } }));
  }

  function addStrategy() {
    const id = 'strat_' + Date.now();
    setConfig(prev => ({
      ...prev,
      strategies: [...(prev.strategies || []), {
        id, name: '', scenario: 'connection_follow_up',
        template: '', instruction: 'Gebruik de invalshoek en toon uit dit template als inspiratie, maar pas het aan op de prospect en hun context. Maak het kort en persoonlijk.',
        active: true,
      }],
    }));
  }

  function updateStrategy(id: string, key: string, value: unknown) {
    setConfig(prev => ({
      ...prev,
      strategies: (prev.strategies || []).map(s => s.id === id ? { ...s, [key]: value } : s),
    }));
  }

  function removeStrategy(id: string) {
    setConfig(prev => ({
      ...prev,
      strategies: (prev.strategies || []).filter(s => s.id !== id),
    }));
  }

  async function saveSettings() {
    setSaving(true);
    setSaved(false);
    try {
      const res = await fetch('/api/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      });
      if (res.ok) {
        setSaved(true);
        setTimeout(() => setSaved(false), 3000);
      }
    } catch (err) {
      console.error('Save failed:', err);
      alert('Failed to save settings');
    } finally {
      setSaving(false);
    }
  }

  function resetToDefaults() {
    if (confirm('Are you sure you want to reset all settings to defaults?')) {
      setConfig(initialConfig);
    }
  }

  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
        {/* ICP Settings */}
        <div className="glass-card" style={{ padding: '24px' }}>
          <h2 style={{ fontSize: '16px', fontWeight: 700, marginBottom: '20px' }}>
            🎯 Ideal Customer Profile
          </h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div>
              <label style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 600, display: 'block', marginBottom: '6px' }}>
                TARGET INDUSTRIES
              </label>
              <input className="input-field" value={config.icp.industries.join(', ')}
                onChange={e => updateIcp('industries', e.target.value.split(',').map(s => s.trim()).filter(Boolean))} />
            </div>
            <div>
              <label style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 600, display: 'block', marginBottom: '6px' }}>
                TARGET ROLES
              </label>
              <input className="input-field" value={config.icp.roles.join(', ')}
                onChange={e => updateIcp('roles', e.target.value.split(',').map(s => s.trim()).filter(Boolean))} />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <div>
                <label style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 600, display: 'block', marginBottom: '6px' }}>
                  MIN COMPANY SIZE
                </label>
                <input className="input-field" type="number" value={config.icp.company_size_min}
                  onChange={e => updateIcp('company_size_min', parseInt(e.target.value) || 0)} />
              </div>
              <div>
                <label style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 600, display: 'block', marginBottom: '6px' }}>
                  MAX COMPANY SIZE
                </label>
                <input className="input-field" type="number" value={config.icp.company_size_max}
                  onChange={e => updateIcp('company_size_max', parseInt(e.target.value) || 0)} />
              </div>
            </div>
            <div>
              <label style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 600, display: 'block', marginBottom: '6px' }}>
                KEY SIGNALS / KEYWORDS
              </label>
              <input className="input-field" value={config.icp.keywords.join(', ')}
                onChange={e => updateIcp('keywords', e.target.value.split(',').map(s => s.trim()).filter(Boolean))} />
            </div>
            <div>
              <label style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 600, display: 'block', marginBottom: '6px' }}>
                ICP DESCRIPTION
              </label>
              <textarea className="input-field" rows={3} value={config.icp.description}
                onChange={e => updateIcp('description', e.target.value)} style={{ resize: 'vertical' }} />
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
              <input className="input-field" value={config.tone.first_person_name}
                onChange={e => updateTone('first_person_name', e.target.value)} />
            </div>
            <div>
              <label style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 600, display: 'block', marginBottom: '6px' }}>
                COMMUNICATION STYLE
              </label>
              <select className="input-field" value={config.tone.style}
                onChange={e => updateTone('style', e.target.value)}>
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
              <select className="input-field" value={config.tone.language}
                onChange={e => updateTone('language', e.target.value)}>
                <option value="nl">Nederlands</option>
                <option value="en">English</option>
                <option value="de">Deutsch</option>
              </select>
            </div>
            <div>
              <label style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 600, display: 'block', marginBottom: '6px' }}>
                MAX MESSAGE LENGTH (characters)
              </label>
              <input className="input-field" type="number" value={config.tone.max_message_length}
                onChange={e => updateTone('max_message_length', parseInt(e.target.value) || 0)} />
            </div>
            <div>
              <label style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 600, display: 'block', marginBottom: '6px' }}>
                EXAMPLE MESSAGES (one per line)
              </label>
              <textarea className="input-field" rows={4} value={config.tone.example_messages.join('\n')}
                onChange={e => updateTone('example_messages', e.target.value.split('\n').filter(Boolean))}
                style={{ resize: 'vertical' }} />
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
              <textarea className="input-field" rows={3} value={config.rules.offer_description}
                onChange={e => updateRules('offer_description', e.target.value)} style={{ resize: 'vertical' }} />
            </div>
            <div>
              <label style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 600, display: 'block', marginBottom: '6px' }}>
                CONVERSATION GOAL
              </label>
              <textarea className="input-field" rows={2} value={config.rules.goal}
                onChange={e => updateRules('goal', e.target.value)} style={{ resize: 'vertical' }} />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <div>
                <label style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 600, display: 'block', marginBottom: '6px' }}>
                  MAX FOLLOW-UPS
                </label>
                <input className="input-field" type="number" value={config.rules.max_follow_ups}
                  onChange={e => updateRules('max_follow_ups', parseInt(e.target.value) || 0)} />
              </div>
              <div>
                <label style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 600, display: 'block', marginBottom: '6px' }}>
                  FOLLOW-UP DELAY (hours)
                </label>
                <input className="input-field" type="number" value={config.rules.follow_up_delay_hours}
                  onChange={e => updateRules('follow_up_delay_hours', parseInt(e.target.value) || 0)} />
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <div>
                <label style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 600, display: 'block', marginBottom: '6px' }}>
                  WORKING HOURS START
                </label>
                <input className="input-field" type="number" value={config.rules.working_hours_start}
                  onChange={e => updateRules('working_hours_start', parseInt(e.target.value) || 0)} min={0} max={23} />
              </div>
              <div>
                <label style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 600, display: 'block', marginBottom: '6px' }}>
                  WORKING HOURS END
                </label>
                <input className="input-field" type="number" value={config.rules.working_hours_end}
                  onChange={e => updateRules('working_hours_end', parseInt(e.target.value) || 0)} min={0} max={23} />
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '8px' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer' }}>
                <input type="checkbox" checked={config.rules.no_links_first_touch}
                  onChange={e => updateRules('no_links_first_touch', e.target.checked)} />
                <span style={{ fontSize: '13px' }}>No links in first message</span>
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer' }}>
                <input type="checkbox" checked={config.rules.no_calendar_first_touch}
                  onChange={e => updateRules('no_calendar_first_touch', e.target.checked)} />
                <span style={{ fontSize: '13px' }}>No calendar links in first message</span>
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer' }}>
                <input type="checkbox" checked={config.rules.auto_respond}
                  onChange={e => updateRules('auto_respond', e.target.checked)} />
                <span style={{ fontSize: '13px' }}>Auto-respond to new messages (agent mode)</span>
              </label>
            </div>
          </div>
        </div>

        {/* Best Practices */}
        <div className="glass-card" style={{ padding: '24px' }}>
          <h2 style={{ fontSize: '16px', fontWeight: 700, marginBottom: '8px' }}>
            🧠 Best Practices
          </h2>
          <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '16px' }}>
            Custom rules that are always included in the AI prompt. Use insights from the Learning page to add patterns that work. These rules have priority over default behavior.
          </p>
          <textarea
            className="input-field"
            rows={6}
            placeholder={"Voorbeeld:\n- Houd berichten onder de 200 tekens\n- Begin altijd met een procesvraag\n- Gebruik nooit 'Ben benieuwd'\n- Bij 'warm' fase, bied direct Loom aan"}
            value={config.best_practices ?? ''}
            onChange={e => setConfig(prev => ({ ...prev, best_practices: e.target.value }))}
            style={{ resize: 'vertical' }}
          />
        </div>

        {/* Strategy Templates */}
        <div className="glass-card" style={{ padding: '24px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <div>
              <h2 style={{ fontSize: '16px', fontWeight: 700, marginBottom: '4px' }}>
                🎯 Strategie Templates
              </h2>
              <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                Definieer invalshoeken per scenario. De AI gebruikt het template als inspiratie en past het aan per prospect.
              </p>
            </div>
            <button className="btn-secondary" onClick={addStrategy} style={{ fontSize: '12px', padding: '6px 14px' }}>
              + Strategie
            </button>
          </div>

          {(config.strategies || []).length === 0 ? (
            <p style={{ color: 'var(--text-muted)', fontSize: '13px', textAlign: 'center', padding: '20px' }}>
              Nog geen strategieën. Klik &quot;+ Strategie&quot; om er een toe te voegen.
            </p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {(config.strategies || []).map(strat => (
                <div key={strat.id} style={{
                  padding: '16px', borderRadius: '12px',
                  border: strat.active ? '1px solid rgba(59,130,246,0.3)' : '1px solid var(--border)',
                  background: strat.active ? 'rgba(59,130,246,0.05)' : 'rgba(255,255,255,0.02)',
                }}>
                  <div style={{ display: 'flex', gap: '8px', marginBottom: '12px', alignItems: 'center' }}>
                    <input
                      className="input-field"
                      placeholder="Naam (bijv. Connectie opvolging)"
                      value={strat.name}
                      onChange={e => updateStrategy(strat.id, 'name', e.target.value)}
                      style={{ flex: 1, fontSize: '13px' }}
                    />
                    <select
                      className="input-field"
                      value={strat.scenario}
                      onChange={e => updateStrategy(strat.id, 'scenario', e.target.value)}
                      style={{ width: '180px', fontSize: '12px' }}
                    >
                      <option value="connection_follow_up">Connectie opvolging</option>
                      <option value="re_engagement">Re-engagement</option>
                      <option value="cold_outreach">Cold outreach</option>
                      <option value="general">Algemeen</option>
                    </select>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12px', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                      <input
                        type="checkbox"
                        checked={strat.active}
                        onChange={e => updateStrategy(strat.id, 'active', e.target.checked)}
                      />
                      Actief
                    </label>
                    <button
                      onClick={() => removeStrategy(strat.id)}
                      style={{ background: 'none', border: 'none', color: 'var(--error)', cursor: 'pointer', fontSize: '16px', padding: '4px' }}
                      title="Verwijderen"
                    >✕</button>
                  </div>
                  <textarea
                    className="input-field"
                    rows={6}
                    placeholder="Template bericht (gebruik {{Naam}} en {{LINK}} als placeholders)..."
                    value={strat.template}
                    onChange={e => updateStrategy(strat.id, 'template', e.target.value)}
                    style={{ resize: 'vertical', fontSize: '12px', marginBottom: '8px' }}
                  />
                  <textarea
                    className="input-field"
                    rows={2}
                    placeholder="Instructie voor de AI (hoe moet dit template gebruikt worden?)"
                    value={strat.instruction}
                    onChange={e => updateStrategy(strat.id, 'instruction', e.target.value)}
                    style={{ resize: 'vertical', fontSize: '12px' }}
                  />
                </div>
              ))}
            </div>
          )}
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
            placeholder={"jan.janssen@example.com\nCompetitorBV\n..."}
            value={config.blacklist.join('\n')}
            onChange={e => setConfig(prev => ({ ...prev, blacklist: e.target.value.split('\n').filter(Boolean) }))}
            style={{ resize: 'vertical' }}
          />
        </div>
      </div>

      {/* Save button */}
      <div style={{ marginTop: '24px', display: 'flex', justifyContent: 'flex-end', gap: '12px', alignItems: 'center' }}>
        {saved && (
          <span style={{ color: 'var(--success)', fontSize: '14px', fontWeight: 600 }}>
            ✅ Settings saved!
          </span>
        )}
        <button className="btn-secondary" onClick={resetToDefaults}>Reset to Defaults</button>
        <button
          className="btn-primary"
          style={{ padding: '14px 32px', fontSize: '15px', opacity: saving ? 0.6 : 1 }}
          onClick={saveSettings}
          disabled={saving}
        >
          {saving ? '⏳ Saving...' : '💾 Save Settings'}
        </button>
      </div>
    </>
  );
}
