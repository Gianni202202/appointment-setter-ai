import { NextResponse } from 'next/server';

const DSN = process.env.UNIPILE_DSN || '';
const API_KEY = process.env.UNIPILE_API_KEY || '';
const ACCOUNT_ID = process.env.UNIPILE_ACCOUNT_ID || '';

export async function GET(request: Request) {
  try {
    if (!DSN || !API_KEY || !ACCOUNT_ID) {
      return NextResponse.json([]);
    }

    const { searchParams } = new URL(request.url);
    const chatId = searchParams.get('chat_id');

    // Single chat with messages — verify it belongs to our account
    if (chatId) {
      // First verify this chat belongs to our account
      const chatRes = await fetch(`https://${DSN}/api/v1/chats/${chatId}`, {
        headers: { 'X-API-KEY': API_KEY, 'Accept': 'application/json' },
        cache: 'no-store',
      });

      if (chatRes.ok) {
        const chatData = await chatRes.json();
        // SECURITY: Only allow access to chats from our account
        if (chatData.account_id && chatData.account_id !== ACCOUNT_ID) {
          return NextResponse.json({ error: 'Access denied' }, { status: 403 });
        }
      }

      const msgsRes = await fetch(`https://${DSN}/api/v1/chats/${chatId}/messages?limit=50`, {
        headers: { 'X-API-KEY': API_KEY, 'Accept': 'application/json' },
        cache: 'no-store',
      });

      if (!msgsRes.ok) {
        return NextResponse.json({ error: 'Failed to fetch messages' }, { status: 500 });
      }

      const msgsData = await msgsRes.json();
      const messages = (msgsData.items || msgsData || []).map((msg: any) => ({
        id: msg.id,
        role: (msg.is_sender || msg.sender?.is_me) ? 'agent' : 'prospect',
        content: msg.text || msg.body || '',
        sent_at: msg.timestamp || msg.date || '',
        is_read: true,
      }));

      messages.sort((a: any, b: any) =>
        new Date(a.sent_at).getTime() - new Date(b.sent_at).getTime()
      );

      return NextResponse.json({ messages });
    }

    // SECURITY: Fetch ONLY chats for our specific account
    let allChats: any[] = [];
    let nextCursor: string | null = null;
    const maxChats = 200;

    const firstUrl = `https://${DSN}/api/v1/chats?limit=100&account_id=${ACCOUNT_ID}`;
    const firstRes = await fetch(firstUrl, {
      headers: { 'X-API-KEY': API_KEY, 'Accept': 'application/json' },
      cache: 'no-store',
    });

    if (firstRes.ok) {
      const firstData = await firstRes.json();
      const firstItems = firstData.items || firstData || [];
      allChats = allChats.concat(firstItems);
      nextCursor = firstData.cursor || null;
    }

    while (nextCursor && allChats.length < maxChats) {
      const nextUrl = `https://${DSN}/api/v1/chats?limit=100&account_id=${ACCOUNT_ID}&cursor=${nextCursor}`;
      const nextRes = await fetch(nextUrl, {
        headers: { 'X-API-KEY': API_KEY, 'Accept': 'application/json' },
        cache: 'no-store',
      });

      if (!nextRes.ok) break;

      const nextData = await nextRes.json();
      const nextItems = nextData.items || nextData || [];
      if (nextItems.length === 0) break;

      allChats = allChats.concat(nextItems);
      nextCursor = nextData.cursor || null;
    }

    allChats = allChats.slice(0, maxChats);

    // EXTRA SECURITY: Double-check account_id on each chat
    allChats = allChats.filter((chat: any) => {
      if (chat.account_id && chat.account_id !== ACCOUNT_ID) return false;
      return true;
    });

    const conversations = allChats.map((chat: any) => {
      const otherParticipant = chat.attendees?.find((a: any) => !a.is_me) || chat.attendees?.[0];

      return {
        id: chat.id,
        unipile_chat_id: chat.id,
        prospect_name: otherParticipant?.display_name || otherParticipant?.name || chat.name || 'Unknown',
        prospect_headline: otherParticipant?.headline || '',
        prospect_company: otherParticipant?.company || '',
        prospect_avatar_url: otherParticipant?.avatar_url || '',
        state: 'new',
        last_message_at: chat.last_message_at || chat.updated_at || chat.timestamp || '',
        last_message_text: chat.last_message?.text || '',
        created_at: chat.created_at || chat.timestamp || '',
        message_count: chat.messages_count || 0,
      };
    });

    conversations.sort((a: any, b: any) =>
      new Date(b.last_message_at || 0).getTime() - new Date(a.last_message_at || 0).getTime()
    );

    return NextResponse.json(conversations);
  } catch (error) {
    console.error('[Conversations API] Error:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
