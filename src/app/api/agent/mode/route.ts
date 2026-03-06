import { NextResponse } from 'next/server';
import { getAgentMode, getAgentModeAsync, setAgentMode } from '@/lib/database';
import type { AgentMode } from '@/types';

export async function GET() {
  return NextResponse.json({ mode: await getAgentModeAsync() });
}

export async function PUT(request: Request) {
  try {
    const { mode } = await request.json();
    const validModes: AgentMode[] = ['auto', 'copilot', 'off'];
    if (!validModes.includes(mode)) {
      return NextResponse.json({ error: 'Invalid mode. Use: auto, copilot, or off' }, { status: 400 });
    }
    setAgentMode(mode);
    return NextResponse.json({ mode: getAgentMode() });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
