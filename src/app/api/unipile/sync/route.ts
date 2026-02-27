import { NextResponse } from 'next/server';
import { getConversationByChatId, createConversation, addMessage } from '@/lib/database';

const DSN = process.env.UNIPILE_DSN || '';
const API_KEY = process.env.UNIPILE_API_KEY || '';

export async function POST() {
  try {
    if (!DSN || !API_KEY) {
      return NextResponse.json({ error: 'Unipile not configured' }, { status: 400 });
    }

    // Fetch all chats from Unipile
    const chatsRes = await fetch(`https://${DSN}/api/v1/chats`, {
      headers: { 'X-API-KEY': API_KEY, 'Accept': 'application/json' },
    });

    if (!chatsRes.ok) {
      const err = await chatsRes.text();
      return NextResponse.json({ error: 'Failed to fetch chats', details: err }, { status: 500 });
    }

    const chatsData = await chatsRes.json();
    const chats = chatsData.items || chatsData || [];

    const synced: any[] = [];
    const skipped: any[] = [];

    for (const chat of chats) {
      const chatId = chat.id;

      // Skip if already in our database
      if (getConversationByChatId(chatId)) {
        skipped.push({ id: chatId, reason: 'already_synced' });
        continue;
      }

      // Get chat participants info
      const participantName = chat.attendees?.[0]?.display_name
        || chat.attendees?.[0]?.name
        || chat.name
        || 'Unknown';
      const participantHeadline = chat.attendees?.[0]?.headline || '';
      const participantCompany = chat.attendees?.[0]?.company || '';

      // Create conversation with auto_respond OFF by default
      const conv = createConversation({
        unipile_chat_id: chatId,
        prospect_name: participantName,
        prospect_headline: participantHeadline,
        prospect_company: participantCompany,
        prospect_avatar_url: chat.attendees?.[0]?.avatar_url || '',
        state: 'new',
        icp_score: 0,
        auto_respond: false, // CRITICAL: OFF by default — user must enable per conversation
        last_message_at: chat.last_message_at || chat.updated_at || new Date().toISOString(),
      });

      // Fetch recent messages for this chat (last 10)
      try {
        const msgsRes = await fetch(`https://${DSN}/api/v1/chats/${chatId}/messages?limit=10`, {
          headers: { 'X-API-KEY': API_KEY, 'Accept': 'application/json' },
        });

        if (msgsRes.ok) {
          const msgsData = await msgsRes.json();
          const messages = msgsData.items || msgsData || [];

          // Sort oldest first
          messages.sort((a: any, b: any) =>
            new Date(a.timestamp || a.date).getTime() - new Date(b.timestamp || b.date).getTime()
          );

          for (const msg of messages) {
            const isSentByMe = msg.is_sender || msg.sender?.is_me || false;
            addMessage({
              conversation_id: conv.id,
              role: isSentByMe ? 'agent' : 'prospect',
              content: msg.text || msg.body || '',
              sent_at: msg.timestamp || msg.date || new Date().toISOString(),
              is_read: true,
            });
          }
        }
      } catch (msgErr) {
        console.warn(`[Sync] Failed to fetch messages for chat ${chatId}:`, msgErr);
      }

      synced.push({
        id: conv.id,
        chat_id: chatId,
        name: participantName,
        headline: participantHeadline,
        company: participantCompany,
        auto_respond: false,
      });
    }

    return NextResponse.json({
      success: true,
      synced_count: synced.length,
      skipped_count: skipped.length,
      synced,
      skipped,
      message: synced.length > 0
        ? `Synced ${synced.length} conversations. All have auto-respond OFF. Review them and enable the ones you want the agent to handle.`
        : 'No new conversations to sync.',
    });
  } catch (error) {
    console.error('[Sync] Error:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
