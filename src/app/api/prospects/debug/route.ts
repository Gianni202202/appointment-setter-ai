import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export async function OPTIONS() {
  return NextResponse.json({}, { headers: corsHeaders });
}

export async function GET() {
  const dsn = process.env.UNIPILE_DSN || '';
  
  // Test if we can reach Unipile
  let unipileReachable = false;
  let unipileError = '';
  
  if (dsn) {
    try {
      const res = await fetch(dsn + '/api/v1/accounts', {
        headers: { 
          'X-API-KEY': process.env.UNIPILE_API_KEY || '',
          'accept': 'application/json',
        },
      });
      unipileReachable = res.ok;
      if (!res.ok) unipileError = await res.text();
    } catch (e: any) {
      unipileError = e.message;
    }
  }
  
  return NextResponse.json({
    env: {
      UNIPILE_DSN: dsn ? dsn.substring(0, 30) + '...' : 'NOT SET',
      UNIPILE_API_KEY: process.env.UNIPILE_API_KEY ? '***set***' : 'NOT SET',
      UNIPILE_ACCOUNT_ID: process.env.UNIPILE_ACCOUNT_ID || 'NOT SET',
    },
    unipile_reachable: unipileReachable,
    unipile_error: unipileError ? unipileError.substring(0, 200) : null,
  }, { headers: corsHeaders });
}
