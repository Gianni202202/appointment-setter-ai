import { NextResponse } from 'next/server';
import { getConversation, addMessage } from '@/lib/database';
import { sendMessage as uniSend } from '@/lib/unipile';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const conversation_id = body.conversation_id;
    const text = body.content || body.text;

    if (!conversation_id || !text) {
      return NextResponse.json({ error: 'conversation_id and content are required' }, { status: 400 });
    }

    const conversation = getConversation(conversation_id);
    if (!conversation) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });
    }

    // Send via Unipile if configured
    let unipileSent = false;
    if (process.env.UNIPILE_DSN && process.env.UNIPILE_API_KEY) {
      try {
        await uniSend(conversation.unipile_chat_id, text);
        unipileSent = true;
      } catch (e) {
        console.warn('[Messages] Unipile send failed:', e);
      }
    }

    // Store locally
    const message = addMessage({
      conversation_id,
      role: 'human',
      content: text,
      sent_at: new Date().toISOString(),
      is_read: true,
    });

    return NextResponse.json({ success: true, message, unipile_sent: unipileSent });
  } catch (error) {
    console.error('[Messages] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
