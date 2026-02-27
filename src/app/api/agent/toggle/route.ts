import { NextResponse } from 'next/server';
import { isAgentEnabled, setAgentEnabled } from '@/lib/database';

export async function GET() {
  return NextResponse.json({ enabled: isAgentEnabled() });
}

export async function PUT(request: Request) {
  try {
    const { enabled } = await request.json();
    setAgentEnabled(!!enabled);
    return NextResponse.json({ enabled: isAgentEnabled() });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
