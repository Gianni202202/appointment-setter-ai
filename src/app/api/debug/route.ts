import { NextResponse } from 'next/server';

const DSN = process.env.UNIPILE_DSN || '';
const API_KEY = process.env.UNIPILE_API_KEY || '';
const ACCOUNT_ID = process.env.UNIPILE_ACCOUNT_ID || '';

export async function GET() {
  try {
    const result: any = {
      config: {
        dsn_set: !!DSN,
        api_key_set: !!API_KEY,
        configured_account_id: ACCOUNT_ID || 'NOT SET',
        anthropic_key_set: !!process.env.ANTHROPIC_API_KEY,
      },
    };

    if (!DSN || !API_KEY) {
      return NextResponse.json(result);
    }

    // 1. List ALL accounts in the workspace
    try {
      const accRes = await fetch(`https://${DSN}/api/v1/accounts`, {
        headers: { 'X-API-KEY': API_KEY, 'Accept': 'application/json' },
        cache: 'no-store',
      });
      if (accRes.ok) {
        const accData = await accRes.json();
        const accounts = accData.items || accData || [];
        result.all_accounts = accounts.map((a: any) => ({
          id: a.id,
          name: a.name || a.identifier,
          type: a.type,
          provider: a.provider,
          status: a.status,
          is_configured: a.id === ACCOUNT_ID,
        }));
        result.total_accounts = accounts.length;
      }
    } catch (e) {
      result.all_accounts_error = String(e);
    }

    // 2. Fetch 3 chats WITH account_id filter and show FULL raw data
    try {
      const url = `https://${DSN}/api/v1/chats?limit=3&account_id=${ACCOUNT_ID}`;
      const chatsRes = await fetch(url, {
        headers: { 'X-API-KEY': API_KEY, 'Accept': 'application/json' },
        cache: 'no-store',
      });
      if (chatsRes.ok) {
        const chatsData = await chatsRes.json();
        const items = chatsData.items || chatsData || [];
        result.filtered_chats = {
          url_used: url,
          total_returned: items.length,
          cursor: chatsData.cursor || null,
          sample: items.slice(0, 3).map((c: any) => ({
            id: c.id,
            account_id: c.account_id,
            name: c.name,
            provider: c.provider,
            type: c.type,
            attendees_raw: c.attendees,
            last_message_at: c.last_message_at,
          })),
        };
      }
    } catch (e) {
      result.filtered_chats_error = String(e);
    }

    // 3. Fetch 3 chats WITHOUT account_id filter 
    try {
      const url = `https://${DSN}/api/v1/chats?limit=3`;
      const chatsRes = await fetch(url, {
        headers: { 'X-API-KEY': API_KEY, 'Accept': 'application/json' },
        cache: 'no-store',
      });
      if (chatsRes.ok) {
        const chatsData = await chatsRes.json();
        const items = chatsData.items || chatsData || [];
        result.unfiltered_chats = {
          url_used: url,
          total_returned: items.length,
          sample: items.slice(0, 3).map((c: any) => ({
            id: c.id,
            account_id: c.account_id,
            name: c.name,
          })),
        };
      }
    } catch (e) {
      result.unfiltered_chats_error = String(e);
    }

    // 4. Now try to fetch chats from the OTHER account the user mentioned
    const OTHER_ACCOUNT = '-7n9l_NGTdaJ5oGB_izo7A';
    try {
      const url = `https://${DSN}/api/v1/chats?limit=3&account_id=${OTHER_ACCOUNT}`;
      const chatsRes = await fetch(url, {
        headers: { 'X-API-KEY': API_KEY, 'Accept': 'application/json' },
        cache: 'no-store',
      });
      if (chatsRes.ok) {
        const chatsData = await chatsRes.json();
        const items = chatsData.items || chatsData || [];
        result.other_account_chats = {
          account_id_used: OTHER_ACCOUNT,
          total_returned: items.length,
          sample: items.slice(0, 3).map((c: any) => ({
            id: c.id,
            account_id: c.account_id,
            name: c.name,
          })),
        };
      }
    } catch (e) {
      result.other_account_chats_error = String(e);
    }

    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
