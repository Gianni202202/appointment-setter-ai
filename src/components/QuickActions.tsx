'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface QuickActionsProps {
  conversationId: string;
  currentState: string;
  autoRespond: boolean;
}

interface TestResult {
  preview: {
    message: string;
    reasoning: string;
    sentiment: string;
    would_send: boolean;
    needs_human: boolean;
  };
  current_state: string;
  suggested_state: string;
  state_would_change: boolean;
}

export default function QuickActions({ conversationId, currentState, autoRespond }: QuickActionsProps) {
  const router = useRouter();
  const [loading, setLoading] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [autoRespondLocal, setAutoRespondLocal] = useState(autoRespond);

  async function updateState(state: string) {
    setLoading(state);
    try {
      await fetch('/api/conversations/update', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversation_id: conversationId, state }),
      });
      router.refresh();
    } catch (err) {
      console.error('Update failed:', err);
    } finally {
      setLoading(null);
    }
  }

  async function testAiResponse() {
    setLoading('test');
    setTestResult(null);
    try {
      const res = await fetch('/api/agent/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversation_id: conversationId }),
      });
      if (res.ok) {
        const data = await res.json();
        setTestResult(data);
      }
    } catch (err) {
      console.error('Test failed:', err);
    } finally {
      setLoading(null);
    }
  }

  async function toggleAutoRespond() {
    const newVal = !autoRespondLocal;
    setLoading('auto');
    try {
      await fetch('/api/conversations/update', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversation_id: conversationId, auto_respond: newVal }),
      });
      setAutoRespondLocal(newVal);
    } catch (err) {
      console.error('Toggle failed:', err);
    } finally {
      setLoading(null);
    }
  }

  async function sendTestedResponse() {
    if (!testResult) return;
    setLoading('send');
    try {
      const res = await fetch('/api/agent/respond', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversation_id: conversationId }),
      });
      if (res.ok) {
        setTestResult(null);
        router.refresh();
      }
    } catch (err) {
      console.error('Send failed:', err);
    } finally {
      setLoading(null);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      {/* Auto-respond toggle for THIS conversation */}
      <div className="glass-card" style={{
        padding: '16px',
        borderLeft: `3px solid ${autoRespondLocal ? 'var(--success)' : 'var(--danger)'}`,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: '13px', fontWeight: 600 }}>
              Auto-respond: {autoRespondLocal ? 'ON' : 'OFF'}
            </div>
            <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>
              {autoRespondLocal
                ? 'Agent will respond to new messages in this conversation'
                : 'Agent will NOT respond — manual only'
              }
            </div>
          </div>
          <button
            onClick={toggleAutoRespond}
            disabled={loading === 'auto'}
            style={{
              position: 'relative',
              width: '44px', height: '24px',
              borderRadius: '12px',
              border: 'none',
              cursor: loading === 'auto' ? 'wait' : 'pointer',
              transition: 'all 0.3s ease',
              background: autoRespondLocal
                ? 'linear-gradient(135deg, #10b981, #34d399)'
                : 'linear-gradient(135deg, #374151, #4b5563)',
            }}
          >
            <div style={{
              position: 'absolute',
              top: '2px',
              left: autoRespondLocal ? '22px' : '2px',
              width: '20px', height: '20px',
              borderRadius: '10px',
              background: 'white',
              transition: 'left 0.3s ease',
              boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
            }} />
          </button>
        </div>
      </div>

      {/* Test AI Response Button */}
      <button
        className="btn-primary"
        style={{
          width: '100%', padding: '12px', fontSize: '13px',
          background: 'linear-gradient(135deg, #8b5cf6, #a78bfa)',
          opacity: loading === 'test' ? 0.6 : 1,
        }}
        onClick={testAiResponse}
        disabled={loading === 'test'}
      >
        {loading === 'test' ? '⏳ Generating...' : '🧪 Test AI Response (Preview Only)'}
      </button>

      {/* Test Result Preview */}
      {testResult && (
        <div className="glass-card" style={{
          padding: '16px',
          borderLeft: '3px solid #8b5cf6',
        }}>
          <div style={{ fontSize: '11px', fontWeight: 600, color: '#a78bfa', textTransform: 'uppercase', marginBottom: '8px', letterSpacing: '0.05em' }}>
            🧪 AI Preview — Nothing Sent Yet
          </div>
          <div style={{
            background: 'var(--bg-secondary)', borderRadius: '8px',
            padding: '12px', marginBottom: '10px', fontSize: '13px',
            lineHeight: '1.5', color: 'var(--text-primary)',
          }}>
            {testResult.preview.message}
          </div>
          <details style={{ marginBottom: '10px' }}>
            <summary style={{ fontSize: '12px', color: 'var(--text-muted)', cursor: 'pointer' }}>
              🧠 AI Reasoning
            </summary>
            <div style={{
              padding: '8px', fontSize: '12px', color: 'var(--text-secondary)',
              marginTop: '8px', background: 'var(--bg-tertiary)', borderRadius: '6px',
            }}>
              {testResult.preview.reasoning}
            </div>
          </details>
          <div style={{ display: 'flex', gap: '8px', fontSize: '11px', color: 'var(--text-muted)', marginBottom: '12px', flexWrap: 'wrap' }}>
            <span>Sentiment: {testResult.preview.sentiment}</span>
            <span>|</span>
            <span>Would send: {testResult.preview.would_send ? '✅ Yes' : '❌ No'}</span>
            {testResult.state_would_change && (
              <>
                <span>|</span>
                <span>State: {testResult.current_state} → {testResult.suggested_state}</span>
              </>
            )}
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              className="btn-primary"
              style={{ flex: 1, padding: '10px', fontSize: '13px', opacity: loading === 'send' ? 0.6 : 1 }}
              onClick={sendTestedResponse}
              disabled={loading === 'send'}
            >
              {loading === 'send' ? '⏳ Sending...' : '✅ Approve & Send This Response'}
            </button>
            <button
              className="btn-secondary"
              style={{ padding: '10px', fontSize: '13px' }}
              onClick={() => setTestResult(null)}
            >
              ❌ Discard
            </button>
          </div>
        </div>
      )}

      {/* State Change Buttons */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          Quick State Changes
        </div>
        {currentState !== 'handoff' && (
          <button className="btn-secondary" style={{ width: '100%', fontSize: '13px', opacity: loading === 'handoff' ? 0.6 : 1 }}
            onClick={() => updateState('handoff')} disabled={loading === 'handoff'}>
            {loading === 'handoff' ? '⏳...' : '🙋 Handoff to Human'}
          </button>
        )}
        {currentState !== 'booked' && (
          <button className="btn-secondary" style={{ width: '100%', fontSize: '13px', opacity: loading === 'booked' ? 0.6 : 1 }}
            onClick={() => updateState('booked')} disabled={loading === 'booked'}>
            {loading === 'booked' ? '⏳...' : '📅 Mark as Booked'}
          </button>
        )}
        {currentState !== 'dead' && (
          <button className="btn-secondary" style={{ width: '100%', fontSize: '13px', color: 'var(--danger)', opacity: loading === 'dead' ? 0.6 : 1 }}
            onClick={() => updateState('dead')} disabled={loading === 'dead'}>
            {loading === 'dead' ? '⏳...' : '💀 Mark as Dead'}
          </button>
        )}
      </div>
    </div>
  );
}
