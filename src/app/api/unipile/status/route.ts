import { NextResponse } from 'next/server';

const DSN = process.env.UNIPILE_DSN || '';
const API_KEY = process.env.UNIPILE_API_KEY || '';
const ACCOUNT_ID = process.env.UNIPILE_ACCOUNT_ID || '';

export async function GET() {
  try {
    if (!DSN || !API_KEY) {
      return NextResponse.json({ connected: false, reason: 'no_credentials' });
    }

    if (!ACCOUNT_ID) {
      return NextResponse.json({ connected: false, reason: 'no_account_id_configured' });
    }

    // Check ONLY the configured account — never list all accounts
    try {
      const response = await fetch(`https://${DSN}/api/v1/accounts/${ACCOUNT_ID}`, {
        headers: {
          'X-API-KEY': API_KEY,
          'Accept': 'application/json',
        },
        cache: 'no-store',
      });

      if (response.ok) {
        const account = await response.json();
        if (account && (account.type === 'LINKEDIN' || account.provider === 'LINKEDIN' || account.id)) {
          return NextResponse.json({
            connected: true,
            account_id: account.id,
            name: account.name || account.identifier || 'LinkedIn Account',
            status: account.status || 'OK',
          });
        }
      }
    } catch (e) {
      console.warn('[Unipile Status] Account check failed:', e);
    }

    return NextResponse.json({ connected: false });
  } catch (error) {
    return NextResponse.json({ connected: false, error: String(error) });
  }
}
