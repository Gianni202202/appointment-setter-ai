import { NextResponse } from 'next/server';
import { getDrafts, getDraft, updateDraft, removeDraft, addDraft, getSentTodayCount, logActivity } from '@/lib/database';
import { recordDraftOutcome } from '@/lib/self-learning';
import { sendMessage } from '@/lib/unipile';
import { calculateReplyDelay, calculateTypingDelay, calculateCrossChatStagger, calculateReadDelay, isWithinWorkingHours, getNextWorkingWindow, getDailyCapacity } from '@/lib/human-timing';

// Pro plan: allow up to 60s execution
export const maxDuration = 60;

// GET — list drafts (optional ?status=pending)
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const status = searchParams.get('status') || undefined;
  const drafts = await getDrafts(status);
  const sentToday = await getSentTodayCount();
  const dailyCap = getDailyCapacity(0); // TODO: track yesterday's sends
  return NextResponse.json({
    drafts,
    counts: {
      pending: (await getDrafts('pending')).length,
      approved: (await getDrafts('approved')).length,
      sent: (await getDrafts('sent')).length,
      rejected: (await getDrafts('rejected')).length,
    },
    sent_today: sentToday,
    max_daily: dailyCap,
    within_working_hours: isWithinWorkingHours(),
  });
}

// POST — approve, reject, or edit individual drafts
export async function POST(request: Request) {
  try {
    const { action, draft_id, message, rejection_reason } = await request.json();

    if (!draft_id) {
      return NextResponse.json({ error: 'draft_id is required' }, { status: 400 });
    }

    const draft = await getDraft(draft_id);
    if (!draft) {
      return NextResponse.json({ error: 'Draft not found' }, { status: 404 });
    }

    if (action === 'approve') {
      await updateDraft(draft_id, {
        status: 'approved',
        approved_at: new Date().toISOString(),
        message: message || draft.message,
      });
      await logActivity('draft_approved', draft.prospect_name || 'Unknown', { draft_id, chat_id: draft.chat_id });
      // Self-learning: record this approval
      await recordDraftOutcome({
        chat_id: draft.chat_id,
        phase: (draft as any).phase || 'unknown',
        original_message: draft.message,
        outcome: 'approved',
      });
      return NextResponse.json({ success: true, draft: await getDraft(draft_id) });
    }

    if (action === 'reject') {
      await updateDraft(draft_id, { status: 'rejected' });
      await logActivity('draft_rejected', draft.prospect_name || 'Unknown', { draft_id, chat_id: draft.chat_id });
      // Self-learning: record rejection with optional feedback
      await recordDraftOutcome({
        chat_id: draft.chat_id,
        phase: (draft as any).phase || 'unknown',
        original_message: draft.message,
        outcome: 'rejected',
        rejection_reason: rejection_reason || undefined,
      });
      return NextResponse.json({ success: true });
    }

    if (action === 'edit') {
      if (!message) {
        return NextResponse.json({ error: 'message is required for edit action' }, { status: 400 });
      }
      // Self-learning: record edit (original → edited)
      await recordDraftOutcome({
        chat_id: draft.chat_id,
        phase: (draft as any).phase || 'unknown',
        original_message: draft.message,
        edited_message: message,
        outcome: 'edited',
      });
      await updateDraft(draft_id, { message });
      return NextResponse.json({ success: true, draft: await getDraft(draft_id) });
    }

    return NextResponse.json({ error: 'Invalid action. Use: approve, reject, or edit' }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

// PUT — batch approve and schedule sending with human-like timing
export async function PUT(request: Request) {
  try {
    const { draft_ids } = await request.json();

    if (!draft_ids || !Array.isArray(draft_ids) || draft_ids.length === 0) {
      return NextResponse.json({ error: 'draft_ids array is required' }, { status: 400 });
    }

    const sentToday = await getSentTodayCount();
    const dailyCap = getDailyCapacity(0);
    if (sentToday >= dailyCap) {
      return NextResponse.json({
        error: 'Daily send limit reached (' + dailyCap + '). Try again tomorrow.',
        sent_today: sentToday,
      }, { status: 429 });
    }

    const remaining = dailyCap - sentToday;
    const toProcess = draft_ids.slice(0, remaining);

    const results: { id: string; status: string; scheduled_at?: string; error?: string }[] = [];

    for (let i = 0; i < toProcess.length; i++) {
      const id = toProcess[i];
      const draft = await getDraft(id);
      if (!draft || (draft.status !== 'approved' && draft.status !== 'pending')) {
        results.push({ id, status: 'skipped', error: 'Not found or not approvable' });
        continue;
      }

      // Phase-aware reply delay per conversation
      const replyDelay = calculateReplyDelay({
        prospectMsgReceivedAt: draft.prospect_msg_received_at,
        phase: draft.phase,
      });

      // Typing simulation
      const typingDelay = calculateTypingDelay(draft.message.length);

      // Read receipt simulation (30-90s)
      const readDelay = calculateReadDelay();

      // Cross-chat stagger: 5-15 min gap between sends to DIFFERENT people
      const crossChatDelay = calculateCrossChatStagger(i);

      const totalDelay = Math.max(replyDelay, crossChatDelay) + readDelay + typingDelay;

      let sendAt: Date;
      if (!isWithinWorkingHours()) {
        sendAt = getNextWorkingWindow();
        sendAt = new Date(sendAt.getTime() + crossChatDelay + readDelay + typingDelay);
      } else {
        sendAt = new Date(Date.now() + totalDelay);
      }

      await updateDraft(id, {
        status: 'approved',
        approved_at: new Date().toISOString(),
        scheduled_send_at: sendAt.toISOString(),
      });

      results.push({ id, status: 'scheduled', scheduled_at: sendAt.toISOString() });
    }

    // Sends are now processed by /api/agent/cron (Vercel Cron Job)
    // No more setTimeout — Vercel serverless kills those

    return NextResponse.json({
      success: true,
      scheduled_count: results.filter(r => r.status === 'scheduled').length,
      results,
      sent_today: await getSentTodayCount(),
    });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

