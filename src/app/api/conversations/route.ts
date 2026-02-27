import { NextResponse } from 'next/server';

const DSN = process.env.UNIPILE_DSN || '';
const API_KEY = process.env.UNIPILE_API_KEY || '';
const ACCOUNT_ID = process.env.UNIPILE_ACCOUNT_ID || '';

// Helper: extract the best name from a chat object
function extractName(chat: any): string {
  // Try attendees first (find the other person, not yourself)
  if (chat.attendees && Array.isArray(chat.attendees)) {
    for (const a of chat.attendees) {
      if (a.is_me) continue;
      const name = a.display_name || a.name || a.identifier || '';
      if (name && name !== 'Unknown') return name;
    }
    const first = chat.attendees[0];
    if (first) {
      const name = first.display_name || first.name || first.identifier || '';
      if (name && name !== 'Unknown') return name;
    }
  }
  // Try chat name — but skip if it looks like InMail subject
  if (chat.name && chat.name !== 'Unknown') return chat.name;
  if (chat.title && chat.title !== 'Unknown') return chat.title;
  if (chat.last_message?.sender_name) return chat.last_message.sender_name;
  return '';
}

// Fetch attendee details for a single chat
async function enrichChat(chatId: string): Promise<{ name: string; headline: string; company: string }> {
  try {
    const res = await fetch(`https://${DSN}/api/v1/chats/${chatId}`, {
      headers: { 'X-API-KEY': API_KEY, 'Accept': 'application/json' },
      cache: 'no-store',
    });
    if (!res.ok) return { name: '', headline: '', company: '' };
    const data = await res.json();
    let name = extractName(data) || '';
    let headline = '';
    let company = '';
    if (data.attendees && Array.isArray(data.attendees)) {
      for (const a of data.attendees) {
        if (a.is_me) continue;
        if (!name) name = a.display_name || a.name || a.identifier || '';
        headline = a.headline || '';
        company = a.company || '';
        break;
      }
    }
    return { name, headline, company };
  } catch {
    return { name: '', headline: '', company: '' };
  }
}

// Fetch messages for a chat to get sender name
async function getFirstMessage(chatId: string): Promise<string> {
  try {
    const res = await fetch(`https://${DSN}/api/v1/chats/${chatId}/messages?limit=1`, {
      headers: { 'X-API-KEY': API_KEY, 'Accept': 'application/json' },
      cache: 'no-store',
    });
    if (!res.ok) return '';
    const data = await res.json();
    const items = data.items || data || [];
    if (items.length > 0) {
      const msg = items[0];
      // Get sender name from the message if it's from the other person
      if (!msg.is_sender && !msg.sender?.is_me) {
        return msg.sender?.display_name || msg.sender?.name || '';
      }
    }
    return '';
  } catch {
    return '';
  }
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

        // Extract names from attendees
        let prospect_name = extractName(chatData) || 'LinkedIn Contact';
        let prospect_headline = '';
        let prospect_company = '';

        if (chatData.attendees && Array.isArray(chatData.attendees)) {
          for (const a of chatData.attendees) {
            if (a.is_me) continue;
            prospect_headline = a.headline || '';
            prospect_company = a.company || '';
            break;
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
          sender_name: msg.sender?.display_name || msg.sender?.name || '',
          is_read: true,
        }));

        // Try to get the prospect name from messages if still missing
        if (prospect_name === 'LinkedIn Contact') {
          for (const msg of messages) {
            if (msg.role === 'prospect' && msg.sender_name) {
              prospect_name = msg.sender_name;
              break;
            }
          }
        }

        messages.sort((a: any, b: any) =>
          new Date(a.sent_at).getTime() - new Date(b.sent_at).getTime()
        );

        return NextResponse.json({
          messages,
          prospect_name,
          prospect_headline,
          prospect_company,
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

    // Enrich chats that have no name — batch fetch details for unnamed chats
    // Do max 20 concurrent enrichments to avoid rate limiting
    const unnamed = allChats.filter(c => !extractName(c));
    const enrichBatch = unnamed.slice(0, 20);
    
    const enrichments = await Promise.allSettled(
      enrichBatch.map(async (chat: any) => {
        const info = await enrichChat(chat.id);
        if (!info.name) {
          // Last resort: check first message for sender name
          info.name = await getFirstMessage(chat.id) || '';
        }
        return { chatId: chat.id, ...info };
      })
    );

    const enrichMap = new Map<string, { name: string; headline: string; company: string }>();
    for (const result of enrichments) {
      if (result.status === 'fulfilled' && result.value.name) {
        enrichMap.set(result.value.chatId, result.value);
      }
    }

    const conversations = allChats.map((chat: any) => {
      const enriched = enrichMap.get(chat.id);
      const baseName = extractName(chat);
      
      return {
        id: chat.id,
        unipile_chat_id: chat.id,
        prospect_name: baseName || enriched?.name || 'LinkedIn Contact',
        prospect_headline: enriched?.headline || '',
        prospect_company: enriched?.company || '',
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
