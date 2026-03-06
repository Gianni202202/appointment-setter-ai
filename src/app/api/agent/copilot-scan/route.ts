import { NextResponse } from 'next/server';
import { generateResponse, LegendaryContext } from '@/lib/claude';
import { getConfig, addDraft, getDrafts, getConversationMemory, getPreviousOpeners, getConversationPhase, setConversationPhase, addPreviousOpener, updateConversationMemory } from '@/lib/database';

const DSN = process.env.UNIPILE_DSN || '';
const API_KEY = process.env.UNIPILE_API_KEY || '';
const ACCOUNT_ID = process.env.UNIPILE_ACCOUNT_ID || '';

/**
 * POST — Generate drafts for specific chat_ids (selected by user in UI).
 * No mode gate — the UI controls when this is called.
 * Uses direct generateResponse() instead of self-HTTP calls.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const chatIds: string[] = body.chat_ids || [];
    const customInstruction: string | undefined = body.custom_instruction;

    if (chatIds.length === 0) {
      return NextResponse.json({ error: 'No chat_ids provided' }, { status: 400 });
    }

    if (!DSN || !API_KEY || !ACCOUNT_ID) {
      return NextResponse.json({ error: 'Unipile not configured' }, { status: 400 });
    }

    // Skip chats that already have pending/approved drafts
    const existingDraftChatIds = new Set(
      getDrafts().filter(d => d.status === 'pending' || d.status === 'approved').map(d => d.chat_id)
    );
    const toProcess = chatIds.filter(id => !existingDraftChatIds.has(id));

    if (toProcess.length === 0) {
      return NextResponse.json({
        drafts_created: 0,
        message: 'All selected chats already have drafts.',
      });
    }

    const config = getConfig();
    const results: { chat_id: string; prospect: string; status: string; message?: string }[] = [];

    for (const chatId of toProcess.slice(0, 10)) {
      try {
        // 1. Fetch chat info
        const chatRes = await fetch(`https://${DSN}/api/v1/chats/${chatId}`, {
          headers: { 'X-API-KEY': API_KEY, 'Accept': 'application/json' },
          cache: 'no-store',
        });
        if (!chatRes.ok) {
          results.push({ chat_id: chatId, prospect: 'Unknown', status: 'error_chat_not_found' });
          continue;
        }
        const chatData = await chatRes.json();

        // Extract prospect info
        let prospectName = 'Unknown';
        let prospectHeadline = '';
        let prospectCompany = '';
        if (chatData.attendees && Array.isArray(chatData.attendees)) {
          for (const a of chatData.attendees) {
            if (a.is_me) continue;
            prospectName = a.display_name || a.name || a.identifier || prospectName;
            prospectHeadline = a.headline || '';
            prospectCompany = a.company || '';
            break;
          }
        }
        if (prospectName === 'Unknown') {
          prospectName = chatData.name || chatData.title || 'LinkedIn Contact';
        }

        // 2. Fetch messages
        const msgsRes = await fetch(`https://${DSN}/api/v1/chats/${chatId}/messages?limit=30`, {
          headers: { 'X-API-KEY': API_KEY, 'Accept': 'application/json' },
          cache: 'no-store',
        });
        let messages: any[] = [];
        if (msgsRes.ok) {
          const msgsData = await msgsRes.json();
          const rawMsgs = msgsData.items || msgsData || [];
          rawMsgs.sort((a: any, b: any) =>
            new Date(a.timestamp || a.date || 0).getTime() - new Date(b.timestamp || b.date || 0).getTime()
          );
          messages = rawMsgs.map((msg: any) => ({
            id: msg.id,
            role: (msg.is_sender || msg.sender?.is_me) ? 'agent' : 'prospect',
            content: msg.text || msg.body || '',
            sent_at: msg.timestamp || msg.date || '',
            conversation_id: chatId,
            is_read: true,
          }));
        }

        // 3. Build state & legendary context
        const storedPhase = getConversationPhase(chatId);
        let state: any = messages.length === 0 ? 'new' : 'engaged';
        if (storedPhase === 'weerstand') state = 'objection';
        if (storedPhase === 'call' || storedPhase === 'proof') state = 'qualified';

        const memory = getConversationMemory(chatId);
        const previousOpeners = getPreviousOpeners(chatId);
        const now = new Date();
        const cetHour = (now.getUTCHours() + 1) % 24;

        const legendaryContext: LegendaryContext = {
          messageCount: messages.length,
          previousOpeners,
          conversationMemory: memory?.facts || null,
          detectedPhase: storedPhase || null,
          currentHourCET: cetHour,
        };

        // 4. Call Claude directly
        const aiResponse = await generateResponse(
          config,
          state,
          messages,
          { name: prospectName, headline: prospectHeadline, company: prospectCompany },
          legendaryContext,
          customInstruction
        );

        // 5. Store phase & memory
        if (aiResponse.phase) setConversationPhase(chatId, aiResponse.phase);
        if (aiResponse.message) {
          addPreviousOpener(chatId, aiResponse.message.split('\n')[0].substring(0, 60));
        }

        // 6. Add to draft queue
        if (aiResponse.message && aiResponse.should_respond) {
          addDraft({
            chat_id: chatId,
            prospect_name: prospectName,
            prospect_headline: prospectHeadline,
            message: aiResponse.message,
            reasoning: aiResponse.reasoning || '',
            phase: aiResponse.phase,
            confidence: aiResponse.confidence,
          });
          results.push({
            chat_id: chatId,
            prospect: prospectName,
            status: 'draft_created',
            message: aiResponse.message.substring(0, 80) + '...',
          });
        } else {
          results.push({
            chat_id: chatId,
            prospect: prospectName,
            status: aiResponse.needs_human ? 'needs_human_review' : 'no_response_needed',
          });
        }
      } catch (err) {
        results.push({ chat_id: chatId, prospect: 'Unknown', status: 'error: ' + String(err) });
      }
    }

    return NextResponse.json({
      processed: toProcess.length,
      drafts_created: results.filter(r => r.status === 'draft_created').length,
      results,
    });
  } catch (error) {
    console.error('[Copilot Scan] Error:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

/**
 * GET — List all chats that need attention (last message from prospect).
 * Used by the dashboard to show selectable conversations.
 */
