import { NextResponse } from 'next/server';
import { getConversationByChatId, createConversation, addMessage, getConfig } from '@/lib/database';
import { getMessages as getUnipileMessages } from '@/lib/unipile';
import { generateResponse } from '@/lib/claude';
import { getNextState, shouldAutoRespond } from '@/lib/state-machine';
import { sendMessage } from '@/lib/unipile';

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

      // Check if we should auto-respond
      const config = getConfig();
      if (conversation.auto_respond && shouldAutoRespond(conversation.state)) {
        try {
          const aiResponse = await generateResponse(
            config,
            conversation.state,
            conversation.messages,
            {
              name: conversation.prospect_name,
              headline: conversation.prospect_headline,
              company: conversation.prospect_company,
            }
          );

          // Update conversation state
          const newState = getNextState(conversation.state, conversation.messages, {
            sentiment: aiResponse.sentiment,
            hasObjection: aiResponse.has_objection,
            objectionType: aiResponse.objection_type as any,
            meetingMentioned: aiResponse.meeting_mentioned,
            notInterested: aiResponse.not_interested,
          });

          if (aiResponse.should_respond && !aiResponse.needs_human) {
            // Send via Unipile
            await sendMessage(chatId, aiResponse.message);

            // Store the sent message
            addMessage({
              conversation_id: conversation.id,
              role: 'agent',
              content: aiResponse.message,
              reasoning: aiResponse.reasoning,
              sent_at: new Date().toISOString(),
              is_read: true,
            });
          }

          console.log(`[Webhook] Processed: ${conversation.prospect_name} | State: ${conversation.state} → ${newState}`);
        } catch (aiError) {
          console.error('[Webhook] AI response error:', aiError);
        }
      }

      return NextResponse.json({ status: 'processed', conversation_id: conversation.id });
    }

    return NextResponse.json({ status: 'ignored', event });
  } catch (error) {
    console.error('[Webhook] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({ status: 'ok', message: 'Unipile webhook endpoint active' });
}
