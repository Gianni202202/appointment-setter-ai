import { NextResponse } from 'next/server';
import { generateResponse, LegendaryContext } from '@/lib/claude';
import { getConfigAsync, addDraft, getDrafts, getConversationMemoryAsync, getPreviousOpenersAsync, getConversationPhaseAsync, setConversationPhase, addPreviousOpener, updateConversationMemory } from '@/lib/database';

// Pro plan: allow up to 60s execution
export const maxDuration = 60;

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
      (await getDrafts()).filter(d => d.status === 'pending' || d.status === 'approved').map(d => d.chat_id)
    );
    const toProcess = chatIds.filter(id => !existingDraftChatIds.has(id));

    if (toProcess.length === 0) {
      return NextResponse.json({
        drafts_created: 0,
        message: 'All selected chats already have drafts.',
      });
    }

    const config = await getConfigAsync();
    const results: { chat_id: string; prospect: string; status: string; message?: string }[] = [];

    for (const chatId of toProcess.slice(0, 25)) { // Process up to 25 chats per batch
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

        // Extract prospect info via dedicated /attendees endpoint (inline attendees array is often empty)
        let prospectName = 'Unknown';
        let prospectHeadline = '';
        let prospectCompany = '';
        try {
          const attendeesRes = await fetch(`https://${DSN}/api/v1/chats/${chatId}/attendees`, {
            headers: { 'X-API-KEY': API_KEY, 'Accept': 'application/json' },
            cache: 'no-store',
          });
          if (attendeesRes.ok) {
            const attendeesData = await attendeesRes.json();
            const attendees = attendeesData.items || attendeesData || [];
            for (const a of attendees) {
              if (a.is_me) continue;
              prospectName = a.display_name || a.name || a.identifier || prospectName;
              prospectHeadline = a.headline || a.tagline || '';
              prospectCompany = a.company || a.organization || '';
              break;
            }
          }
        } catch (e) {
          console.warn('[Copilot] Failed to fetch attendees for', chatId, e);
        }
        // Fallback: try chat object fields
        if (prospectName === 'Unknown') {
          if (chatData.attendees && Array.isArray(chatData.attendees)) {
            for (const a of chatData.attendees) {
              if (a.is_me) continue;
              prospectName = a.display_name || a.name || a.identifier || prospectName;
              break;
            }
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
        const storedPhase = await getConversationPhaseAsync(chatId);
        let state: any = messages.length === 0 ? 'new' : 'engaged';
        if (storedPhase === 'weerstand') state = 'objection';
        if (storedPhase === 'call' || storedPhase === 'proof') state = 'qualified';

        const memory = await getConversationMemoryAsync(chatId);
        const previousOpeners = await getPreviousOpenersAsync(chatId);
        const now = new Date();
        const cetHour = (now.getUTCHours() + 1) % 24;

        const legendaryContext: LegendaryContext = {
          messageCount: messages.length,
          previousOpeners,
          conversationMemory: memory?.facts || null,
          detectedPhase: storedPhase || null,
          currentHourCET: cetHour,
        };

        // 4. Call Gemini directly
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

        // 6. ALWAYS add to draft queue — user decides what to send, not the AI
        if (aiResponse.message) {
          await addDraft({
            chat_id: chatId,
            prospect_name: prospectName,
            prospect_headline: prospectHeadline,
            message: aiResponse.message,
            reasoning: aiResponse.reasoning || (aiResponse.should_respond === false ? '⚠️ AI suggested skipping this chat, but draft created for your review.' : ''),
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
          // AI returned no message at all — very rare edge case
          results.push({
            chat_id: chatId,
            prospect: prospectName,
            status: 'no_message_generated',
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

