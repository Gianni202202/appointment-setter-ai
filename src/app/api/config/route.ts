import { NextResponse } from 'next/server';
import { getConfig, updateConfig } from '@/lib/database';

export async function GET() {
  return NextResponse.json(getConfig());
}

export async function PUT(request: Request) {
  try {
    const body = await request.json();
    const updated = updateConfig(body);
    return NextResponse.json(updated);
  } catch (error) {
    console.error('[Config] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
