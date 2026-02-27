import { NextResponse } from 'next/server';
import { getLinkedInAccount } from '@/lib/database';

const DSN = process.env.UNIPILE_DSN || '';
const API_KEY = process.env.UNIPILE_API_KEY || '';

export async function GET() {
  try {
    // First check local storage
    const localAccount = getLinkedInAccount();

    // Then try Unipile API for live status
    if (DSN && API_KEY) {
      try {
        const response = await fetch(`https://${DSN}/api/v1/accounts`, {
          headers: {
            'X-API-KEY': API_KEY,
            'Accept': 'application/json',
          },
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

    // Fall back to local storage
    if (localAccount) {
      return NextResponse.json({
        connected: true,
        account_id: localAccount.account_id,
        name: localAccount.name,
        connected_at: localAccount.connected_at,
        source: 'local',
      });
    }

    return NextResponse.json({ connected: false });
  } catch (error) {
    return NextResponse.json({ connected: false, error: String(error) });
  }
}
