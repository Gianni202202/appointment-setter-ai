import { NextResponse } from 'next/server';
import { getLinkedInAccount } from '@/lib/database';

export async function GET() {
  try {
    // Only check local app storage — this is set when user
    // explicitly connects through our auth flow or webhook
    const localAccount = getLinkedInAccount();

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
