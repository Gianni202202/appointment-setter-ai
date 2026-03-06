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

        // === INTEREST SCORING — realistic per scenario ===
        let interestScore = 0;
        const interestReasons: string[] = [];
        const prospectMsgs = messages.filter((m: any) => m.role === 'prospect');
        const agentMsgs = messages.filter((m: any) => m.role === 'agent');
        const turns = messages.reduce((acc: number, _m: any, i: number) => {
          if (i > 0 && messages[i-1].role !== messages[i].role) return acc + 1;
          return acc;
        }, 0);

        // ─── SCENARIO A: Connectie geaccepteerd, nog geen follow-up ───
        // (alleen agent berichten, geen prospect reply, max 2 berichten totaal)
        const isConnectionAccept = agentMsgs.length >= 1 && prospectMsgs.length === 0 && messages.length <= 2;
        if (isConnectionAccept) {
          if (daysAgo <= 3) {
            interestScore += 5;
            interestReasons.push('Connectie recent geaccepteerd — follow-up sturen!');
          } else if (daysAgo <= 7) {
            interestScore += 3;
            interestReasons.push('Connectie geaccepteerd (' + daysAgo + 'd) — nog follow-up mogelijk');
          } else if (daysAgo <= 14) {
            interestScore += 2;
            interestReasons.push('Connectie ' + daysAgo + 'd geleden — laat maar alsnog');
          } else {
            interestScore += 1;
            interestReasons.push('Connectie ' + daysAgo + 'd geleden — mogelijk te laat');
          }
        }

        // ─── SCENARIO B: Prospect heeft gereageerd, wacht op jouw antwoord ───
        if (prospectSentLast) {
          if (hoursAgo < 6) {
            interestScore += 6;
            interestReasons.push('Prospect wacht op antwoord (< 6u)');
          } else if (hoursAgo < 24) {
            interestScore += 5;
            interestReasons.push('Prospect wacht op antwoord (vandaag)');
          } else if (hoursAgo < 72) {
            interestScore += 4;
            interestReasons.push('Prospect wacht ' + daysAgo + 'd — snel opvolgen');
          } else if (hoursAgo < 168) {
            interestScore += 3;
            interestReasons.push('Prospect wacht ' + daysAgo + 'd — follow-up');
          } else {
            interestScore += 2;
            interestReasons.push('Prospect wacht ' + daysAgo + 'd — misschien te laat');
          }
        }

        // ─── SCENARIO C: Jij stuurde laatst, geen reactie ───
        if (!prospectSentLast && !isConnectionAccept && turns >= 1) {
          if (hoursAgo < 48) {
            interestScore += 1;
            interestReasons.push('Jij stuurde laatst — wacht op reactie');
          } else if (hoursAgo < 120) {
            interestScore += 2;
            interestReasons.push('Geen reactie na ' + daysAgo + 'd — follow-up?');
          } else if (hoursAgo < 336) {
            interestScore += 1;
            interestReasons.push('Geen reactie na ' + daysAgo + 'd — laatste poging?');
          } else {
            interestReasons.push('Geen reactie na ' + daysAgo + 'd — waarschijnlijk dood');
          }
        }

        // ─── SCENARIO D: Eenzijdig gesprek, alleen jij stuurt ───
        if (!isConnectionAccept && agentMsgs.length >= 2 && prospectMsgs.length === 0) {
          interestScore = Math.max(interestScore - 1, 0);
          interestReasons.push('Eenzijdig — prospect reageert niet');
        }

        // ─── BONUS PUNTEN ───
        if (prospectMsgs.some((m: any) => m.content.includes('?'))) {
          interestScore += 1;
          interestReasons.push('Prospect stelde een vraag');
        }
        if (turns >= 3) {
          interestScore += 1;
          interestReasons.push('Actief gesprek (' + turns + ' beurten)');
        }
        const avgLen = prospectMsgs.reduce((s: number, m: any) => s + m.content.length, 0) / (prospectMsgs.length || 1);
        if (avgLen > 100 && prospectMsgs.length > 0) {
          interestScore += 1;
          interestReasons.push('Uitgebreide berichten');
        }

        // ─── STATUS ───
        let status: string;
        let reason: string;
        if (interestScore >= 4) {
          status = 'interesting';
          reason = interestReasons.join(', ');
        } else if (interestScore >= 2) {
          status = 'maybe';
          reason = interestReasons.join(', ');
        } else {
          status = 'not_interesting';
          reason = interestReasons.length > 0
            ? interestReasons.join(', ')
            : 'Geen actie nodig';
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
  }, undefined, undefined, true); // legendaryContext=undefined, customInstruction=undefined, useBulkModel=true

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
      try {
        const result = await generateDraftForChat(chatId);
        return NextResponse.json({ success: !!result, draft: result });
      } catch (draftErr) {
        console.error('[generate_draft] Error for chat', chatId, ':', draftErr);
        return NextResponse.json({ success: false, error: String(draftErr) }, { status: 200 });
      }
    }

    return NextResponse.json({ error: 'Unknown action: ' + action }, { status: 400 });
  } catch (error) {
    console.error('[Copilot AutoScan] Error:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
