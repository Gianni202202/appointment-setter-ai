import { NextResponse } from 'next/server';
import { generateResponse } from '@/lib/claude';
import { getConfig, addDraft, getDrafts, getConversationPhase, logActivity } from '@/lib/database';

const DSN = process.env.UNIPILE_DSN || '';
const API_KEY = process.env.UNIPILE_API_KEY || '';
const ACCOUNT_ID = process.env.UNIPILE_ACCOUNT_ID || '';

export async function POST(request: Request) {
  if (!DSN || !API_KEY || !ACCOUNT_ID) {
    return NextResponse.json({ error: 'Unipile not configured' }, { status: 400 });
  }

  try {
    // Parse batch params
    let offset = 0;
    let limit = 15;
    let maxSuggestions = 10;
    try {
      const body = await request.json();
      offset = body.offset || 0;
      limit = body.limit || 15;
      maxSuggestions = body.max_suggestions || 10;
    } catch {}

    // Fetch chats with offset for batch processing
    const chatsUrl = 'https://' + DSN + '/api/v1/chats?account_id=' + ACCOUNT_ID + '&limit=' + limit + '&offset=' + offset;
    const chatsRes = await fetch(chatsUrl, {
      headers: { 'X-API-KEY': API_KEY, Accept: 'application/json' },
      cache: 'no-store',
    });

    if (!chatsRes.ok) {
      return NextResponse.json({ error: 'Failed to fetch chats' }, { status: 500 });
    }

    const chatsData = await chatsRes.json();
    const allChats = chatsData.items || chatsData || [];
    const existingDraftChatIds = new Set(
      getDrafts().filter(d => d.status === 'pending' || d.status === 'approved').map(d => d.chat_id)
    );

    const config = getConfig();
    const suggestions: any[] = [];
    let scannedCount = 0;

    for (const chat of allChats) {
      const chatId = chat.id;
      if (existingDraftChatIds.has(chatId)) continue;
      if (suggestions.length >= maxSuggestions) break;

      try {
        const msgsUrl = 'https://' + DSN + '/api/v1/chats/' + chatId + '/messages?limit=10';
        const msgsRes = await fetch(msgsUrl, {
          headers: { 'X-API-KEY': API_KEY, Accept: 'application/json' },
          cache: 'no-store',
        });
        if (!msgsRes.ok) continue;
        scannedCount++;

        const msgsData = await msgsRes.json();
        const rawMsgs = msgsData.items || msgsData || [];
        if (rawMsgs.length === 0) continue;

        rawMsgs.sort((a: any, b: any) =>
          new Date(a.timestamp || a.date || 0).getTime() - new Date(b.timestamp || b.date || 0).getTime()
        );

        const messages = rawMsgs.map((msg: any) => ({
          id: msg.id || '',
          role: (msg.is_sender || msg.sender?.is_me) ? 'agent' : 'prospect',
          content: msg.text || msg.body || '',
          sent_at: msg.timestamp || msg.date || '',
          conversation_id: chatId,
          is_read: true,
        })).filter((m: any) => m.content);

        if (messages.length === 0) continue;

        const lastMsg = messages[messages.length - 1];
        const prospectSentLast = lastMsg.role === 'prospect';
        const lastMsgTime = new Date(lastMsg.sent_at).getTime();
        const hoursAgo = (Date.now() - lastMsgTime) / (1000 * 60 * 60);

        if (hoursAgo > 168) continue; // Skip if >7 days old

        // Interest scoring
        let interestScore = 0;
        const interestReasons: string[] = [];

        if (prospectSentLast) { interestScore += 3; interestReasons.push('Prospect wacht op antwoord'); }
        if (hoursAgo < 24 && prospectSentLast) { interestScore += 2; interestReasons.push('Recent bericht (< 24u)'); }
        if (hoursAgo >= 24 && hoursAgo < 72 && prospectSentLast) { interestScore += 1; interestReasons.push('Follow-up nodig'); }
        const hasQuestion = messages.filter((m: any) => m.role === 'prospect').some((m: any) => m.content.includes('?'));
        if (hasQuestion) { interestScore += 1; interestReasons.push('Prospect stelde een vraag'); }
        const turns = messages.reduce((acc: number, _m: any, i: number) => {
          if (i > 0 && messages[i-1].role !== messages[i].role) return acc + 1;
          return acc;
        }, 0);
        if (turns >= 3) { interestScore += 1; interestReasons.push('Actief gesprek'); }
        if (!prospectSentLast && hoursAgo > 48 && hoursAgo < 120 && turns >= 1) {
          interestScore += 1; interestReasons.push('Geen reactie na 2+ dagen');
        }

        if (interestScore < 2) continue;

        // Get prospect info
        let prospectName = 'LinkedIn Contact';
        let prospectHeadline = '';
        let prospectCompany = '';
        try {
          const attUrl = 'https://' + DSN + '/api/v1/chats/' + chatId + '/attendees';
          const attendeesRes = await fetch(attUrl, {
            headers: { 'X-API-KEY': API_KEY, Accept: 'application/json' },
            cache: 'no-store',
          });
          if (attendeesRes.ok) {
            const aData = await attendeesRes.json();
            const attendees = aData.items || aData || [];
            for (const a of attendees) {
              if (a.is_me) continue;
              prospectName = a.display_name || a.name || a.identifier || prospectName;
              prospectHeadline = a.headline || a.tagline || '';
              prospectCompany = a.company || a.organization || '';
              break;
            }
          }
        } catch {}

        if (prospectName === 'LinkedIn Contact') {
          prospectName = chat.name || chat.title || 'LinkedIn Contact';
        }

        // Generate AI draft
        const storedPhase = getConversationPhase(chatId);
        let state: any = messages.length <= 1 ? 'new' : 'engaged';
        if (storedPhase === 'weerstand') state = 'objection';
        if (storedPhase === 'call' || storedPhase === 'proof') state = 'qualified';

        const aiResponse = await generateResponse(config, state, messages, {
          name: prospectName,
          headline: prospectHeadline,
          company: prospectCompany,
        });

        if (aiResponse.message && !aiResponse.message.includes('[AI kon geen antwoord')) {
          const draft = addDraft({
            chat_id: chatId,
            prospect_name: prospectName,
            prospect_headline: prospectHeadline,
            message: aiResponse.message,
            reasoning: aiResponse.reasoning || '',
            phase: aiResponse.phase,
            confidence: aiResponse.confidence,
          });

          logActivity('draft_created', prospectName, {
            chat_id: chatId,
            draft_id: draft.id,
            source: 'copilot_autoscan',
            phase: aiResponse.phase,
          });

          suggestions.push({
            chat_id: chatId,
            prospect_name: prospectName,
            prospect_headline: prospectHeadline,
            interest_score: interestScore,
            interest_reasons: interestReasons,
            draft_id: draft.id,
            draft_message: aiResponse.message,
            ai_reasoning: aiResponse.reasoning,
            phase: aiResponse.phase,
            confidence: aiResponse.confidence,
          });
        }
      } catch (err) {
        console.error('[AutoScan] Error processing chat', chatId, err);
      }
    }

    suggestions.sort((a, b) => b.interest_score - a.interest_score);

    return NextResponse.json({
      total_chats_scanned: scannedCount,
      suggestions_found: suggestions.length,
      suggestions,
    });
  } catch (error) {
    console.error('[Copilot AutoScan] Error:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
