import { NextResponse } from 'next/server';
import { generateResponse } from '@/lib/claude';
import { getConfig, addDraft, getDrafts, getConversationPhase, logActivity } from '@/lib/database';

// Vercel function timeout — need 60s for Claude Opus calls
export const maxDuration = 60;

const DSN = process.env.UNIPILE_DSN || '';
const API_KEY = process.env.UNIPILE_API_KEY || '';
const ACCOUNT_ID = process.env.UNIPILE_ACCOUNT_ID || '';

const SKIP_KEYWORDS = ['test', 'testing', 'debug', 'spam'];

// =====================================================
// PHASE 1: Fast scan — fetch + score chats (NO Claude calls)
// Returns all chats with their assessment
// =====================================================
async function scanChats(targetCount: number, cursor: string | null) {
  const results: any[] = [];
  let nextCursor = cursor;
  let fetched = 0;

  // Get existing drafts to mark
  const existingDrafts = getDrafts();
  const draftChatIds = new Set(
    existingDrafts.filter(d => d.status === 'pending' || d.status === 'approved').map(d => d.chat_id)
  );

  // Paginate with cursor
  while (fetched < targetCount) {
    const pageSize = Math.min(50, targetCount - fetched);
    let url = 'https://' + DSN + '/api/v1/chats?account_id=' + ACCOUNT_ID + '&limit=' + pageSize;
    if (nextCursor) url += '&cursor=' + nextCursor;

    const res = await fetch(url, {
      headers: { 'X-API-KEY': API_KEY, Accept: 'application/json' },
      cache: 'no-store',
    });

    if (!res.ok) break;

    const data = await res.json();
    const chats = data.items || data || [];
    nextCursor = data.cursor || null;
    fetched += chats.length;

    if (chats.length === 0) break;

    for (const chat of chats) {
      const chatName = chat.name || chat.title || 'Unknown';
      const chatNameLower = chatName.toLowerCase();
      const chatId = chat.id;

      // Skip test chats
      if (SKIP_KEYWORDS.some(kw => chatNameLower.includes(kw))) {
        results.push({
          chat_id: chatId,
          name: chatName,
          status: 'skipped',
          reason: 'Test/debug chat',
          interest_score: 0,
          interest_reasons: [],
        });
        continue;
      }

      // Skip chats that already have drafts
      if (draftChatIds.has(chatId)) {
        results.push({
          chat_id: chatId,
          name: chatName,
          status: 'has_draft',
          reason: 'Draft al aanwezig',
          interest_score: 0,
          interest_reasons: [],
        });
        continue;
      }

      // Fetch messages for scoring
      try {
        const msgsUrl = 'https://' + DSN + '/api/v1/chats/' + chatId + '/messages?limit=10';
        const msgsRes = await fetch(msgsUrl, {
          headers: { 'X-API-KEY': API_KEY, Accept: 'application/json' },
          cache: 'no-store',
        });

        if (!msgsRes.ok) {
          results.push({ chat_id: chatId, name: chatName, status: 'error', reason: 'Berichten ophalen mislukt', interest_score: 0, interest_reasons: [] });
          continue;
        }

        const msgsData = await msgsRes.json();
        const rawMsgs = msgsData.items || msgsData || [];

        if (rawMsgs.length === 0) {
          results.push({ chat_id: chatId, name: chatName, status: 'empty', reason: 'Geen berichten', interest_score: 0, interest_reasons: [] });
          continue;
        }

        rawMsgs.sort((a: any, b: any) =>
          new Date(a.timestamp || a.date || 0).getTime() - new Date(b.timestamp || b.date || 0).getTime()
        );

        const messages = rawMsgs.map((msg: any) => ({
          role: (msg.is_sender || msg.sender?.is_me) ? 'agent' : 'prospect',
          content: msg.text || msg.body || '',
          sent_at: msg.timestamp || msg.date || '',
        })).filter((m: any) => m.content);

        if (messages.length === 0) {
          results.push({ chat_id: chatId, name: chatName, status: 'empty', reason: 'Geen tekstberichten', interest_score: 0, interest_reasons: [] });
          continue;
        }

        const lastMsg = messages[messages.length - 1];
        const prospectSentLast = lastMsg.role === 'prospect';
        const lastMsgTime = new Date(lastMsg.sent_at).getTime();
        const hoursAgo = (Date.now() - lastMsgTime) / (1000 * 60 * 60);
        const daysAgo = Math.floor(hoursAgo / 24);

        // === INTEREST SCORING ===
        let interestScore = 0;
        const interestReasons: string[] = [];
        const prospectMsgs = messages.filter((m: any) => m.role === 'prospect');
        const agentMsgs = messages.filter((m: any) => m.role === 'agent');
        const turns = messages.reduce((acc: number, _m: any, i: number) => {
          if (i > 0 && messages[i-1].role !== messages[i].role) return acc + 1;
          return acc;
        }, 0);

        // === SCENARIO 1: Connectieverzoek geaccepteerd, nog geen follow-up ===
        // Gianni stuurde connectie-note, prospect heeft nog niet gereageerd
        // Dit is HEEL interessant — prospect heeft connectie geaccepteerd!
        if (agentMsgs.length >= 1 && prospectMsgs.length === 0 && messages.length <= 2) {
          interestScore += 4;
          interestReasons.push('Connectie geaccepteerd — follow-up nodig');
        }

        // === SCENARIO 2: Prospect heeft gereageerd, wacht op antwoord ===
        if (prospectSentLast) {
          interestScore += 4;
          interestReasons.push('Prospect wacht op antwoord');
          if (hoursAgo < 24) {
            interestScore += 2;
            interestReasons.push('Recent (< 24u)');
          } else if (hoursAgo < 72) {
            interestScore += 1;
            interestReasons.push('Follow-up nodig (1-3 dagen)');
          }
        }

        // === SCENARIO 3: Gianni stuurde laatst, geen reactie ===
        // Nog steeds interessant als het een lopend gesprek is
        if (!prospectSentLast && turns >= 1) {
          interestScore += 2;
          interestReasons.push('Lopend gesprek — check status');
          if (hoursAgo > 48 && hoursAgo < 240) {
            interestScore += 1;
            interestReasons.push('Geen reactie na 2+ dagen');
          }
        }

        // === BONUS PUNTEN ===
        // Prospect stelde een vraag
        if (prospectMsgs.some((m: any) => m.content.includes('?'))) {
          interestScore += 1;
          interestReasons.push('Prospect stelde een vraag');
        }

        // Actief gesprek (meerdere beurten)
        if (turns >= 3) {
          interestScore += 1;
          interestReasons.push('Actief gesprek (' + turns + ' beurten)');
        }

        // Uitgebreide prospect berichten
        const avgLen = prospectMsgs.reduce((s: number, m: any) => s + m.content.length, 0) / (prospectMsgs.length || 1);
        if (avgLen > 100 && prospectMsgs.length > 0) {
          interestScore += 1;
          interestReasons.push('Uitgebreide berichten');
        }

        // === STATUS BEPALEN ===
        // Threshold = 2 (bijna alles is interessant behalve dode gesprekken)
        let status = 'not_interesting';
        let reason = interestReasons.length > 0
          ? interestReasons.join(', ') + ' (score: ' + interestScore + ')'
          : 'Geen signalen gevonden';
        if (interestScore >= 2) {
          status = 'interesting';
          reason = interestReasons.join(', ');
        }

        // Get prospect name from attendees
        let prospectName = chatName;
        try {
          const attUrl = 'https://' + DSN + '/api/v1/chats/' + chatId + '/attendees';
          const attRes = await fetch(attUrl, {
            headers: { 'X-API-KEY': API_KEY, Accept: 'application/json' },
            cache: 'no-store',
          });
          if (attRes.ok) {
            const aData = await attRes.json();
            const attendees = aData.items || aData || [];
            for (const a of attendees) {
              if (a.is_me) continue;
              prospectName = a.display_name || a.name || prospectName;
              break;
            }
          }
        } catch {}

        results.push({
          chat_id: chatId,
          name: prospectName,
          status,
          reason,
          interest_score: interestScore,
          interest_reasons: interestReasons,
          last_message_age: daysAgo > 0 ? daysAgo + 'd geleden' : Math.floor(hoursAgo) + 'u geleden',
          prospect_sent_last: prospectSentLast,
          message_count: messages.length,
          turns,
        });
      } catch (err) {
        results.push({ chat_id: chatId, name: chatName, status: 'error', reason: 'Fout: ' + err, interest_score: 0, interest_reasons: [] });
      }
    }

    if (!nextCursor) break;
  }

  return { results, nextCursor };
}

