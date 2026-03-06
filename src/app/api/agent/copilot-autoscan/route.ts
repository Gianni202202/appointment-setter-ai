import { NextResponse } from 'next/server';
import { getDrafts, logActivity, saveScanResults, getScanResults, getLastScanTime, updateScanResult, getRejectedChats } from '@/lib/database';
import { generateDraftForChat } from '@/lib/draft-generator';

// Vercel function timeout — need 60s for Gemini calls
export const maxDuration = 60;

const DSN = process.env.UNIPILE_DSN || '';
const API_KEY = process.env.UNIPILE_API_KEY || '';
const ACCOUNT_ID = process.env.UNIPILE_ACCOUNT_ID || '';

const SKIP_KEYWORDS = ['test', 'testing', 'debug', 'spam'];

// =====================================================
// PHASE 1: Fast scan — fetch + score chats (NO AI calls)
// Returns all chats with their assessment
// =====================================================
async function scanChats(targetCount: number, cursor: string | null) {
  const results: any[] = [];
  let nextCursor = cursor;
  let fetched = 0;

  // Get rejected chats to skip
  const rejectedChats = await getRejectedChats();
  const rejectedSet = new Set(rejectedChats);

  // Get existing drafts to mark
  const existingDrafts = await getDrafts();
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
      // Try to get name from attendees (LinkedIn DMs often have empty name/title)
      let chatName = chat.name || chat.title || '';
      if (!chatName || chatName === 'Unknown') {
        const attendees = chat.attendees || [];
        for (const att of attendees) {
          if (att.is_me) continue;
          chatName = att.display_name || att.name || att.first_name || '';
          if (chatName) break;
        }
      }
      if (!chatName) chatName = 'Unknown';
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

      // Skip rejected chats
      if (rejectedSet.has(chatId)) {
        results.push({ chat_id: chatId, name: chatName, status: 'rejected', reason: 'Eerder afgewezen', interest_score: 0, interest_reasons: [] });
        continue;
      }

      // Skip chats that already have drafts — use draft's stored prospect name
      if (draftChatIds.has(chatId)) {
        const draftForChat = existingDrafts.find(d => d.chat_id === chatId);
        const draftName = draftForChat?.prospect_name && draftForChat.prospect_name !== 'LinkedIn Contact'
          ? draftForChat.prospect_name : chatName;
        results.push({
          chat_id: chatId,
          name: draftName,
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

        // If name is still Unknown, try to extract from message sender info
        if (chatName === 'Unknown') {
          for (const msg of rawMsgs) {
            if (msg.is_sender || msg.sender?.is_me) continue;
            const senderName = msg.sender?.display_name || msg.sender?.name || '';
            if (senderName && senderName !== 'Unknown') {
              chatName = senderName;
              break;
            }
          }
        }

        // Last resort: fetch attendees API (only if still Unknown to minimize API calls)
        if (chatName === 'Unknown') {
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
                chatName = a.display_name || a.name || chatName;
                break;
              }
            }
          } catch {}
        }

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

        // ─── FILTER: Sales pitches (people selling TO you) ───
        const allProspectText = prospectMsgs.map((m: any) => m.content.toLowerCase()).join(' ');
        const SALES_PATTERNS = [
          'book a call', 'schedule a meeting', 'raising capital', 'schedule a demo',
          'interested in our', 'reach out to', 'reaching out to', 'i\'d love to connect',
          'partnership opportunity', 'investment opportunity', 'our platform',
          'we help companies', 'we\'ve worked with', 'we specialize', 'our services',
          'bel inplannen', 'demo inplannen', 'onze diensten', 'wij helpen',
        ];
        const isSalesPitch = SALES_PATTERNS.some(p => allProspectText.includes(p)) && turns <= 2;
        if (isSalesPitch) {
          interestScore = Math.max(interestScore - 3, 1);
          interestReasons.push('⚠️ Prospect probeert iets te verkopen');
        }

        // ─── FILTER: Closed/finished conversations ───
        const lastMsgText = lastMsg.content.toLowerCase().trim();
        const CLOSED_PATTERNS = [
          'bedankt', 'dank je', 'thanks', 'thank you', 'top, dank', 'fijn bedankt',
          'succes', 'tot zover', 'geen interesse', 'not interested', 'no thanks',
          'nee bedankt', 'niet nodig', 'geen behoefte',
        ];
        const isClosedConvo = CLOSED_PATTERNS.some(p => lastMsgText.startsWith(p)) && lastMsg.role === 'prospect';
        if (isClosedConvo) {
          interestScore = Math.max(interestScore - 3, 0);
          interestReasons.push('⚠️ Gesprek lijkt afgesloten');
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

// generateDraftForChat is now imported from @/lib/draft-generator

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

    if (action === 'get_cached') {
      const cached = await getScanResults();
      const lastRun = await getLastScanTime();
      return NextResponse.json({
        total: cached.length,
        interesting_count: cached.filter((r: any) => r.status === 'interesting').length,
        results: cached,
        last_scan: lastRun,
        from_cache: true,
      });
    }

    if (action === 'generate_draft') {
      const chatId = body.chat_id;
      const customInstruction = body.custom_instruction || undefined;
      if (!chatId) return NextResponse.json({ error: 'chat_id required' }, { status: 400 });
      try {
        const result = await generateDraftForChat(chatId, customInstruction);
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
