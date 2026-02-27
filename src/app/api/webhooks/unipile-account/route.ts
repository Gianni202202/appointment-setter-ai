import { NextResponse } from 'next/server';
import { setLinkedInAccount } from '@/lib/database';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    console.log('[Unipile Account Webhook] Received:', JSON.stringify(body, null, 2));

    const accountId = body.account_id || body.accountId || body.id;
    const name = body.name || body.identifier || 'LinkedIn Account';

    if (accountId) {
      setLinkedInAccount({ account_id: accountId, name });
      console.log(`[Unipile Account] LinkedIn connected: ${name} (${accountId})`);
    }

    return NextResponse.json({ status: 'ok' });
  } catch (error) {
    console.error('[Unipile Account Webhook] Error:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
