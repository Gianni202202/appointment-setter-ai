import { NextResponse } from 'next/server';
import { generateResponse, LegendaryContext } from '@/lib/claude';
import { getConfigAsync, getConversationMemoryAsync, updateConversationMemory, addPreviousOpener, getPreviousOpenersAsync, getConversationPhaseAsync, setConversationPhase } from '@/lib/database';

// Pro plan: allow up to 60s execution
export const maxDuration = 60;

const DSN = process.env.UNIPILE_DSN || '';
const API_KEY = process.env.UNIPILE_API_KEY || '';
const ACCOUNT_ID = process.env.UNIPILE_ACCOUNT_ID || '';
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY || '';

/**
 * AI Copilot — Generate a response draft WITHOUT sending.
 * Now with LEGENDARY features: style mirroring, warmth curve, memory, phase detection.
 */
export async function POST(request: Request) {
  try {
    const { chat_id } = await request.json();

    if (!chat_id) {
      return NextResponse.json({ error: 'chat_id is required' }, { status: 400 });
    }

    if (!DSN || !API_KEY || !ACCOUNT_ID) {
      return NextResponse.json({ error: 'Unipile not configured' }, { status: 400 });
    }

    // 1. Fetch the chat to get participant info + verify ownership
    const chatRes = await fetch(`https://${DSN}/api/v1/chats/${chat_id}`, {
      headers: { 'X-API-KEY': API_KEY, 'Accept': 'application/json' },
      cache: 'no-store',
    });

    if (!chatRes.ok) {
      return NextResponse.json({ error: 'Chat not found' }, { status: 404 });
    }

    const chatData = await chatRes.json();

    // SECURITY: Verify ownership
    if (chatData.account_id && chatData.account_id !== ACCOUNT_ID) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    // Extract prospect info from chat attendees
    let prospectName = 'Unknown';
    let prospectHeadline = '';
    let prospectCompany = '';

    if (chatData.attendees && Array.isArray(chatData.attendees)) {
      for (const a of chatData.attendees) {
        if (a.is_me) continue;
        prospectName = a.display_name || a.name || a.identifier || prospectName;
        prospectHeadline = a.headline || prospectHeadline;
        prospectCompany = a.company || prospectCompany;
        break;
      }
    }
    if (prospectName === 'Unknown') {
      prospectName = chatData.name || chatData.title || 'LinkedIn Contact';
    }

    // 2. Fetch messages from Unipile
    const msgsRes = await fetch(`https://${DSN}/api/v1/chats/${chat_id}/messages?limit=30`, {
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
      }));
    }

    // 3. Check if ANTHROPIC_API_KEY is set
    if (!ANTHROPIC_KEY) {
      const lastProspectMsg = messages.filter(m => m.role === 'prospect').pop();
      return NextResponse.json({
        draft: {
          message: lastProspectMsg
            ? `Thanks for your message, ${prospectName.split(' ')[0]}. [AI KEY NOT CONFIGURED]`
            : `Hey ${prospectName.split(' ')[0]}, [AI KEY NOT CONFIGURED]`,
          reasoning: 'ANTHROPIC_API_KEY is not set.',
          sentiment: 'neutral',
          needs_human: false,
          should_respond: true,
        },
        prospect: { name: prospectName, headline: prospectHeadline, company: prospectCompany },
        message_count: messages.length,
        api_key_configured: false,
      });
    }

    // 4. Determine conversation state
    let state: any = 'new';
    const storedPhase = await getConversationPhaseAsync(chat_id);
    if (messages.length === 0) {
      state = 'new';
    } else if (storedPhase === 'weerstand') {
      state = 'objection';
    } else if (storedPhase === 'call' || storedPhase === 'proof') {
      state = 'qualified';
    } else if (messages.length <= 2) {
      state = 'engaged';
    } else {
      state = 'engaged';
    }

    // 5. Build legendary context
    const memory = await getConversationMemoryAsync(chat_id);
    const previousOpeners = await getPreviousOpenersAsync(chat_id);

    // Calculate CET hour
    const now = new Date();
    const cetOffset = 1; // CET = UTC+1 (adjust for CEST if needed)
    const cetHour = (now.getUTCHours() + cetOffset) % 24;

    const legendaryContext: LegendaryContext = {
      messageCount: messages.length,
      previousOpeners,
      conversationMemory: memory?.facts || null,
      detectedPhase: storedPhase || null,
      currentHourCET: cetHour,
    };

    // 6. Generate AI response via Claude (with legendary context)
    const config = await getConfigAsync();
    const aiResponse = await generateResponse(
      config,
      state,
      messages.map(m => ({
        ...m,
        conversation_id: chat_id,
        is_read: true,
      })),
      { name: prospectName, headline: prospectHeadline, company: prospectCompany },
      legendaryContext
    );

    // 7. Post-generation: store phase and memory
    if (aiResponse.phase) {
      setConversationPhase(chat_id, aiResponse.phase);
    }

    // Store opener for variance tracking
    if (aiResponse.message) {
      const opener = aiResponse.message.split('\n')[0].substring(0, 60);
      addPreviousOpener(chat_id, opener);
    }

    // Extract and store conversation memory facts from AI response
    // The AI returns extracted_facts in its JSON — we parse it from the raw response
    try {
      const rawResponse = aiResponse as any;
      if (rawResponse.extracted_facts) {
        const facts = rawResponse.extracted_facts;
        const updates: any = {};
        if (facts.team_size) updates.team_size = facts.team_size;
        if (facts.role) updates.role = facts.role;
        if (facts.company) updates.company = facts.company;
        if (facts.language_preference) updates.language_preference = facts.language_preference;
        if (facts.tools_mentioned?.length) updates.tools_mentioned = facts.tools_mentioned;
        if (facts.pain_points?.length) updates.pain_points = facts.pain_points;
        if (facts.interests?.length) updates.interests = facts.interests;
        if (Object.keys(updates).length > 0) {
          updateConversationMemory(chat_id, updates);
        }
      }
    } catch {}

    return NextResponse.json({
      draft: {
        message: aiResponse.message,
        reasoning: aiResponse.reasoning,
        sentiment: aiResponse.sentiment,
        needs_human: aiResponse.needs_human,
        should_respond: aiResponse.should_respond,
        has_objection: aiResponse.has_objection,
        objection_type: aiResponse.objection_type,
        phase: aiResponse.phase,
        mini_ja_seeking: aiResponse.mini_ja_seeking,
        confidence: aiResponse.confidence,
      },
      prospect: { name: prospectName, headline: prospectHeadline, company: prospectCompany },
      message_count: messages.length,
      state,
      stored_phase: storedPhase,
      api_key_configured: true,
    });
  } catch (error) {
    console.error('[AI Generate] Error:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