// =====================================================
// PHASE 2: Generate draft for a single chat
// =====================================================
async function generateDraftForChat(chatId: string) {
  const config = getConfig();

  const msgsUrl = 'https://' + DSN + '/api/v1/chats/' + chatId + '/messages?limit=10';
  const msgsRes = await fetch(msgsUrl, {
    headers: { 'X-API-KEY': API_KEY, Accept: 'application/json' },
    cache: 'no-store',
  });
  if (!msgsRes.ok) throw new Error('Failed to fetch messages');

  const msgsData = await msgsRes.json();
  const rawMsgs = msgsData.items || msgsData || [];
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

  let prospectName = 'LinkedIn Contact';
  let prospectHeadline = '';
  let prospectCompany = '';
  try {
    const attUrl = 'https://' + DSN + '/api/v1/chats/' + chatId + '/attendees';
    const attRes = await fetch(attUrl, {
      headers: { 'X-API-KEY': API_KEY, Accept: 'application/json' },
      cache: 'no-store',
    });
    if (attRes.ok) {
      const aData = await attRes.json();
      const attendees = aData.items || aData || [];
      for (const a of attendees) {
        if (a.is_me) continue;
        prospectName = a.display_name || a.name || prospectName;
        prospectHeadline = a.headline || a.tagline || '';
        prospectCompany = a.company || a.organization || '';
        break;
      }
    }
  } catch {}

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

    return {
      draft_id: draft.id,
      prospect_name: prospectName,
      message: aiResponse.message,
      reasoning: aiResponse.reasoning,
      phase: aiResponse.phase,
    };
  }
  return null;
}

// =====================================================
// POST handler
// =====================================================
export async function POST(request: Request) {
  if (!DSN || !API_KEY || !ACCOUNT_ID) {
    return NextResponse.json({ error: 'Unipile not configured' }, { status: 400 });
  }

  try {
    const body = await request.json().catch(() => ({}));
    const action = body.action || 'scan';

    if (action === 'scan') {
      const targetCount = body.target_count || 50;
      const cursor = body.cursor || null;
      const { results, nextCursor } = await scanChats(targetCount, cursor);
      const interesting = results.filter((r: any) => r.status === 'interesting');

      return NextResponse.json({
        total: results.length,
        interesting_count: interesting.length,
        results,
        next_cursor: nextCursor,
      });
    }

    if (action === 'generate_draft') {
      const chatId = body.chat_id;
      if (!chatId) return NextResponse.json({ error: 'chat_id required' }, { status: 400 });
      const result = await generateDraftForChat(chatId);
      return NextResponse.json({ success: !!result, draft: result });
    }

    return NextResponse.json({ error: 'Unknown action: ' + action }, { status: 400 });
  } catch (error) {
    console.error('[Copilot AutoScan] Error:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
