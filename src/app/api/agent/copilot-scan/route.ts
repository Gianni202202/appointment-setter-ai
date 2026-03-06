import { NextResponse } from 'next/server';
import { getAgentMode, addDraft, getDrafts } from '@/lib/database';

const DSN = process.env.UNIPILE_DSN || '';
const API_KEY = process.env.UNIPILE_API_KEY || '';
const ACCOUNT_ID = process.env.UNIPILE_ACCOUNT_ID || '';

/**
 * Copilot Scan — Scans all active conversations for unread prospect messages
 * and generates AI drafts for each. Returns progress.
 */
export async function POST() {
  try {
    const mode = getAgentMode();
    if (mode !== 'copilot') {
      return NextResponse.json({ error: 'Agent must be in Copilot mode' }, { status: 400 });
    }

    if (!DSN || !API_KEY || !ACCOUNT_ID) {
      return NextResponse.json({ error: 'Unipile not configured' }, { status: 400 });
    }

    // 1. Fetch recent chats from Unipile
    const chatsRes = await fetch(`https://${DSN}/api/v1/chats?account_id=${ACCOUNT_ID}&limit=50`, {
      headers: { 'X-API-KEY': API_KEY, 'Accept': 'application/json' },
      cache: 'no-store',
    });

    if (!chatsRes.ok) {
      const err = await chatsRes.text();
      return NextResponse.json({ error: 'Failed to fetch chats: ' + err }, { status: 500 });
    }

    const chatsData = await chatsRes.json();
    const chats = chatsData.items || chatsData || [];

    // 2. Find chats where prospect sent the last message
    const existingDraftChatIds = new Set(getDrafts().map(d => d.chat_id));
    const chatsToProcess: any[] = [];

    for (const chat of chats) {
      // Skip if we already have a draft for this chat
      if (existingDraftChatIds.has(chat.id)) continue;

      // Skip if not our account
      if (chat.account_id && chat.account_id !== ACCOUNT_ID) continue;

      // Check if last message is from prospect (not from us)
      const lastMsg = chat.last_message;
      if (lastMsg && !lastMsg.is_sender) {
        chatsToProcess.push(chat);
      }
    }

    if (chatsToProcess.length === 0) {
      return NextResponse.json({
        scanned: chats.length,
        drafts_created: 0,
        message: 'No conversations need attention right now.',
      });
    }

    // 3. Generate drafts for each (call our own generate endpoint)
    const results: { chat_id: string; prospect: string; status: string }[] = [];
    const baseUrl = process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';

    for (const chat of chatsToProcess.slice(0, 10)) { // Max 10 at a time
      try {
        const genRes = await fetch(`${baseUrl}/api/agent/generate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: chat.id }),
        });

        if (genRes.ok) {
          const genData = await genRes.json();
          if (genData.draft && genData.draft.message && genData.draft.should_respond) {
            // Add to draft queue
            addDraft({
              chat_id: chat.id,
              prospect_name: genData.prospect?.name || 'Unknown',
              prospect_headline: genData.prospect?.headline,
              message: genData.draft.message,
              reasoning: genData.draft.reasoning || '',
              phase: genData.draft.phase,
              confidence: genData.draft.confidence,
              prospect_msg_received_at: chat.last_message?.timestamp,
            });
            results.push({ chat_id: chat.id, prospect: genData.prospect?.name, status: 'draft_created' });
          } else {
            results.push({ chat_id: chat.id, prospect: genData.prospect?.name, status: 'skipped_no_response_needed' });
          }
        } else {
          results.push({ chat_id: chat.id, prospect: 'Unknown', status: 'error' });
        }
      } catch (err) {
        results.push({ chat_id: chat.id, prospect: 'Unknown', status: 'error: ' + String(err) });
      }
    }

    return NextResponse.json({
      scanned: chats.length,
      processed: chatsToProcess.length,
      drafts_created: results.filter(r => r.status === 'draft_created').length,
      results,
    });
  } catch (error) {
    console.error('[Copilot Scan] Error:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
