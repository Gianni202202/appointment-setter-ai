import { NextResponse } from 'next/server';
import { getConversation, addMessage } from '@/lib/database';
import { sendMessage as uniSend } from '@/lib/unipile';

export async function POST(request: Request) {
  try {
    const { conversation_id, text } = await request.json();

    const conversation = getConversation(conversation_id);
    if (!conversation) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });
    }

    // Send via Unipile
    try {
      await uniSend(conversation.unipile_chat_id, text);
    } catch (e) {
      console.warn('[Messages] Unipile send failed (may be demo):', e);
    }

    // Store locally
    const message = addMessage({
      conversation_id,
      role: 'human',
      content: text,
      sent_at: new Date().toISOString(),
      is_read: true,
    });

    return NextResponse.json(message);
  } catch (error) {
    console.error('[Messages] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
