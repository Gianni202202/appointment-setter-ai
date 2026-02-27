import { NextResponse } from 'next/server';
import { getConversation, updateConversationState } from '@/lib/database';
import { ConversationState } from '@/types';

export async function PUT(request: Request) {
  try {
    const { conversation_id, state, auto_respond } = await request.json();

    const conversation = getConversation(conversation_id);
    if (!conversation) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    if (state) {
      updateConversationState(conversation_id, state as ConversationState);
    }

    if (auto_respond !== undefined) {
      conversation.auto_respond = auto_respond;
    }

    return NextResponse.json({ success: true, conversation: getConversation(conversation_id) });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
