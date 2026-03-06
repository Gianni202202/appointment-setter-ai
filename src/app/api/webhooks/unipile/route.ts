import { NextResponse } from 'next/server';
import { getAgentMode } from '@/lib/database';
import { verifyChatOwnership } from '@/lib/unipile';
import { isWithinWorkingHours } from '@/lib/human-timing';

const ACCOUNT_ID = process.env.UNIPILE_ACCOUNT_ID || '';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    console.log('[Webhook] Received event:', JSON.stringify(body, null, 2));

    const event = body.event || body.type;
    const data = body.data || body;

    // ============================================
    // SECURITY: Reject events from other accounts
    // ============================================
    const eventAccountId = data.account_id || data.accountId;
    if (ACCOUNT_ID && eventAccountId && eventAccountId !== ACCOUNT_ID) {
      console.warn(`[Webhook] BLOCKED: Event from account ${eventAccountId} (expected ${ACCOUNT_ID})`);
      return NextResponse.json({ status: 'blocked', reason: 'wrong_account' });
    }

    if (event === 'message_received' || event === 'message.created') {
      const chatId = data.chat_id || data.chatId;
      const messageText = data.text || data.body || '';
      const messageId = data.id || data.message_id || crypto.randomUUID();

      if (!chatId || !messageText) {
        return NextResponse.json({ status: 'skipped', reason: 'missing data' });
      }

      // SECURITY: Verify this chat belongs to our account
      if (ACCOUNT_ID) {
        const isOwner = await verifyChatOwnership(chatId);
        if (!isOwner) {
          console.warn(`[Webhook] BLOCKED: Chat ${chatId} does not belong to our account`);
          return NextResponse.json({ status: 'blocked', reason: 'chat_not_owned' });
        }
      }

      // Check if agent is enabled (mode !== 'off')
      const mode = getAgentMode();
      if (mode === 'off') {
        return NextResponse.json({ status: 'received_but_agent_disabled' });
      }

      // Working hours check
      if (!isWithinWorkingHours()) {
        return NextResponse.json({ status: 'received_but_outside_hours' });
      }

      // Acknowledge receipt — actual processing happens via /api/agent/cron
      return NextResponse.json({
        status: 'received',
        chat_id: chatId,
        message_id: messageId,
        mode,
      });
    }

    return NextResponse.json({ status: 'ignored', event });
  } catch (error) {
    console.error('[Webhook] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({
    status: 'ok',
    message: 'Unipile webhook endpoint active',
    agent_mode: getAgentMode(),
    account_locked: !!ACCOUNT_ID,
  });
}
