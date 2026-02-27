import { NextResponse } from 'next/server';

const DSN = process.env.UNIPILE_DSN || '';
const API_KEY = process.env.UNIPILE_API_KEY || '';
const ACCOUNT_ID = process.env.UNIPILE_ACCOUNT_ID || '';

const uniHeaders = { 'X-API-KEY': API_KEY, 'Accept': 'application/json' };

// Fetch attendees for a chat using the dedicated endpoint
async function fetchAttendees(chatId: string): Promise<{ name: string; headline: string; company: string; profile_url: string }> {
  try {
    const res = await fetch(`https://${DSN}/api/v1/chats/${chatId}/attendees`, {
      headers: uniHeaders,
      cache: 'no-store',
    });
    if (!res.ok) return { name: '', headline: '', company: '', profile_url: '' };
    const data = await res.json();
    const attendees = data.items || data || [];
    
    // Find the non-me attendee
    for (const a of attendees) {
      if (a.is_me) continue;
      return {
        name: a.display_name || a.name || a.identifier || '',
        headline: a.headline || a.tagline || '',
        company: a.company || a.organization || '',
        profile_url: a.profile_url || '',
      };
    }
    // Fallback to first attendee
    if (attendees.length > 0) {
      const a = attendees[0];
      return {
        name: a.display_name || a.name || a.identifier || '',
        headline: a.headline || a.tagline || '',
        company: a.company || a.organization || '',
        profile_url: a.profile_url || '',
      };
    }
    return { name: '', headline: '', company: '', profile_url: '' };
  } catch {
    return { name: '', headline: '', company: '', profile_url: '' };
  }
}

// Extract name from chat object (fast path, no extra API call)
function extractNameFromChat(chat: any): string {
  if (chat.attendees && Array.isArray(chat.attendees)) {
    for (const a of chat.attendees) {
      if (a.is_me) continue;
      const name = a.display_name || a.name || a.identifier || '';
      if (name && name !== 'Unknown') return name;
    }
  }
  if (chat.name && chat.name !== 'Unknown') return chat.name;
  if (chat.title && chat.title !== 'Unknown') return chat.title;
  return '';
}

export async function GET(request: Request) {
  try {
    if (!DSN || !API_KEY || !ACCOUNT_ID) {
      return NextResponse.json([]);
    }

    const { searchParams } = new URL(request.url);
    const chatId = searchParams.get('chat_id');

    // =============================================
    // SINGLE CHAT — with messages and full details
    // =============================================
    if (chatId) {
      const chatRes = await fetch(`https://${DSN}/api/v1/chats/${chatId}`, {
        headers: uniHeaders, cache: 'no-store',
      });

      if (!chatRes.ok) {
        return NextResponse.json({ error: 'Chat not found' }, { status: 404 });
      }

      const chatData = await chatRes.json();
      if (chatData.account_id && chatData.account_id !== ACCOUNT_ID) {
        return NextResponse.json({ error: 'Access denied' }, { status: 403 });
      }

      // Get attendees via dedicated endpoint
      const attendeeInfo = await fetchAttendees(chatId);

      // Get messages
      const msgsRes = await fetch(`https://${DSN}/api/v1/chats/${chatId}/messages?limit=50`, {
        headers: uniHeaders, cache: 'no-store',
      });

      let messages: any[] = [];
      if (msgsRes.ok) {
        const msgsData = await msgsRes.json();
        messages = (msgsData.items || msgsData || []).map((msg: any) => ({
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
      }

      // Pick best name
      let prospect_name = attendeeInfo.name || extractNameFromChat(chatData);
      if (!prospect_name) {
        // Last resort: get name from messages
        for (const msg of messages) {
          if (msg.role === 'prospect' && msg.sender_name) {
            prospect_name = msg.sender_name;
            break;
          }
        }
      }

      return NextResponse.json({
        messages,
        prospect_name: prospect_name || 'LinkedIn Contact',
        prospect_headline: attendeeInfo.headline,
        prospect_company: attendeeInfo.company,
        prospect_profile_url: attendeeInfo.profile_url,
        chat_id: chatId,
      });
    }

    // =============================================
    // CHAT LIST — with enriched names
    // =============================================
    let allChats: any[] = [];
    let nextCursor: string | null = null;
    const maxChats = 200;

    const firstUrl = `https://${DSN}/api/v1/chats?limit=100&account_id=${ACCOUNT_ID}`;
    const firstRes = await fetch(firstUrl, {
      headers: uniHeaders, cache: 'no-store',
    });

    if (firstRes.ok) {
      const firstData = await firstRes.json();
      allChats = allChats.concat(firstData.items || firstData || []);
      nextCursor = firstData.cursor || null;
    }

    while (nextCursor && allChats.length < maxChats) {
      const nextUrl = `https://${DSN}/api/v1/chats?limit=100&account_id=${ACCOUNT_ID}&cursor=${nextCursor}`;
      const nextRes = await fetch(nextUrl, {
        headers: uniHeaders, cache: 'no-store',
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

    // Enrich ALL chats that have no name — use the attendees endpoint
    // Process in batches of 30 to stay within rate limits
    const chatsToEnrich = allChats.filter(c => !extractNameFromChat(c));
    const BATCH_SIZE = 30;
    const enrichMap = new Map<string, { name: string; headline: string; company: string; profile_url: string }>();

    for (let i = 0; i < Math.min(chatsToEnrich.length, BATCH_SIZE * 3); i += BATCH_SIZE) {
      const batch = chatsToEnrich.slice(i, i + BATCH_SIZE);
      const results = await Promise.allSettled(
        batch.map(async (chat: any) => {
          const info = await fetchAttendees(chat.id);
          return { chatId: chat.id, ...info };
        })
      );

      for (const result of results) {
        if (result.status === 'fulfilled' && result.value.name) {
          enrichMap.set(result.value.chatId, result.value);
        }
      }
    }

    const conversations = allChats.map((chat: any) => {
      const enriched = enrichMap.get(chat.id);
      const baseName = extractNameFromChat(chat);

      return {
        id: chat.id,
        unipile_chat_id: chat.id,
        prospect_name: baseName || enriched?.name || 'LinkedIn Contact',
        prospect_headline: enriched?.headline || '',
        prospect_company: enriched?.company || '',
        prospect_profile_url: enriched?.profile_url || '',
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
