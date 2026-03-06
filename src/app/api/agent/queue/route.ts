import { NextResponse } from 'next/server';
import { getDrafts, getDraft, updateDraft, removeDraft, addDraft, getSentTodayCount } from '@/lib/database';
import { sendMessage } from '@/lib/unipile';
import { calculateReplyDelay, calculateTypingDelay, calculateStaggerDelay, isWithinWorkingHours, getNextWorkingWindow } from '@/lib/human-timing';

const MAX_DAILY_SENDS = 15;

// GET — list drafts (optional ?status=pending)
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const status = searchParams.get('status') || undefined;
  const drafts = getDrafts(status);
  return NextResponse.json({
    drafts,
    counts: {
      pending: getDrafts('pending').length,
      approved: getDrafts('approved').length,
      sent: getDrafts('sent').length,
      rejected: getDrafts('rejected').length,
    },
    sent_today: getSentTodayCount(),
    max_daily: MAX_DAILY_SENDS,
    within_working_hours: isWithinWorkingHours(),
  });
}

// POST — approve, reject, or edit individual drafts
export async function POST(request: Request) {
  try {
    const { action, draft_id, message } = await request.json();

    if (!draft_id) {
      return NextResponse.json({ error: 'draft_id is required' }, { status: 400 });
    }

    const draft = getDraft(draft_id);
    if (!draft) {
      return NextResponse.json({ error: 'Draft not found' }, { status: 404 });
    }

    if (action === 'approve') {
      updateDraft(draft_id, {
        status: 'approved',
        approved_at: new Date().toISOString(),
        message: message || draft.message, // Allow editing on approve
      });
      return NextResponse.json({ success: true, draft: getDraft(draft_id) });
    }

    if (action === 'reject') {
      updateDraft(draft_id, { status: 'rejected' });
      return NextResponse.json({ success: true });
    }

    if (action === 'edit') {
      if (!message) {
        return NextResponse.json({ error: 'message is required for edit action' }, { status: 400 });
      }
      updateDraft(draft_id, { message });
      return NextResponse.json({ success: true, draft: getDraft(draft_id) });
    }

    return NextResponse.json({ error: 'Invalid action. Use: approve, reject, or edit' }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

// PUT — batch approve and schedule sending
export async function PUT(request: Request) {
  try {
    const { draft_ids } = await request.json();

    if (!draft_ids || !Array.isArray(draft_ids) || draft_ids.length === 0) {
      return NextResponse.json({ error: 'draft_ids array is required' }, { status: 400 });
    }

    const sentToday = getSentTodayCount();
    if (sentToday >= MAX_DAILY_SENDS) {
      return NextResponse.json({
        error: 'Daily send limit reached (' + MAX_DAILY_SENDS + '). Try again tomorrow.',
        sent_today: sentToday,
      }, { status: 429 });
    }

    const remaining = MAX_DAILY_SENDS - sentToday;
    const toProcess = draft_ids.slice(0, remaining);

    const results: { id: string; status: string; scheduled_at?: string; error?: string }[] = [];
    let cumulativeDelay = 0;

    for (const id of toProcess) {
      const draft = getDraft(id);
      if (!draft || (draft.status !== 'approved' && draft.status !== 'pending')) {
        results.push({ id, status: 'skipped', error: 'Not found or not approvable' });
        continue;
      }

      // Calculate human-like delay
      const replyDelay = calculateReplyDelay(draft.prospect_msg_received_at);
      const typingDelay = calculateTypingDelay(draft.message.length);
      const staggerDelay = cumulativeDelay > 0 ? calculateStaggerDelay() : 0;

      cumulativeDelay += staggerDelay;
      const totalDelay = Math.max(replyDelay, cumulativeDelay) + typingDelay;

      let sendAt: Date;
      if (!isWithinWorkingHours()) {
        sendAt = getNextWorkingWindow();
        sendAt = new Date(sendAt.getTime() + cumulativeDelay + typingDelay);
      } else {
        sendAt = new Date(Date.now() + totalDelay);
      }

      updateDraft(id, {
        status: 'approved',
        approved_at: new Date().toISOString(),
        scheduled_send_at: sendAt.toISOString(),
      });

      results.push({ id, status: 'scheduled', scheduled_at: sendAt.toISOString() });
    }

    // Start background sending process
    processScheduledSends();

    return NextResponse.json({
      success: true,
      scheduled_count: results.filter(r => r.status === 'scheduled').length,
      results,
      sent_today: getSentTodayCount(),
    });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

// Background process: send scheduled messages when their time arrives
async function processScheduledSends() {
  const approved = getDrafts('approved').filter(d => d.scheduled_send_at);

  for (const draft of approved) {
    const sendAt = new Date(draft.scheduled_send_at!).getTime();
    const delay = Math.max(0, sendAt - Date.now());

    setTimeout(async () => {
      try {
        if (!isWithinWorkingHours()) {
          // Reschedule to next working window
          const nextWindow = getNextWorkingWindow();
          updateDraft(draft.id, { scheduled_send_at: nextWindow.toISOString() });
          return;
        }

        if (getSentTodayCount() >= MAX_DAILY_SENDS) {
          updateDraft(draft.id, { status: 'pending', scheduled_send_at: undefined });
          return;
        }

        await sendMessage(draft.chat_id, draft.message);
        updateDraft(draft.id, { status: 'sent', sent_at: new Date().toISOString() });
        console.log('[Queue] Sent:', draft.id, 'to', draft.prospect_name);
      } catch (err) {
        updateDraft(draft.id, { status: 'failed' });
        console.error('[Queue] Failed to send:', draft.id, err);
      }
    }, delay);
  }
}
