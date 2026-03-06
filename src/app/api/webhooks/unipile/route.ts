import { NextResponse } from 'next/server';
import { getAgentMode, getConfig, getConversationPhase, addDraft, logActivity } from '@/lib/database';
import { verifyChatOwnership } from '@/lib/unipile';
import { isWithinWorkingHours } from '@/lib/human-timing';
import { generateResponse } from '@/lib/claude';

const DSN = process.env.UNIPILE_DSN || '';
const API_KEY = process.env.UNIPILE_API_KEY || '';
const ACCOUNT_ID = process.env.UNIPILE_ACCOUNT_ID || '';


export async function POST(request: Request) {
  try {
    const body = await request.json();
    console.log('[Webhook] Received event:', JSON.stringify(body).substring(0, 500));

    const event = body.event || body.type;
    const data = body.data || body;

    // SECURITY: Reject events from other accounts
    const eventAccountId = data.account_id || data.accountId;
    if (ACCOUNT_ID && eventAccountId && eventAccountId !== ACCOUNT_ID) {
      console.warn(`[Webhook] BLOCKED: Event from account ${eventAccountId}`);
      return NextResponse.json({ status: 'blocked', reason: 'wrong_account' });
    }

    if (event === 'message_received' || event === 'message.created') {
      const chatId = data.chat_id || data.chatId;
      const messageText = data.text || data.body || '';
      const senderId = data.sender_id || data.sender?.id || '';

      if (!chatId || !messageText) {
        return NextResponse.json({ status: 'skipped', reason: 'missing data' });
      }

      // Skip messages sent by us
      const isSentByMe = data.is_sender || data.sender?.is_me || false;
      if (isSentByMe) {
        return NextResponse.json({ status: 'skipped', reason: 'own_message' });
      }

      // SECURITY: Verify chat ownership
      if (ACCOUNT_ID) {
        const isOwner = await verifyChatOwnership(chatId);
        if (!isOwner) {
          return NextResponse.json({ status: 'blocked', reason: 'chat_not_owned' });
        }
      }

      const mode = getAgentMode();
      if (mode === 'off') {
        return NextResponse.json({ status: 'received_but_agent_disabled' });
      }

      // =====================================================
      // COPILOT MODE: Auto-generate draft for this chat
      // =====================================================
      if (mode === 'copilot' || mode === 'auto') {
        console.log(`[Webhook] Mode=${mode}, generating draft for chat ${chatId}`);
        
        try {
          // Fetch prospect name
          let prospectName = 'LinkedIn Contact';
          try {
            const attendeesRes = await fetch(`https://${DSN}/api/v1/chats/${chatId}/attendees`, {
              headers: { 'X-API-KEY': API_KEY, 'Accept': 'application/json' },
              cache: 'no-store',
            });
            if (attendeesRes.ok) {
              const aData = await attendeesRes.json();
              const attendees = aData.items || aData || [];
              for (const a of attendees) {
                if (a.is_me) continue;
                prospectName = a.display_name || a.name || a.identifier || prospectName;
                break;
              }
            }
          } catch {}

          // Fetch recent messages for context
          const msgsRes = await fetch(`https://${DSN}/api/v1/chats/${chatId}/messages?limit=10`, {
            headers: { 'X-API-KEY': API_KEY, 'Accept': 'application/json' },
            cache: 'no-store',
          });
          
          let messages: any[] = [];
          if (msgsRes.ok) {
            const msgsData = await msgsRes.json();
            const items = msgsData.items || msgsData || [];
            items.sort((a: any, b: any) =>
              new Date(a.timestamp || a.date || 0).getTime() - new Date(b.timestamp || b.date || 0).getTime()
            );
            messages = items.map((m: any) => ({
              id: m.id || '',
              role: (m.is_sender || m.sender?.is_me) ? 'agent' : 'prospect',
              content: m.text || m.body || '',
              sent_at: m.timestamp || m.date || '',
              conversation_id: chatId,
              is_read: true,
            })).filter((m: any) => m.content);
          }

          if (messages.length === 0) {
            messages = [{ id: 'webhook', role: 'prospect', content: messageText, sent_at: new Date().toISOString(), conversation_id: chatId, is_read: true }];
          }

          // Build proper config and state for generateResponse
          const config = getConfig();
          const storedPhase = getConversationPhase(chatId);
          let convState: any = messages.length <= 1 ? 'new' : 'engaged';
          if (storedPhase === 'weerstand') convState = 'objection';
          if (storedPhase === 'call' || storedPhase === 'proof') convState = 'qualified';

          // Generate AI response with proper signature (state is a string enum)
          const aiResponse = await generateResponse(config, convState, messages, {
            name: prospectName,
            headline: '',
            company: '',
          });

          if (aiResponse.message && !aiResponse.message.includes('[AI response could not be parsed')) {
            const draft = addDraft({
              chat_id: chatId,
              prospect_name: prospectName,
              prospect_headline: '',
              message: aiResponse.message,
              reasoning: aiResponse.reasoning || '',
              phase: aiResponse.phase,
              confidence: aiResponse.confidence || 'medium',
            });

            logActivity('draft_created', prospectName, {
              chat_id: chatId,
              draft_id: draft.id,
              source: 'webhook_auto',
              phase: aiResponse.phase,
            });

            console.log(`[Webhook] Draft created for ${prospectName}: ${draft.id}`);

            return NextResponse.json({
              status: 'draft_created',
              draft_id: draft.id,
              prospect: prospectName,
              mode,
            });
          } else {
            console.warn(`[Webhook] AI response unusable for chat ${chatId}`);
            return NextResponse.json({ status: 'ai_response_failed', chat_id: chatId });
          }
        } catch (genErr) {
          console.error('[Webhook] Draft generation error:', genErr);
          return NextResponse.json({ status: 'generation_error', error: String(genErr) });
        }
      }

      return NextResponse.json({ status: 'received', chat_id: chatId, mode });
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
