import { NextResponse } from 'next/server';

const DSN = process.env.UNIPILE_DSN || '';
const API_KEY = process.env.UNIPILE_API_KEY || '';

export async function GET() {
  try {
    // Check Unipile API for connected LinkedIn accounts
    // This is the source of truth — in-memory storage doesn't persist on Vercel
    if (DSN && API_KEY) {
      try {
        const response = await fetch(`https://${DSN}/api/v1/accounts`, {
          headers: {
            'X-API-KEY': API_KEY,
            'Accept': 'application/json',
          },
          cache: 'no-store',
        });

        if (response.ok) {
          const data = await response.json();
          const accounts = data.items || data || [];
          const linkedinAccount = accounts.find((a: any) =>
            a.type === 'LINKEDIN' || a.provider === 'LINKEDIN'
          );

          if (linkedinAccount) {
            return NextResponse.json({
              connected: true,
              account_id: linkedinAccount.id,
              name: linkedinAccount.name || linkedinAccount.identifier || 'LinkedIn Account',
              status: linkedinAccount.status || 'OK',
              source: 'unipile_api',
            });
          }
        }
      } catch (e) {
        console.warn('[Unipile Status] API check failed:', e);
      }
    }

    // No Unipile credentials configured or no LinkedIn account found
    return NextResponse.json({
      connected: false,
      reason: !DSN || !API_KEY ? 'no_credentials' : 'no_account',
    });
  } catch (error) {
    return NextResponse.json({ connected: false, error: String(error) });
  }
}
