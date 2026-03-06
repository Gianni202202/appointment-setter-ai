import { NextRequest, NextResponse } from 'next/server';
import { getProspects, updateProspect } from '@/lib/database';
import Redis from 'ioredis';

export const dynamic = 'force-dynamic';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function getRedis() {
  return new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
}

export async function OPTIONS() {
  return NextResponse.json({}, { headers: corsHeaders });
}

export async function GET() {
  let redis;
  try {
    redis = getRedis();
    const instruction = await redis.get('prospect:saved_instruction') || '';
    return NextResponse.json({ instruction }, { headers: corsHeaders });
  } catch {
    return NextResponse.json({ instruction: '' }, { headers: corsHeaders });
  } finally {
    if (redis) redis.disconnect();
  }
}

export async function POST(request: NextRequest) {
  let redis;
  try {
    const { instruction } = await request.json();
    redis = getRedis();
    await redis.set('prospect:saved_instruction', instruction || '');
    return NextResponse.json({ success: true, instruction: instruction || '' }, { headers: corsHeaders });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500, headers: corsHeaders });
  } finally {
    if (redis) redis.disconnect();
  }
}
