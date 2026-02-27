import { NextResponse } from 'next/server';

const DSN = process.env.UNIPILE_DSN || '';
const API_KEY = process.env.UNIPILE_API_KEY || '';
const ACCOUNT_ID = process.env.UNIPILE_ACCOUNT_ID || '';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const chatId = body.chat_id;
    const text = body.content || body.text;

    if (!chatId || !text) {
      return NextResponse.json({ error: 'chat_id and content are required' }, { status: 400 });
    }

    if (!DSN || !API_KEY || !ACCOUNT_ID) {
      return NextResponse.json({ error: 'Unipile not configured' }, { status: 400 });
    }

    // SECURITY: Verify this chat belongs to our account before sending
    const chatRes = await fetch(`https://${DSN}/api/v1/chats/${chatId}`, {
      headers: { 'X-API-KEY': API_KEY, 'Accept': 'application/json' },
      cache: 'no-store',
    });

    if (chatRes.ok) {
      const chatData = await chatRes.json();
      if (chatData.account_id && chatData.account_id !== ACCOUNT_ID) {
        return NextResponse.json({ error: 'Access denied — chat does not belong to your account' }, { status: 403 });
      }
    }

    // Send message via Unipile
    const sendRes = await fetch(`https://${DSN}/api/v1/chats/${chatId}/messages`, {
      method: 'POST',
      headers: {
        'X-API-KEY': API_KEY,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({ text }),
    });

    if (!sendRes.ok) {
      const err = await sendRes.text();
      return NextResponse.json({ error: 'Failed to send', details: err }, { status: 500 });
    }

    const result = await sendRes.json();
    return NextResponse.json({ success: true, message: result });
  } catch (error) {
    console.error('[Messages] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
