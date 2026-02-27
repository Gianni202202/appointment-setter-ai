import { NextResponse } from 'next/server';
import { generateResponse } from '@/lib/claude';
import { getConfig } from '@/lib/database';

const DSN = process.env.UNIPILE_DSN || '';
const API_KEY = process.env.UNIPILE_API_KEY || '';
const ACCOUNT_ID = process.env.UNIPILE_ACCOUNT_ID || '';
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY || '';

/**
 * AI Copilot — Generate a response draft WITHOUT sending.
 * Fetches the conversation directly from Unipile so it works
 * without an in-memory database.
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

      // Sort by timestamp (oldest first)
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
      // Return a smart mock response based on the conversation
      const lastProspectMsg = messages.filter(m => m.role === 'prospect').pop();
      return NextResponse.json({
        draft: {
          message: lastProspectMsg
            ? `Thanks for your message, ${prospectName.split(' ')[0]}. [AI KEY NOT CONFIGURED — set ANTHROPIC_API_KEY in Vercel to get real AI responses]`
            : `Hey ${prospectName.split(' ')[0]}, I noticed your profile and wanted to connect. [AI KEY NOT CONFIGURED — set ANTHROPIC_API_KEY in Vercel]`,
          reasoning: 'ANTHROPIC_API_KEY is not set. Add it to your Vercel environment variables to enable real AI-generated responses.',
          sentiment: 'neutral',
          needs_human: false,
          should_respond: true,
        },
        prospect: { name: prospectName, headline: prospectHeadline, company: prospectCompany },
        message_count: messages.length,
        api_key_configured: false,
      });
    }

    // 4. Determine conversation state from messages
    let state: any = 'new';
    if (messages.length === 0) {
      state = 'new';
    } else if (messages.length <= 2) {
      state = 'engaged';
    } else {
      state = 'engaged'; // Let AI figure out the nuance
    }

    // 5. Generate AI response via Claude
    const config = getConfig();
    const aiResponse = await generateResponse(
      config,
      state,
      messages.map(m => ({
        ...m,
        conversation_id: chat_id,
        is_read: true,
      })),
      { name: prospectName, headline: prospectHeadline, company: prospectCompany }
    );

    return NextResponse.json({
      draft: {
        message: aiResponse.message,
        reasoning: aiResponse.reasoning,
        sentiment: aiResponse.sentiment,
        needs_human: aiResponse.needs_human,
        should_respond: aiResponse.should_respond,
        has_objection: aiResponse.has_objection,
        objection_type: aiResponse.objection_type,
      },
      prospect: { name: prospectName, headline: prospectHeadline, company: prospectCompany },
      message_count: messages.length,
      state,
      api_key_configured: true,
    });
  } catch (error) {
    console.error('[AI Generate] Error:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
