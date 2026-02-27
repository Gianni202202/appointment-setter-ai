import { NextResponse } from 'next/server';

const DSN = process.env.UNIPILE_DSN || '';
const API_KEY = process.env.UNIPILE_API_KEY || '';
const ACCOUNT_ID = process.env.UNIPILE_ACCOUNT_ID || '';

export async function GET() {
  try {
    const result: any = {
      configured_account_id: ACCOUNT_ID || 'NOT SET',
    };

    if (!DSN || !API_KEY) {
      return NextResponse.json(result);
    }

    // 1. List ALL accounts — show FULL raw data for Gianni accounts
    try {
      const accRes = await fetch(`https://${DSN}/api/v1/accounts`, {
        headers: { 'X-API-KEY': API_KEY, 'Accept': 'application/json' },
        cache: 'no-store',
      });
      if (accRes.ok) {
        const accData = await accRes.json();
        const accounts = accData.items || accData || [];
        
        // Show ALL fields for Gianni accounts
        const gianniAccounts = accounts.filter((a: any) => 
          (a.name || '').toLowerCase().includes('gianni')
        );
        
        result.gianni_accounts_full_raw = gianniAccounts;
        result.total_accounts_in_workspace = accounts.length;
      }
    } catch (e) {
      result.accounts_error = String(e);
    }

    // 2. For each Gianni account, check LATEST chat date
    const gianniIds = [
      '-7n9l_NGTdaJ5oGB_izo7A',
      'UYXCnTMwRRW9tfmZEbXLEQ', 
      'pju_epCjRcKZf6DoB2Axew',
      'e3ce2w5zT4ySVsm6nr2S5w',
    ];

    result.gianni_accounts_comparison = [];
    
    for (const accId of gianniIds) {
      try {
        const chatsRes = await fetch(`https://${DSN}/api/v1/chats?limit=1&account_id=${accId}`, {
          headers: { 'X-API-KEY': API_KEY, 'Accept': 'application/json' },
          cache: 'no-store',
        });
        const entry: any = { account_id: accId, is_configured: accId === ACCOUNT_ID };
        
        if (chatsRes.ok) {
          const chatsData = await chatsRes.json();
          const items = chatsData.items || chatsData || [];
          entry.total_chats = items.length > 0 ? 'at least 1' : '0';
          if (items.length > 0) {
            entry.most_recent_chat = {
              id: items[0].id,
              name: items[0].name,
              last_message_at: items[0].last_message_at,
              updated_at: items[0].updated_at,
              created_at: items[0].created_at,
            };
          }
        } else {
          entry.error = `HTTP ${chatsRes.status}`;
        }
        
        // Also get account details
        try {
          const accDetailRes = await fetch(`https://${DSN}/api/v1/accounts/${accId}`, {
            headers: { 'X-API-KEY': API_KEY, 'Accept': 'application/json' },
            cache: 'no-store',
          });
          if (accDetailRes.ok) {
            const detail = await accDetailRes.json();
            entry.account_status = detail.status;
            entry.account_created = detail.created_at;
            entry.connection_params = detail.connection_params;
            entry.sources = detail.sources;
          }
        } catch {}
        
        result.gianni_accounts_comparison.push(entry);
      } catch (e) {
        result.gianni_accounts_comparison.push({ 
          account_id: accId, error: String(e) 
        });
      }
    }

    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
