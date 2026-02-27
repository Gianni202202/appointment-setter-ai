import { NextResponse } from 'next/server';

const DSN = process.env.UNIPILE_DSN || '';
const API_KEY = process.env.UNIPILE_API_KEY || '';
const ACCOUNT_ID = process.env.UNIPILE_ACCOUNT_ID || '';

// Helper: extract the best name from a chat object
function extractName(chat: any): string {
  // Try attendees first (find the other person, not yourself)
  if (chat.attendees && Array.isArray(chat.attendees)) {
    for (const a of chat.attendees) {
      if (a.is_me) continue; // Skip yourself
      const name = a.display_name || a.name || a.identifier || '';
      if (name && name !== 'Unknown') return name;
    }
    // If no non-me attendee found, try first attendee
    const first = chat.attendees[0];
    if (first) {
      const name = first.display_name || first.name || first.identifier || '';
      if (name && name !== 'Unknown') return name;
    }
  }
  // Fall back to chat name
  if (chat.name && chat.name !== 'Unknown') return chat.name;
  // Fall back to chat title
  if (chat.title && chat.title !== 'Unknown') return chat.title;
  // Fall back to last message sender
  if (chat.last_message?.sender_name) return chat.last_message.sender_name;
  return 'LinkedIn Contact';
}

function extractHeadline(chat: any): string {
  if (chat.attendees && Array.isArray(chat.attendees)) {
    for (const a of chat.attendees) {
      if (a.is_me) continue;
      if (a.headline) return a.headline;
    }
  }
  return '';
}

function extractCompany(chat: any): string {
  if (chat.attendees && Array.isArray(chat.attendees)) {
    for (const a of chat.attendees) {
      if (a.is_me) continue;
      if (a.company) return a.company;
    }
  }
  return '';
}

export async function GET(request: Request) {
  try {
    if (!DSN || !API_KEY || !ACCOUNT_ID) {
      return NextResponse.json([]);
    }

    const { searchParams } = new URL(request.url);
    const chatId = searchParams.get('chat_id');

    // Single chat with messages
    if (chatId) {
      // Verify ownership
      const chatRes = await fetch(`https://${DSN}/api/v1/chats/${chatId}`, {
        headers: { 'X-API-KEY': API_KEY, 'Accept': 'application/json' },
        cache: 'no-store',
      });

      if (chatRes.ok) {
        const chatData = await chatRes.json();
        if (chatData.account_id && chatData.account_id !== ACCOUNT_ID) {
          return NextResponse.json({ error: 'Access denied' }, { status: 403 });
        }

        // Also extract participant info for the detail page
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
          sender_name: msg.sender?.display_name || msg.sender?.name || '',
          is_read: true,
        }));

        messages.sort((a: any, b: any) =>
          new Date(a.sent_at).getTime() - new Date(b.sent_at).getTime()
        );

        return NextResponse.json({
          messages,
          prospect_name: extractName(chatData),
          prospect_headline: extractHeadline(chatData),
          prospect_company: extractCompany(chatData),
          chat_id: chatId,
        });
      }

      return NextResponse.json({ error: 'Chat not found' }, { status: 404 });
    }

    // Fetch all chats — ONLY our account
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
      allChats = allChats.concat(firstData.items || firstData || []);
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

    // Security filter
    allChats = allChats.filter((chat: any) => {
      if (chat.account_id && chat.account_id !== ACCOUNT_ID) return false;
      return true;
    });

    const conversations = allChats.map((chat: any) => ({
      id: chat.id,
      unipile_chat_id: chat.id,
      prospect_name: extractName(chat),
      prospect_headline: extractHeadline(chat),
      prospect_company: extractCompany(chat),
      state: 'new',
      last_message_at: chat.last_message_at || chat.updated_at || chat.timestamp || '',
      last_message_text: chat.last_message?.text || '',
      created_at: chat.created_at || chat.timestamp || '',
      message_count: chat.messages_count || 0,
    }));

    conversations.sort((a: any, b: any) =>
      new Date(b.last_message_at || 0).getTime() - new Date(a.last_message_at || 0).getTime()
    );

    return NextResponse.json(conversations);
  } catch (error) {
    console.error('[Conversations API] Error:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
