import { NextResponse } from 'next/server';

const DSN = process.env.UNIPILE_DSN || '';
const API_KEY = process.env.UNIPILE_API_KEY || '';
const ACCOUNT_ID = process.env.UNIPILE_ACCOUNT_ID || '';

/**
 * DEBUG endpoint — shows raw Unipile API responses to verify
 * account filtering is working correctly.
 * 
 * GET /api/debug — shows config + first 3 chats raw data
 */
export async function GET() {
  try {
    const result: any = {
      config: {
        dsn_set: !!DSN,
        api_key_set: !!API_KEY,
        account_id: ACCOUNT_ID || 'NOT SET',
        anthropic_key_set: !!process.env.ANTHROPIC_API_KEY,
      },
      account_check: null,
      chats_sample: null,
      account_ids_in_chats: null,
    };

    // 1. Check the configured account
    if (DSN && API_KEY && ACCOUNT_ID) {
      try {
        const accRes = await fetch(`https://${DSN}/api/v1/accounts/${ACCOUNT_ID}`, {
          headers: { 'X-API-KEY': API_KEY, 'Accept': 'application/json' },
          cache: 'no-store',
        });
        if (accRes.ok) {
          const acc = await accRes.json();
          result.account_check = {
            status: 'found',
            id: acc.id,
            name: acc.name || acc.identifier,
            type: acc.type,
            provider: acc.provider,
            connection_status: acc.status,
          };
        } else {
          result.account_check = { status: 'not_found', http_status: accRes.status };
        }
      } catch (e) {
        result.account_check = { status: 'error', error: String(e) };
      }

      // 2. Fetch first 5 chats WITH account_id filter
      try {
        const chatsRes = await fetch(`https://${DSN}/api/v1/chats?limit=5&account_id=${ACCOUNT_ID}`, {
          headers: { 'X-API-KEY': API_KEY, 'Accept': 'application/json' },
          cache: 'no-store',
        });
        if (chatsRes.ok) {
          const chatsData = await chatsRes.json();
          const items = chatsData.items || chatsData || [];

          // Show raw first 3 chats
          result.chats_sample = items.slice(0, 3).map((chat: any) => ({
            id: chat.id,
            account_id: chat.account_id || 'NOT IN RESPONSE',
            name: chat.name,
            title: chat.title,
            attendees: chat.attendees?.map((a: any) => ({
              display_name: a.display_name,
              name: a.name,
              identifier: a.identifier,
              is_me: a.is_me,
              headline: a.headline,
            })),
            last_message_at: chat.last_message_at,
            messages_count: chat.messages_count,
            last_message: chat.last_message ? {
              text: chat.last_message.text?.substring(0, 50),
              sender_name: chat.last_message.sender_name,
            } : null,
          }));

          // Check all account_ids
          const accountIds = items.map((c: any) => c.account_id).filter(Boolean);
          const uniqueIds = [...new Set(accountIds)];
          result.account_ids_in_chats = {
            total_chats_returned: items.length,
            total_in_response: chatsData.total || 'not provided',
            unique_account_ids: uniqueIds,
            all_match_configured: uniqueIds.every((id: string) => id === ACCOUNT_ID),
            any_foreign: uniqueIds.filter((id: string) => id !== ACCOUNT_ID),
          };
        }
      } catch (e) {
        result.chats_sample = { error: String(e) };
      }

      // 3. Also fetch WITHOUT account_id to compare count
      try {
        const allRes = await fetch(`https://${DSN}/api/v1/chats?limit=1`, {
          headers: { 'X-API-KEY': API_KEY, 'Accept': 'application/json' },
          cache: 'no-store',
        });
        if (allRes.ok) {
          const allData = await allRes.json();
          result.unfiltered_total = allData.total || (allData.items || allData || []).length;
          result.comparison = {
            note: 'If unfiltered_total >> filtered total, the filter IS working',
          };
        }
      } catch (e) {
        // ignore
      }
    }

    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
