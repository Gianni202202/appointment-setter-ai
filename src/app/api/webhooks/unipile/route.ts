import { NextResponse } from 'next/server';
import { getConversationByChatId, createConversation, addMessage, getConfig, isAgentEnabled, updateConversationState } from '@/lib/database';
import { generateResponse } from '@/lib/claude';
import { getNextState, shouldAutoRespond } from '@/lib/state-machine';
import { sendMessage } from '@/lib/unipile';
import { runSafetyChecks, markAsResponded } from '@/lib/safety';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    console.log('[Webhook] Received event:', JSON.stringify(body, null, 2));

    const event = body.event || body.type;
    const data = body.data || body;

    if (event === 'message_received' || event === 'message.created') {
      const chatId = data.chat_id || data.chatId;
      const messageText = data.text || data.body || '';
      const senderId = data.sender_id || data.senderId;
      const messageId = data.id || data.message_id || crypto.randomUUID();
      const timestamp = data.timestamp || new Date().toISOString();

      if (!chatId || !messageText) {
        return NextResponse.json({ status: 'skipped', reason: 'missing data' });
      }

      // Find or create conversation
      let conversation = getConversationByChatId(chatId);
      if (!conversation) {
        conversation = createConversation({
          unipile_chat_id: chatId,
          prospect_name: data.sender_name || 'Unknown',
          prospect_headline: data.sender_headline || '',
          prospect_company: '',
          prospect_avatar_url: data.sender_avatar || '',
          state: 'new',
          icp_score: 0,
          auto_respond: true,
          last_message_at: timestamp,
        });
      }

      // Store the incoming message
      addMessage({
        conversation_id: conversation.id,
        role: 'prospect',
        content: messageText,
        sent_at: timestamp,
        is_read: false,
      });

      // ============================================
      // SAFETY CHECKS — all must pass before responding
      // ============================================
      const config = getConfig();
      const lastMessageRole = 'prospect'; // We just received from prospect

      const safety = runSafetyChecks(
        conversation.id,
        lastMessageRole,
        messageId,
        isAgentEnabled(),
        conversation.auto_respond,
        config.rules.working_hours_start,
        config.rules.working_hours_end,
      );

      if (!safety.allowed) {
        console.log(`[Webhook] Safety block: ${safety.reason} | Conversation: ${conversation.prospect_name}`);
        return NextResponse.json({
          status: 'received_but_blocked',
          reason: safety.reason,
          conversation_id: conversation.id,
        });
      }

      // Additional state machine check
      if (!shouldAutoRespond(conversation.state)) {
        console.log(`[Webhook] State block: auto-respond not allowed in state '${conversation.state}'`);
        return NextResponse.json({
          status: 'received_but_state_blocked',
          state: conversation.state,
          conversation_id: conversation.id,
        });
      }

      // ============================================
      // DELAYED RESPONSE — schedule with human-like delay
      // ============================================
      const delayMs = safety.delay_ms || 60000; // Default 1 min
      console.log(`[Webhook] Scheduling response in ${Math.round(delayMs / 1000)}s for ${conversation.prospect_name}`);

      // Use setTimeout for delay (in production, use a job queue)
      setTimeout(async () => {
        try {
          const aiResponse = await generateResponse(
            config,
            conversation!.state,
            conversation!.messages,
            {
              name: conversation!.prospect_name,
              headline: conversation!.prospect_headline,
              company: conversation!.prospect_company,
            }
          );

          // Update conversation state
          const newState = getNextState(conversation!.state, conversation!.messages, {
            sentiment: aiResponse.sentiment,
            hasObjection: aiResponse.has_objection,
            objectionType: aiResponse.objection_type as any,
            meetingMentioned: aiResponse.meeting_mentioned,
            notInterested: aiResponse.not_interested,
          });

          if (newState !== conversation!.state) {
            updateConversationState(conversation!.id, newState);
          }

          if (aiResponse.should_respond && !aiResponse.needs_human) {
            // Send via Unipile
            try {
              await sendMessage(chatId, aiResponse.message);
            } catch (sendErr) {
              console.error('[Webhook] Send failed:', sendErr);
            }

            // Store the sent message
            addMessage({
              conversation_id: conversation!.id,
              role: 'agent',
              content: aiResponse.message,
              reasoning: aiResponse.reasoning,
              sent_at: new Date().toISOString(),
              is_read: true,
            });

            // Mark as responded for safety tracking
            markAsResponded(conversation!.id, messageId);

            console.log(`[Webhook] ✅ Responded to ${conversation!.prospect_name} | State: ${conversation!.state} → ${newState}`);
          } else {
            console.log(`[Webhook] AI chose not to respond: ${aiResponse.reason_for_no_response || 'needs_human'}`);
          }
        } catch (aiError) {
          console.error('[Webhook] AI response error:', aiError);
        }
      }, delayMs);

      return NextResponse.json({
        status: 'received_and_scheduled',
        delay_seconds: Math.round(delayMs / 1000),
        conversation_id: conversation.id,
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
    agent_enabled: isAgentEnabled(),
  });
}
