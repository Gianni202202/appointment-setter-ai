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
  needs_human?: boolean;
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

  // Manual message
  const [manualMessage, setManualMessage] = useState('');

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    fetchConversation();
  }, [chatId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

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
      // Use the test endpoint to generate without sending
      const res = await fetch('/api/agent/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversation_id: chatId }),
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || 'AI generation failed');
      }

      const data = await res.json();
      const draft: AiDraft = {
        message: data.preview?.message || '',
        reasoning: data.preview?.reasoning || '',
        sentiment: data.preview?.sentiment || 'neutral',
        needs_human: data.preview?.needs_human || false,
      };
      setAiDraft(draft);
      setEditableDraft(draft.message);

      // Focus the textarea
      setTimeout(() => textareaRef.current?.focus(), 100);
    } catch (err) {
      console.error('AI generation failed:', err);
      setAiDraft({
        message: '',
        reasoning: `Error: ${err}. Make sure ANTHROPIC_API_KEY is configured in Vercel.`,
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

      // Add to local messages
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

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
        <div className="pulse-live" style={{ width: '24px', height: '24px', borderRadius: '50%', background: 'var(--accent)' }} />
        <span style={{ marginLeft: '12px', color: 'var(--text-muted)' }}>Loading conversation...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: '48px', textAlign: 'center' }}>
        <p style={{ color: 'var(--danger)' }}>Error: {error}</p>
        <button className="btn-secondary" onClick={() => router.push('/conversations')} style={{ marginTop: '16px' }}>
          ← Back to conversations
        </button>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', maxHeight: '100vh' }}>

      {/* Header with prospect info */}
      <div className="glass-card" style={{
        padding: '16px 24px',
        borderRadius: '0',
        borderBottom: '1px solid var(--border)',
        display: 'flex', alignItems: 'center', gap: '16px',
      }}>
        <button
          onClick={() => router.push('/conversations')}
          style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '18px', padding: '4px' }}
        >
          ←
        </button>
        <div className="avatar" style={{ width: '40px', height: '40px', fontSize: '14px', flexShrink: 0 }}>
          {getInitials(prospectName)}
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 600, fontSize: '16px' }}>{prospectName}</div>
          {prospectHeadline && (
            <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '2px' }}>{prospectHeadline}</div>
          )}
          {prospectCompany && (
            <div style={{ fontSize: '11px', color: 'var(--accent)', marginTop: '1px' }}>{prospectCompany}</div>
          )}
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button className="btn-secondary" onClick={fetchConversation} style={{ fontSize: '13px' }}>
            🔄 Refresh
          </button>
          <span style={{ fontSize: '12px', color: 'var(--text-muted)', alignSelf: 'center' }}>
            {messages.length} messages
          </span>
        </div>
      </div>

      {/* Messages area */}
      <div style={{
        flex: 1, overflowY: 'auto', padding: '24px',
        display: 'flex', flexDirection: 'column', gap: '12px',
      }}>
        {messages.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '48px', color: 'var(--text-muted)' }}>
            <p style={{ fontSize: '14px' }}>No messages yet in this conversation.</p>
          </div>
        ) : (
          messages.map((msg) => (
            <div key={msg.id} className="animate-fadeIn" style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: msg.role === 'prospect' ? 'flex-start' : 'flex-end',
            }}>
              <div style={{
                maxWidth: '70%',
                padding: '12px 16px',
                borderRadius: msg.role === 'prospect' ? '4px 16px 16px 16px' : '16px 4px 16px 16px',
                background: msg.role === 'prospect'
                  ? 'rgba(255,255,255,0.06)'
                  : 'linear-gradient(135deg, var(--accent), #1d63ed)',
                border: msg.role === 'prospect' ? '1px solid var(--border)' : 'none',
                color: msg.role === 'prospect' ? 'var(--text-primary)' : '#fff',
                fontSize: '14px',
                lineHeight: '1.6',
                whiteSpace: 'pre-wrap',
              }}>
                {msg.content}
              </div>
              <div style={{
                fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px',
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

      {/* AI Copilot Panel */}
      {aiDraft && (
        <div style={{
          padding: '16px 24px',
          background: 'rgba(139, 92, 246, 0.06)',
          borderTop: '2px solid rgba(139, 92, 246, 0.3)',
        }}>
          {/* Reasoning */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px',
            fontSize: '12px', color: 'rgba(139, 92, 246, 0.9)',
          }}>
            <span>🧠</span>
            <strong>AI Reasoning:</strong>
            <span style={{ color: 'var(--text-muted)' }}>{aiDraft.reasoning}</span>
          </div>

          {aiDraft.sentiment && (
            <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '8px' }}>
              Sentiment: <strong style={{ color: aiDraft.sentiment === 'positive' ? 'var(--success)' : aiDraft.sentiment === 'negative' ? 'var(--danger)' : 'var(--warning)' }}>
                {aiDraft.sentiment}
              </strong>
              {aiDraft.needs_human && <span style={{ color: 'var(--warning)', marginLeft: '12px' }}>⚠️ AI suggests human review</span>}
            </div>
          )}

          {/* Editable draft */}
          <div style={{ position: 'relative' }}>
            <textarea
              ref={textareaRef}
              value={editableDraft}
              onChange={(e) => setEditableDraft(e.target.value)}
              style={{
                width: '100%', minHeight: '80px', padding: '12px', fontSize: '14px',
                background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(139, 92, 246, 0.3)',
                borderRadius: '8px', color: 'var(--text-primary)', resize: 'vertical',
                fontFamily: 'inherit', lineHeight: '1.5',
              }}
            />
          </div>

          {/* Draft actions */}
          <div style={{ display: 'flex', gap: '8px', marginTop: '12px', justifyContent: 'flex-end' }}>
            <button
              className="btn-secondary"
              onClick={() => { setAiDraft(null); setEditableDraft(''); }}
              style={{ fontSize: '13px' }}
            >
              ✕ Dismiss
            </button>
            <button
              className="btn-secondary"
              onClick={() => setEditableDraft(aiDraft.message)}
              style={{ fontSize: '13px' }}
            >
              ↩ Reset
            </button>
            <button
              className="btn-secondary"
              onClick={generateAiDraft}
              disabled={isGenerating}
              style={{ fontSize: '13px' }}
            >
              🔄 Regenerate
            </button>
            <button
              className="btn-primary"
              onClick={() => sendMessage(editableDraft)}
              disabled={isSending || !editableDraft.trim()}
              style={{
                fontSize: '13px',
                background: 'linear-gradient(135deg, #10B981, #059669)',
                opacity: isSending ? 0.6 : 1,
              }}
            >
              {isSending ? '⏳ Sending...' : '✓ Approve & Send via LinkedIn'}
            </button>
          </div>
        </div>
      )}

      {/* Success banner */}
      {sendSuccess && (
        <div style={{
          padding: '10px 24px', background: 'rgba(16, 185, 129, 0.12)',
          borderTop: '1px solid rgba(16, 185, 129, 0.3)', textAlign: 'center',
          fontSize: '13px', color: 'var(--success)', fontWeight: 600,
        }}>
          ✓ {sendSuccess}
        </div>
      )}

      {/* Bottom action bar */}
      <div className="glass-card" style={{
        padding: '12px 24px',
        borderRadius: '0',
        borderTop: '1px solid var(--border)',
      }}>
        {/* AI Copilot button */}
        <div style={{ display: 'flex', gap: '8px', marginBottom: '10px' }}>
          <button
            className="btn-primary"
            onClick={generateAiDraft}
            disabled={isGenerating || !!aiDraft}
            style={{
              flex: 1, fontSize: '14px', padding: '10px 16px',
              opacity: (isGenerating || !!aiDraft) ? 0.5 : 1,
              background: 'linear-gradient(135deg, #8B5CF6, #6D28D9)',
            }}
          >
            {isGenerating ? (
              <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
                <span className="pulse-live" style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#fff' }} />
                AI is generating a response...
              </span>
            ) : (
              '🤖 Generate AI Response (Copilot)'
            )}
          </button>
        </div>

        {/* Manual message input */}
        <div style={{ display: 'flex', gap: '8px' }}>
          <input
            type="text"
            className="input-field"
            placeholder="Or type a manual message..."
            style={{ flex: 1 }}
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
