import { getDrafts, updateDraft, getSentTodayCount, logActivity } from '@/lib/database';
import { sendMessage } from '@/lib/unipile';
import { isWithinWorkingHours, getNextWorkingWindow, getDailyCapacity } from '@/lib/human-timing';

/**
 * Process scheduled sends INLINE (no setTimeout — Vercel kills those).
 * Only sends messages whose scheduled_send_at is in the past.
 * Called by the Vercel cron job at /api/agent/cron.
 */
export async function processScheduledSends(): Promise<{ sent: number; skipped: number; failed: number }> {
  const approved = (await getDrafts('approved')).filter(d => d.scheduled_send_at);
  let sent = 0, skipped = 0, failed = 0;

  for (const draft of approved) {
    const sendAt = new Date(draft.scheduled_send_at!).getTime();
    
    // Only send if the scheduled time has passed
    if (sendAt > Date.now()) {
      skipped++;
      continue;
    }

    // Working hours check
    if (!isWithinWorkingHours()) {
      const nextWindow = getNextWorkingWindow();
      await updateDraft(draft.id, { scheduled_send_at: nextWindow.toISOString() });
      skipped++;
      continue;
    }

    // Daily cap check
    const dailyCap = getDailyCapacity(0);
    if (await getSentTodayCount() >= dailyCap) {
      await updateDraft(draft.id, { status: 'pending', scheduled_send_at: undefined });
      skipped++;
      continue;
    }

    try {
      await sendMessage(draft.chat_id, draft.message);
      await updateDraft(draft.id, { status: 'sent', sent_at: new Date().toISOString() });
      await logActivity('message_sent', draft.prospect_name || 'Unknown', { draft_id: draft.id, chat_id: draft.chat_id });
      console.log('[Queue] ✓ Sent:', draft.id, 'to', draft.prospect_name);
      sent++;
    } catch (err) {
      await updateDraft(draft.id, { status: 'failed' });
      console.error('[Queue] ✕ Failed:', draft.id, err);
      failed++;
    }
  }

  return { sent, skipped, failed };
}
