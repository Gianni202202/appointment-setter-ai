import { generateResponse } from '@/lib/claude';
import { getConfigAsync, addDraft, getConversationPhaseAsync, logActivity } from '@/lib/database';

const DSN = process.env.UNIPILE_DSN || '';
const API_KEY = process.env.UNIPILE_API_KEY || '';

export async function generateDraftForChat(chatId: string, customInstruction?: string) {
  const config = await getConfigAsync();

  const msgsUrl = 'https://' + DSN + '/api/v1/chats/' + chatId + '/messages?limit=10';
  const msgsRes = await fetch(msgsUrl, {
    headers: { 'X-API-KEY': API_KEY, Accept: 'application/json' },
    cache: 'no-store',
  });
  if (!msgsRes.ok) throw new Error('Failed to fetch messages for chat ' + chatId);

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

  const storedPhase = await getConversationPhaseAsync(chatId);
  let state: any = messages.length <= 1 ? 'new' : 'engaged';
  if (storedPhase === 'weerstand') state = 'objection';
  if (storedPhase === 'call' || storedPhase === 'proof') state = 'qualified';

  const aiResponse = await generateResponse(config, state, messages, {
    name: prospectName,
    headline: prospectHeadline,
    company: prospectCompany,
  }, undefined, customInstruction, true);

  if (aiResponse.message && !aiResponse.message.includes('[AI kon geen antwoord')) {
    const draft = await addDraft({
      chat_id: chatId,
      prospect_name: prospectName,
      prospect_headline: prospectHeadline,
      message: aiResponse.message,
      reasoning: aiResponse.reasoning || '',
      phase: aiResponse.phase,
      confidence: aiResponse.confidence,
    });

    await logActivity('draft_created', prospectName, {
      chat_id: chatId,
      draft_id: draft.id,
      source: 'agent_jarvis',
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
