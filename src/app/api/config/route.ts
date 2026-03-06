import { NextResponse } from 'next/server';
import { getConfig, getConfigAsync, updateConfig } from '@/lib/database';

export async function GET() {
  return NextResponse.json(await getConfigAsync());
}

export async function PUT(request: Request) {
  try {
    const body = await request.json();
    const updated = await updateConfig(body);
    return NextResponse.json(updated);
  } catch (error) {
    console.error('[Config] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
