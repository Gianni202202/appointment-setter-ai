import { NextResponse } from 'next/server';
import { getConversations, getConversation } from '@/lib/database';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');

  if (id) {
    const conversation = getConversation(id);
    if (!conversation) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    return NextResponse.json(conversation);
  }

  return NextResponse.json(getConversations());
}
