import { NextResponse } from 'next/server';
import { getActivityLog, getActivityCount, setProspectLabel, getAllLabels } from '@/lib/database';

// GET — list activity entries
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const limit = parseInt(searchParams.get('limit') || '50');
  const offset = parseInt(searchParams.get('offset') || '0');
  
  return NextResponse.json({
    activities: getActivityLog(limit, offset),
    total: getActivityCount(),
    labels: getAllLabels(),
  });
}

// POST — set a prospect label
export async function POST(request: Request) {
  try {
    const { chat_id, prospect_name, label, color } = await request.json();
    if (!chat_id || !label) {
      return NextResponse.json({ error: 'chat_id and label are required' }, { status: 400 });
    }
    setProspectLabel(chat_id, prospect_name || 'Unknown', label, color);
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
