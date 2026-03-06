'use client';

import { useState, useEffect, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';

interface Message {
  id: string;
  role: 'prospect' | 'agent' | 'human';
  content: string;
  sent_at: string;
  sender_name?: string;
}

interface AiDraft {
  message: string;
  reasoning: string;
  sentiment?: string;
  phase?: string;
  mini_ja_seeking?: string;
  needs_human?: boolean;
  has_objection?: boolean;
  objection_type?: string | null;
  should_respond?: boolean;
}

export default function ConversationDetail() {
  const params = useParams();
  const router = useRouter();
  const chatId = params.id as string;

  const [messages, setMessages] = useState<Message[]>([]);
  const [prospectName, setProspectName] = useState('');
  const [prospectHeadline, setProspectHeadline] = useState('');
  const [prospectCompany, setProspectCompany] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Copilot state
  const [aiDraft, setAiDraft] = useState<AiDraft | null>(null);
  const [editableDraft, setEditableDraft] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [sendSuccess, setSendSuccess] = useState('');
  const [showInsights, setShowInsights] = useState(false);

  // Manual message
  const [manualMessage, setManualMessage] = useState('');

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { fetchConversation(); }, [chatId]);
  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  async function fetchConversation() {
    try {
      setLoading(true);
      const res = await fetch(`/api/conversations?chat_id=${chatId}`);
      if (!res.ok) throw new Error('Failed to load conversation');
      const data = await res.json();
      setMessages(data.messages || []);
      setProspectName(data.prospect_name || 'Unknown');
      setProspectHeadline(data.prospect_headline || '');
      setProspectCompany(data.prospect_company || '');
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }

  async function generateAiDraft() {
    if (isGenerating) return;
    setIsGenerating(true);
    setAiDraft(null);
    setSendSuccess('');

    try {
      const res = await fetch('/api/agent/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId }),
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || 'AI generation failed');
      }

      const data = await res.json();
      const draft: AiDraft = {
        message: data.draft?.message || '',
        reasoning: data.draft?.reasoning || '',
        sentiment: data.draft?.sentiment || 'neutral',
        phase: data.draft?.phase || '',
        mini_ja_seeking: data.draft?.mini_ja_seeking || '',
        needs_human: data.draft?.needs_human || false,
        has_objection: data.draft?.has_objection || false,
        objection_type: data.draft?.objection_type || null,
        should_respond: data.draft?.should_respond !== false,
      };
      setAiDraft(draft);
      setEditableDraft(draft.message);
      setTimeout(() => textareaRef.current?.focus(), 100);
    } catch (err) {
      console.error('AI generation failed:', err);
      setAiDraft({
        message: '',
        reasoning: `Error: ${err}. Make sure GEMINI_API_KEY is configured.`,
        needs_human: true,
      });
    } finally {
      setIsGenerating(false);
    }
  }

  async function sendMessage(text: string) {
    if (!text.trim() || isSending) return;
    setIsSending(true);
    setSendSuccess('');

    try {
      const res = await fetch('/api/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, content: text.trim() }),
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || 'Send failed');
      }

      setMessages(prev => [...prev, {
        id: `sent-${Date.now()}`,
        role: 'agent',
        content: text.trim(),
        sent_at: new Date().toISOString(),
      }]);

      setAiDraft(null);
      setEditableDraft('');
      setManualMessage('');
      setSendSuccess('Message sent via LinkedIn!');
      setTimeout(() => setSendSuccess(''), 4000);
    } catch (err) {
      alert(`Send failed: ${err}`);
    } finally {
      setIsSending(false);
    }
  }

  function formatTime(dateStr: string): string {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    return d.toLocaleDateString('nl-NL', {
      day: 'numeric', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  }

  function getInitials(name: string): string {
    return name.split(' ').map(w => w[0]).join('').substring(0, 2).toUpperCase();
  }

  function getPhaseLabel(phase?: string) {
    const labels: Record<string, { label: string; color: string }> = {
      koud: { label: '❄️ Koud', color: '#60a5fa' },
      lauw: { label: '🌤 Lauw', color: '#fbbf24' },
      warm: { label: '🔥 Warm', color: '#f97316' },
      proof: { label: '📹 Proof', color: '#a78bfa' },
      call: { label: '📞 Call', color: '#34d399' },
      weerstand: { label: '🛡 Weerstand', color: '#f87171' },
    };
    return labels[phase || ''] || { label: phase || '—', color: 'var(--text-muted)' };
  }

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '80vh', gap: '12px' }}>
        <div className="pulse-live" style={{ width: '20px', height: '20px', borderRadius: '50%', background: 'var(--accent)' }} />
        <span style={{ color: 'var(--text-muted)', fontSize: '14px' }}>Loading conversation...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: '48px', textAlign: 'center' }}>
        <p style={{ color: 'var(--danger)' }}>Error: {error}</p>
        <button className="btn-secondary" onClick={() => router.push('/conversations')} style={{ marginTop: '16px' }}>
          ← Back
        </button>
      </div>
    );
  }

  const phaseInfo = getPhaseLabel(aiDraft?.phase);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 48px)', maxWidth: '900px' }}>

      {/* Header */}
      <div style={{
        padding: '14px 20px',
        borderBottom: '1px solid var(--border)',
        display: 'flex', alignItems: 'center', gap: '14px',
        background: 'var(--bg-secondary)',
        borderRadius: '12px 12px 0 0',
      }}>
        <button
          onClick={() => router.push('/conversations')}
          style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '18px', padding: '4px' }}
        >
          ←
        </button>
        <div className="avatar" style={{ width: '38px', height: '38px', fontSize: '13px' }}>
          {getInitials(prospectName)}
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 600, fontSize: '15px' }}>{prospectName}</div>
          {prospectHeadline && (
            <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '1px' }}>{prospectHeadline}</div>
          )}
        </div>
        <button className="btn-secondary" onClick={fetchConversation} style={{ fontSize: '12px', padding: '6px 12px' }}>
          🔄
        </button>
        <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
          {messages.length} msgs
        </span>
      </div>

      {/* Messages */}
      <div style={{
        flex: 1, overflowY: 'auto', padding: '20px',
        display: 'flex', flexDirection: 'column', gap: '10px',
      }}>
        {messages.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '48px', color: 'var(--text-muted)' }}>
            <p>No messages yet.</p>
          </div>
        ) : (
          messages.map((msg) => (
            <div key={msg.id} className="animate-fadeIn" style={{
              display: 'flex', flexDirection: 'column',
              alignItems: msg.role === 'prospect' ? 'flex-start' : 'flex-end',
            }}>
              <div style={{
                maxWidth: '70%', padding: '11px 15px',
                borderRadius: msg.role === 'prospect' ? '4px 16px 16px 16px' : '16px 4px 16px 16px',
                background: msg.role === 'prospect'
                  ? 'rgba(255,255,255,0.06)'
                  : msg.role === 'human'
                    ? 'linear-gradient(135deg, #7c3aed, #8b5cf6)'
                    : 'linear-gradient(135deg, var(--accent), #1d63ed)',
                border: msg.role === 'prospect' ? '1px solid var(--border)' : 'none',
                color: msg.role === 'prospect' ? 'var(--text-primary)' : '#fff',
                fontSize: '14px', lineHeight: '1.6', whiteSpace: 'pre-wrap',
              }}>
                {msg.content}
              </div>
              <div style={{
                fontSize: '11px', color: 'var(--text-muted)', marginTop: '3px',
                paddingLeft: msg.role === 'prospect' ? '4px' : '0',
                paddingRight: msg.role !== 'prospect' ? '4px' : '0',
              }}>
                {msg.role === 'prospect' ? prospectName : msg.role === 'human' ? '👤 You' : '🤖 AI'} • {formatTime(msg.sent_at)}
              </div>
            </div>
          ))
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* AI Copilot Panel — ONLY the message in the editable box */}
      {aiDraft && (
        <div style={{
          borderTop: '2px solid rgba(139, 92, 246, 0.3)',
          background: 'rgba(139, 92, 246, 0.04)',
        }}>
          {/* Compact insight bar */}
          <div style={{
            padding: '8px 20px',
            display: 'flex', alignItems: 'center', gap: '10px',
            borderBottom: '1px solid rgba(139, 92, 246, 0.15)',
            flexWrap: 'wrap',
          }}>
            <span style={{ fontSize: '12px', fontWeight: 600, color: 'rgba(139, 92, 246, 0.9)' }}>🤖 AI Draft</span>

            {aiDraft.phase && (
              <span style={{
                fontSize: '11px', padding: '2px 8px', borderRadius: '6px',
                background: `${phaseInfo.color}22`, color: phaseInfo.color,
                fontWeight: 600,
              }}>
                {phaseInfo.label}
              </span>
            )}

            {aiDraft.sentiment && (
              <span style={{
                fontSize: '11px', padding: '2px 8px', borderRadius: '6px',
                background: aiDraft.sentiment === 'positive' ? 'rgba(16,185,129,0.12)' : aiDraft.sentiment === 'negative' ? 'rgba(239,68,68,0.12)' : 'rgba(245,158,11,0.12)',
                color: aiDraft.sentiment === 'positive' ? '#34d399' : aiDraft.sentiment === 'negative' ? '#f87171' : '#fbbf24',
                fontWeight: 500,
              }}>
                {aiDraft.sentiment}
              </span>
            )}

            {aiDraft.needs_human && (
              <span style={{ fontSize: '11px', color: 'var(--warning)', fontWeight: 600 }}>⚠️ Human review</span>
            )}

            <button
              onClick={() => setShowInsights(!showInsights)}
              style={{
                marginLeft: 'auto', fontSize: '11px', background: 'none', border: 'none',
                color: 'var(--text-muted)', cursor: 'pointer', textDecoration: 'underline',
              }}
            >
              {showInsights ? 'Hide reasoning' : 'Show reasoning'}
            </button>
          </div>

          {/* Expandable reasoning panel */}
          {showInsights && (
            <div style={{
              padding: '10px 20px', fontSize: '12px', color: 'var(--text-secondary)',
              borderBottom: '1px solid rgba(139, 92, 246, 0.1)',
              background: 'rgba(0,0,0,0.15)',
              lineHeight: '1.5',
            }}>
              <div style={{ marginBottom: '4px' }}>
                <strong style={{ color: 'rgba(139, 92, 246, 0.8)' }}>💭 Reasoning:</strong> {aiDraft.reasoning}
              </div>
              {aiDraft.mini_ja_seeking && (
                <div>
                  <strong style={{ color: 'rgba(139, 92, 246, 0.8)' }}>🎯 Seeking:</strong> Mini-ja op <em>{aiDraft.mini_ja_seeking}</em>
                </div>
              )}
              {aiDraft.has_objection && aiDraft.objection_type && (
                <div>
                  <strong style={{ color: '#f87171' }}>🛡 Objection:</strong> {aiDraft.objection_type}
                </div>
              )}
            </div>
          )}

          {/* Editable message — ONLY the actual DM text */}
          <div style={{ padding: '12px 20px' }}>
            <textarea
              ref={textareaRef}
              value={editableDraft}
              onChange={(e) => setEditableDraft(e.target.value)}
              style={{
                width: '100%', minHeight: '70px', padding: '12px', fontSize: '14px',
                background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(139, 92, 246, 0.25)',
                borderRadius: '10px', color: 'var(--text-primary)', resize: 'vertical',
                fontFamily: 'inherit', lineHeight: '1.5', outline: 'none',
              }}
            />

            {/* Actions */}
            <div style={{ display: 'flex', gap: '8px', marginTop: '10px', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
              <button className="btn-secondary" onClick={() => { setAiDraft(null); setEditableDraft(''); }} style={{ fontSize: '12px', padding: '8px 14px' }}>
                ✕ Dismiss
              </button>
              <button className="btn-secondary" onClick={() => setEditableDraft(aiDraft.message)} style={{ fontSize: '12px', padding: '8px 14px' }}>
                ↩ Reset
              </button>
              <button className="btn-secondary" onClick={generateAiDraft} disabled={isGenerating} style={{ fontSize: '12px', padding: '8px 14px' }}>
                🔄 Regenerate
              </button>
              <button
                className="btn-primary"
                onClick={() => sendMessage(editableDraft)}
                disabled={isSending || !editableDraft.trim()}
                style={{
                  fontSize: '13px', padding: '8px 18px',
                  background: 'linear-gradient(135deg, #10B981, #059669)',
                  opacity: (isSending || !editableDraft.trim()) ? 0.5 : 1,
                }}
              >
                {isSending ? '⏳ Sending...' : '✓ Approve & Send'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Success banner */}
      {sendSuccess && (
        <div style={{
          padding: '8px 20px', background: 'rgba(16, 185, 129, 0.1)',
          borderTop: '1px solid rgba(16, 185, 129, 0.2)', textAlign: 'center',
          fontSize: '13px', color: 'var(--success)', fontWeight: 600,
        }}>
          ✓ {sendSuccess}
        </div>
      )}

      {/* Bottom bar */}
      <div style={{
        padding: '12px 20px',
        borderTop: '1px solid var(--border)',
        background: 'var(--bg-secondary)',
        borderRadius: '0 0 12px 12px',
      }}>
        {/* Copilot button */}
        <div style={{ marginBottom: '8px' }}>
          <button
            className="btn-primary"
            onClick={generateAiDraft}
            disabled={isGenerating || !!aiDraft}
            style={{
              width: '100%', fontSize: '14px', padding: '10px 16px',
              opacity: (isGenerating || !!aiDraft) ? 0.5 : 1,
              background: 'linear-gradient(135deg, #8B5CF6, #6D28D9)',
            }}
          >
            {isGenerating ? (
              <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
                <span className="pulse-live" style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#fff' }} />
                Generating...
              </span>
            ) : (
              '🤖 Generate AI Response (Copilot)'
            )}
          </button>
        </div>

        {/* Manual input */}
        <div style={{ display: 'flex', gap: '8px' }}>
          <input
            type="text"
            className="input-field"
            placeholder="Or type a manual message..."
            style={{ flex: 1, minHeight: '40px' }}
            value={manualMessage}
            onChange={(e) => setManualMessage(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && sendMessage(manualMessage)}
            disabled={isSending}
          />
          <button
            className="btn-secondary"
            onClick={() => sendMessage(manualMessage)}
            disabled={isSending || !manualMessage.trim()}
            style={{ whiteSpace: 'nowrap', fontSize: '13px' }}
          >
            {isSending ? '⏳' : '↗ Send'}
          </button>
        </div>
      </div>
    </div>
  );
}