/**
 * GET — List all chats that need attention (last message from prospect).
 * Robust: checks multiple Unipile field formats for sender detection.
 */
/**
 * GET — List ALL chats from LinkedIn for copilot selection.
 * Uses the same Unipile API as conversations page (which works).
 * Marks which chats have the prospect's last message vs ours.
 */
export async function GET() {
  try {
    if (!DSN || !API_KEY || !ACCOUNT_ID) {
      return NextResponse.json({ error: 'Unipile not configured', needs_attention: [], total_scanned: 0 }, { status: 400 });
    }

    // Fetch ALL chats (same approach as /api/conversations which works)
    const chatsRes = await fetch(`https://${DSN}/api/v1/chats?account_id=${ACCOUNT_ID}&limit=250`, {
      headers: { 'X-API-KEY': API_KEY, 'Accept': 'application/json' },
      cache: 'no-store',
    });

    if (!chatsRes.ok) {
      const errText = await chatsRes.text();
      console.error('[Copilot Scan GET] Unipile error:', chatsRes.status, errText);
      return NextResponse.json({ error: 'Failed to fetch from LinkedIn', needs_attention: [], total_scanned: 0 }, { status: 500 });
    }

    const chatsData = await chatsRes.json();
    const chats = chatsData.items || chatsData || [];
    console.log('[Copilot Scan GET] Fetched', chats.length, 'chats from Unipile');

    const existingDraftChatIds = new Set(
      getDrafts().filter(d => d.status === 'pending' || d.status === 'approved').map(d => d.chat_id)
    );

    const needsAttention: any[] = [];

    for (const chat of chats) {
      // Skip chats from other accounts
      if (chat.account_id && chat.account_id !== ACCOUNT_ID) continue;
      
      // Skip chats that already have drafts
      if (existingDraftChatIds.has(chat.id)) continue;

      // Extract prospect name
      let prospectName = 'LinkedIn Contact';
      if (chat.attendees && Array.isArray(chat.attendees)) {
        for (const a of chat.attendees) {
          if (a.is_me) continue;
          prospectName = a.display_name || a.name || a.identifier || prospectName;
          break;
        }
      }
      if (prospectName === 'LinkedIn Contact') {
        prospectName = chat.name || chat.title || prospectName;
      }

      // Get last message info
      const lastMsg = chat.last_message;
      const lastMessageText = lastMsg?.text || '';
      const lastMessageAt = lastMsg?.timestamp || chat.last_message_at || chat.updated_at || '';
      
      // Skip empty chats
      if (!lastMessageText && !lastMessageAt) continue;

      // Determine if last message is from prospect (try multiple Unipile formats)
      const isSentByMe = lastMsg ? (
        lastMsg.is_sender === true || 
        lastMsg.sender?.is_me === true ||
        (lastMsg.sender_id && lastMsg.sender_id === ACCOUNT_ID)
      ) : false;

      needsAttention.push({
        chat_id: chat.id,
        prospect_name: prospectName,
        last_message_preview: lastMessageText.substring(0, 120),
        last_message_at: lastMessageAt,
        has_draft: false,
        is_prospect_last: !isSentByMe, // Let dashboard show who sent last
        message_count: chat.messages_count || 0,
      });
    }

    // Sort: prospect's last message first, then by date
    needsAttention.sort((a: any, b: any) => {
      if (a.is_prospect_last && !b.is_prospect_last) return -1;
      if (!a.is_prospect_last && b.is_prospect_last) return 1;
      return new Date(b.last_message_at).getTime() - new Date(a.last_message_at).getTime();
    });

    console.log('[Copilot Scan GET] Returning', needsAttention.length, 'chats for copilot');

    return NextResponse.json({
      needs_attention: needsAttention,
      total_scanned: chats.length,
    });
  } catch (error) {
    console.error('[Copilot Scan GET] Error:', error);
    return NextResponse.json({ error: String(error), needs_attention: [], total_scanned: 0 }, { status: 500 });
  }
}
