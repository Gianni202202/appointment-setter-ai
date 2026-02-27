import { NextResponse } from 'next/server';

const DSN = process.env.UNIPILE_DSN || '';
const API_KEY = process.env.UNIPILE_API_KEY || '';

export async function POST(request: Request) {
  try {
    if (!DSN || !API_KEY) {
      return NextResponse.json({ error: 'Unipile not configured. Set UNIPILE_DSN and UNIPILE_API_KEY.' }, { status: 400 });
    }

    const { redirect_url } = await request.json();
    const baseUrl = redirect_url || process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

    // Generate hosted auth link via Unipile API
    const response = await fetch(`https://${DSN}/api/v1/hosted/accounts/link`, {
      method: 'POST',
      headers: {
        'X-API-KEY': API_KEY,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({
        type: 'create',
        providers: ['LINKEDIN'],
        api_url: `https://${DSN}`,
        notify_url: `${baseUrl}/api/webhooks/unipile-account`,
        name: 'appointment-setter-user',
        success_redirect_url: `${baseUrl}/settings?connected=true`,
        failure_redirect_url: `${baseUrl}/settings?connected=false`,
        expiresOn: new Date(Date.now() + 3600000).toISOString(), // 1 hour
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error('[Unipile Connect] Error:', error);
      return NextResponse.json({ error: 'Failed to generate auth link', details: error }, { status: 500 });
    }

    const data = await response.json();
    return NextResponse.json({ url: data.url || data.link });
  } catch (error) {
    console.error('[Unipile Connect] Error:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
