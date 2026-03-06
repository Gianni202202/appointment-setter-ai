import { NextResponse } from 'next/server';
import { getAgentMode, getDrafts } from '@/lib/database';
import { processScheduledSends } from '@/app/api/agent/queue/route';
import { isWithinWorkingHours } from '@/lib/human-timing';

const DSN = process.env.UNIPILE_DSN || '';
const API_KEY = process.env.UNIPILE_API_KEY || '';
const ACCOUNT_ID = process.env.UNIPILE_ACCOUNT_ID || '';
const CRON_SECRET = process.env.CRON_SECRET || '';

/**
 * Vercel Cron Job — runs every 5 minutes.
 * 1. Processes scheduled sends (approved drafts whose time has come)
 * 2. In AUTO mode: scans inbox for new messages and generates drafts
 */
export async function GET(request: Request) {
  // Verify cron secret (Vercel sends this header)
  const authHeader = request.headers.get('authorization');
  if (CRON_SECRET && authHeader !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const mode = getAgentMode();
  const results: any = { mode, timestamp: new Date().toISOString() };

  // 1. ALWAYS process scheduled sends (regardless of mode)
  const sendResults = await processScheduledSends();
  results.sends = sendResults;

  // 2. AUTO MODE: scan for new messages and generate drafts
  if (mode === 'auto' && DSN && API_KEY && ACCOUNT_ID) {
    if (!isWithinWorkingHours()) {
      results.auto = { skipped: true, reason: 'Outside working hours' };
      return NextResponse.json(results);
    }

    try {
      // Fetch recent chats
      const chatsRes = await fetch(`https://${DSN}/api/v1/chats?account_id=${ACCOUNT_ID}&limit=50`, {
        headers: { 'X-API-KEY': API_KEY, 'Accept': 'application/json' },
        cache: 'no-store',
      });

      if (!chatsRes.ok) {
        results.auto = { error: 'Failed to fetch chats' };
        return NextResponse.json(results);
      }

      const chatsData = await chatsRes.json();
      const chats = chatsData.items || chatsData || [];

      // Find chats that need attention (no existing draft)
      const existingDraftChatIds = new Set(
        getDrafts().filter(d => d.status === 'pending' || d.status === 'approved').map(d => d.chat_id)
      );

      const chatIdsToProcess: string[] = [];
      for (const chat of chats) {
        if (chat.account_id && chat.account_id !== ACCOUNT_ID) continue;
        if (existingDraftChatIds.has(chat.id)) continue;

        const lastMsg = chat.last_message;
        if (!lastMsg) continue;

        // In auto mode, only process chats where prospect sent last
        const isSentByMe = lastMsg.is_sender === true || lastMsg.sender?.is_me === true;
        if (!isSentByMe && lastMsg.text) {
          chatIdsToProcess.push(chat.id);
        }
      }

      if (chatIdsToProcess.length === 0) {
        results.auto = { processed: 0, message: 'No new messages needing reply' };
        return NextResponse.json(results);
      }

      // Generate drafts via copilot-scan POST (max 5 per cron run to stay within limits)
      const baseUrl = process.env.VERCEL_URL 
        ? `https://${process.env.VERCEL_URL}` 
        : (process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000');

      const scanRes = await fetch(`${baseUrl}/api/agent/copilot-scan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_ids: chatIdsToProcess.slice(0, 5) }),
      });

      if (scanRes.ok) {
        const scanData = await scanRes.json();
        results.auto = {
          chats_found: chatIdsToProcess.length,
          processed: scanData.processed || 0,
          drafts_created: scanData.drafts_created || 0,
        };
      } else {
        results.auto = { error: 'Draft generation failed' };
      }
    } catch (err) {
      results.auto = { error: String(err) };
    }
  }

  return NextResponse.json(results);
}
