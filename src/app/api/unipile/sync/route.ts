import { NextResponse } from 'next/server';

const DSN = process.env.UNIPILE_DSN || '';
const API_KEY = process.env.UNIPILE_API_KEY || '';
const ACCOUNT_ID = process.env.UNIPILE_ACCOUNT_ID || '';

export async function POST() {
  try {
    if (!DSN || !API_KEY) {
      return NextResponse.json({ error: 'Unipile not configured' }, { status: 400 });
    }

    if (!ACCOUNT_ID) {
      return NextResponse.json({ error: 'UNIPILE_ACCOUNT_ID not configured — required for security' }, { status: 400 });
    }

    // SECURITY: Fetch ONLY chats from our specific account
    let allChats: any[] = [];
    let nextCursor: string | null = null;
    const maxChats = 200;

    const firstUrl = `https://${DSN}/api/v1/chats?limit=100&account_id=${ACCOUNT_ID}`;
    const firstRes = await fetch(firstUrl, {
      headers: { 'X-API-KEY': API_KEY, 'Accept': 'application/json' },
      cache: 'no-store',
    });

    if (!firstRes.ok) {
      const err = await firstRes.text();
      return NextResponse.json({ error: 'Failed to fetch chats', details: err }, { status: 500 });
    }

    const firstData = await firstRes.json();
    const firstItems = firstData.items || firstData || [];
    allChats = allChats.concat(firstItems);
    nextCursor = firstData.cursor || null;

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

    // EXTRA SECURITY: Filter out any chats not belonging to our account
    allChats = allChats.filter((chat: any) => {
      if (chat.account_id && chat.account_id !== ACCOUNT_ID) return false;
      return true;
    });

    const synced: any[] = [];

    for (const chat of allChats) {
      const otherParticipant = chat.attendees?.find((a: any) => !a.is_me) || chat.attendees?.[0];

      synced.push({
        id: chat.id,
        chat_id: chat.id,
        name: otherParticipant?.display_name || otherParticipant?.name || chat.name || 'Unknown',
        headline: otherParticipant?.headline || '',
        company: otherParticipant?.company || '',
        last_message_at: chat.last_message_at || chat.updated_at || '',
        message_count: chat.messages_count || 0,
      });
    }

    return NextResponse.json({
      success: true,
      synced_count: synced.length,
      synced,
      message: synced.length > 0
        ? `Found ${synced.length} conversations from your LinkedIn account.`
        : 'No conversations found.',
    });
  } catch (error) {
    console.error('[Sync] Error:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
