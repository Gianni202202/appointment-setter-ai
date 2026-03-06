import { NextResponse } from 'next/server';
import { recordDraftOutcome, recordProspectReply, getLearningStats } from '@/lib/self-learning';

/**
 * POST — Record a draft outcome for self-learning
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { action } = body;

    if (action === 'record_outcome') {
      const entry = await recordDraftOutcome({
        chat_id: body.chat_id,
        phase: body.phase || 'unknown',
        original_message: body.original_message,
        edited_message: body.edited_message,
        outcome: body.outcome,
        sentiment: body.sentiment,
      });
      return NextResponse.json({ success: true, entry_id: entry.id });
    }

    if (action === 'record_reply') {
      await recordProspectReply(body.chat_id, body.was_positive);
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (error) {
    console.error('[Learn API] Error:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

/**
 * GET — Get current learning insights
 */
export async function GET() {
  return NextResponse.json(await getLearningStats());
}
