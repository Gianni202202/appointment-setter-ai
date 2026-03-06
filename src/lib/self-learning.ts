/**
 * Self-Learning Module
 * 
 * HOW IT WORKS:
 * 1. Every draft the AI generates is tracked with its outcome (approved/rejected/edited)
 * 2. Patterns are extracted: which phases, openers, styles, and tones get approved vs rejected
 * 3. This learning data is fed back into Claude's prompt as "historical performance data"
 * 4. The AI uses this data to improve its responses over time
 * 
 * DATA TRACKED PER DRAFT:
 * - Phase (cold/warm/proof/call/etc)
 * - Opening style (question, statement, reference, emoji usage)
 * - Message length
 * - Sentiment/tone
 * - Whether it was approved, rejected, or edited by the human
 * - If edited: what was changed (for learning what the human prefers)
 * 
 * LEARNING OUTPUTS:
 * - Best-performing opener styles per phase
 * - Optimal message length ranges per phase
 * - Approved vs rejected patterns
 * - Human-edited corrections (most valuable signal)
 */

import Redis from 'ioredis';

// Outcome types
type DraftOutcome = 'approved' | 'rejected' | 'edited' | 'sent' | 'meeting_booked';

interface LearningEntry {
  id: string;
  chat_id: string;
  created_at: string;
  phase: string;
  message_length: number;
  opener_style: string; // 'question' | 'statement' | 'reference' | 'greeting' | 'emoji'
  tone: string; // 'casual' | 'professional' | 'warm' | 'direct'
  sentiment: string;
  outcome: DraftOutcome;
  original_message: string;
  edited_message?: string; // If user edited, store the corrected version
  rejection_reason?: string; // Why the user rejected this draft
  prospect_replied?: boolean; // Did the prospect respond after this message?
  reply_was_positive?: boolean;
  mini_ja_achieved?: boolean;
}

interface LearningInsights {
  total_drafts: number;
  approval_rate: number;
  edit_rate: number;
  rejection_rate: number;
  best_phases: { phase: string; approval_rate: number; count: number }[];
  best_opener_styles: { style: string; approval_rate: number; count: number }[];
  optimal_length_range: { min: number; max: number };
  common_edits: string[]; // Summary of common human corrections
  human_preferred_patterns: string[]; // Derived from edits
  reply_rate: number; // % of sent messages that got a reply
  top_rejection_reasons: { reason: string; count: number }[];
  top_messages: { message: string; phase: string; got_reply: boolean }[];
  last_updated: string;
}

// ============================================
// Redis persistence — survives deploys and cold starts
// ============================================
const REDIS_URL = process.env.REDIS_URL || '';
const REDIS_KEY = 'learning:data';

let redis: Redis | null = null;
function getRedis(): Redis {
  if (!redis && REDIS_URL) {
    redis = new Redis(REDIS_URL, {
      maxRetriesPerRequest: 3,
      lazyConnect: true,
      connectTimeout: 5000,
    });
    redis.on('error', (err) => console.warn('[Redis/Learning]', err.message));
  }
  if (!redis) throw new Error('REDIS_URL not configured for self-learning');
  return redis;
}

// In-memory cache to avoid hitting Redis on every prompt generation
let cachedData: LearningEntry[] | null = null;
let cacheLoadedAt = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

async function readLearningData(): Promise<LearningEntry[]> {
  // Return cache if fresh
  if (cachedData && Date.now() - cacheLoadedAt < CACHE_TTL_MS) return cachedData;
  try {
    const r = getRedis();
    const val = await r.get(REDIS_KEY);
    cachedData = val ? JSON.parse(val) : [];
    cacheLoadedAt = Date.now();
    return cachedData!;
  } catch {
    return cachedData || [];
  }
}

async function writeLearningData(data: LearningEntry[]): Promise<void> {
  cachedData = data;
  cacheLoadedAt = Date.now();
  try {
    const r = getRedis();
    await r.set(REDIS_KEY, JSON.stringify(data));
  } catch (err) {
    console.warn('[Learning] Redis write error:', err instanceof Error ? err.message : err);
  }
}

/**
 * Record a draft outcome for learning
 */
export async function recordDraftOutcome(entry: {
  chat_id: string;
  phase: string;
  original_message: string;
  edited_message?: string;
  outcome: DraftOutcome;
  sentiment?: string;
  rejection_reason?: string;
}) {
  const data = await readLearningData();
  
  // Analyze opener style
  const opener = entry.original_message.split('\n')[0].toLowerCase();
  let openerStyle = 'statement';
  if (opener.includes('?')) openerStyle = 'question';
  else if (opener.match(/^(hey|hoi|hi|hallo|dag)/)) openerStyle = 'greeting';
  else if (opener.match(/zag|las|viel.*op|merkte/)) openerStyle = 'reference';
  else if (opener.match(/[😊👋🎯💡]/)) openerStyle = 'emoji';

  // Analyze tone
  let tone = 'professional';
  if (opener.match(/!/)) tone = 'enthusiastic';
  else if (opener.match(/^(hey|hoi|hi)\b/i)) tone = 'casual';
  else if (entry.original_message.length < 100) tone = 'direct';

  const newEntry: LearningEntry = {
    id: `learn_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
    chat_id: entry.chat_id,
    created_at: new Date().toISOString(),
    phase: entry.phase || 'unknown',
    message_length: entry.original_message.length,
    opener_style: openerStyle,
    tone,
    sentiment: entry.sentiment || 'neutral',
    outcome: entry.outcome,
    original_message: entry.original_message,
    edited_message: entry.edited_message,
    rejection_reason: entry.rejection_reason,
  };

  data.push(newEntry);
  
  // Keep last 500 entries to prevent unbounded growth
  if (data.length > 500) {
    data.splice(0, data.length - 500);
  }
  
  await writeLearningData(data);
  return newEntry;
}

/**
 * Record that a prospect replied after our message
 */
export async function recordProspectReply(chat_id: string, wasPositive: boolean) {
  const data = await readLearningData();
  // Find the most recent entry for this chat
  for (let i = data.length - 1; i >= 0; i--) {
    if (data[i].chat_id === chat_id) {
      data[i].prospect_replied = true;
      data[i].reply_was_positive = wasPositive;
      break;
    }
  }
  await writeLearningData(data);
}

/**
 * Generate insights from all learning data
 */
export async function generateInsights(): Promise<LearningInsights> {
  const data = await readLearningData();
  
  if (data.length === 0) {
    return {
      total_drafts: 0,
      approval_rate: 0,
      edit_rate: 0,
      rejection_rate: 0,
      best_phases: [],
      best_opener_styles: [],
      optimal_length_range: { min: 80, max: 300 },
      common_edits: [],
      human_preferred_patterns: [],
      reply_rate: 0,
      top_rejection_reasons: [],
      top_messages: [],
      last_updated: new Date().toISOString(),
    };
  }

  const approved = data.filter(d => d.outcome === 'approved' || d.outcome === 'sent' || d.outcome === 'meeting_booked');
  const edited = data.filter(d => d.outcome === 'edited');
  const rejected = data.filter(d => d.outcome === 'rejected');
  const successful = [...approved, ...edited]; // Edits are partial approvals

  // Phase analysis
  const phaseMap = new Map<string, { approved: number; total: number }>();
  for (const entry of data) {
    const p = phaseMap.get(entry.phase) || { approved: 0, total: 0 };
    p.total++;
    if (entry.outcome !== 'rejected') p.approved++;
    phaseMap.set(entry.phase, p);
  }
  const bestPhases = Array.from(phaseMap.entries())
    .map(([phase, { approved, total }]) => ({
      phase,
      approval_rate: Math.round((approved / total) * 100),
      count: total,
    }))
    .filter(p => p.count >= 3) // Min 3 samples
    .sort((a, b) => b.approval_rate - a.approval_rate);

  // Opener style analysis
  const styleMap = new Map<string, { approved: number; total: number }>();
  for (const entry of data) {
    const s = styleMap.get(entry.opener_style) || { approved: 0, total: 0 };
    s.total++;
    if (entry.outcome !== 'rejected') s.approved++;
    styleMap.set(entry.opener_style, s);
  }
  const bestOpenerStyles = Array.from(styleMap.entries())
    .map(([style, { approved, total }]) => ({
      style,
      approval_rate: Math.round((approved / total) * 100),
      count: total,
    }))
    .filter(s => s.count >= 2)
    .sort((a, b) => b.approval_rate - a.approval_rate);

  // Optimal length range (from approved messages)
  const approvedLengths = successful.map(d => d.message_length).sort((a, b) => a - b);
  const p25 = approvedLengths[Math.floor(approvedLengths.length * 0.25)] || 80;
  const p75 = approvedLengths[Math.floor(approvedLengths.length * 0.75)] || 300;

  // Common edits analysis
  const commonEdits: string[] = [];
  const humanPreferred: string[] = [];
  
  for (const entry of edited) {
    if (entry.edited_message && entry.original_message) {
      const origLen = entry.original_message.length;
      const editLen = entry.edited_message.length;
      
      if (editLen < origLen * 0.7) {
        commonEdits.push('Human prefers shorter messages');
      } else if (editLen > origLen * 1.3) {
        commonEdits.push('Human adds more detail/context');
      }

      // Check if greeting was changed
      const origOpener = entry.original_message.split('\n')[0];
      const editOpener = entry.edited_message.split('\n')[0];
      if (origOpener !== editOpener) {
        humanPreferred.push(`Preferred opener: "${editOpener.substring(0, 50)}" over "${origOpener.substring(0, 50)}"`);
      }
    }
  }

  // Reply rate analysis
  const sentEntries = data.filter(d => d.outcome === 'sent' || d.outcome === 'approved');
  const repliedEntries = sentEntries.filter(d => d.prospect_replied === true);
  const replyRate = sentEntries.length > 0 ? Math.round((repliedEntries.length / sentEntries.length) * 100) : 0;

  // Rejection reason analysis
  const reasonMap = new Map<string, number>();
  for (const entry of rejected) {
    const reason = entry.rejection_reason || 'Geen reden opgegeven';
    reasonMap.set(reason, (reasonMap.get(reason) || 0) + 1);
  }
  const topRejectionReasons = Array.from(reasonMap.entries())
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  // Top performing messages (approved + got reply)
  const topMessages = data
    .filter(d => (d.outcome === 'approved' || d.outcome === 'sent') && d.prospect_replied)
    .slice(-10)
    .map(d => ({ message: d.original_message.substring(0, 200), phase: d.phase, got_reply: d.reply_was_positive !== false }));

  return {
    total_drafts: data.length,
    approval_rate: Math.round((approved.length / data.length) * 100),
    edit_rate: Math.round((edited.length / data.length) * 100),
    rejection_rate: Math.round((rejected.length / data.length) * 100),
    best_phases: bestPhases,
    best_opener_styles: bestOpenerStyles,
    optimal_length_range: { min: p25, max: p75 },
    common_edits: [...new Set(commonEdits)].slice(0, 5),
    human_preferred_patterns: [...new Set(humanPreferred)].slice(0, 10),
    reply_rate: replyRate,
    top_rejection_reasons: topRejectionReasons,
    top_messages: topMessages,
    last_updated: new Date().toISOString(),
  };
}

/**
 * Build a learning context string to inject into Claude's prompt
 * This is the KEY function — it creates a summary of what the AI has learned
 * that gets added to the system prompt for every new draft generation
 */
export async function buildLearningPromptBlock(): Promise<string> {
  const insights = await generateInsights();
  
  if (insights.total_drafts < 5) {
    return ''; // Not enough data yet
  }

  let block = `\n\n--- SELF-LEARNING DATA (based on ${insights.total_drafts} previous drafts) ---\n`;
  block += `Approval rate: ${insights.approval_rate}% | Edit rate: ${insights.edit_rate}% | Rejection rate: ${insights.rejection_rate}%\n`;

  if (insights.best_opener_styles.length > 0) {
    block += `\nBest opener styles (by approval rate):\n`;
    for (const s of insights.best_opener_styles.slice(0, 3)) {
      block += `- "${s.style}": ${s.approval_rate}% approved (${s.count} samples)\n`;
    }
  }

  if (insights.optimal_length_range.min > 0) {
    block += `\nOptimal message length: ${insights.optimal_length_range.min}-${insights.optimal_length_range.max} characters\n`;
  }

  if (insights.best_phases.length > 0) {
    block += `\nPhase performance:\n`;
    for (const p of insights.best_phases.slice(0, 4)) {
      block += `- "${p.phase}": ${p.approval_rate}% success (${p.count} drafts)\n`;
    }
  }

  if (insights.common_edits.length > 0) {
    block += `\nHuman correction patterns (IMPORTANT - adapt to these):\n`;
    for (const e of insights.common_edits) {
      block += `- ${e}\n`;
    }
  }

  if (insights.human_preferred_patterns.length > 0) {
    block += `\nHuman preferred patterns (CRITICAL - follow these):\n`;
    for (const p of insights.human_preferred_patterns.slice(0, 5)) {
      block += `- ${p}\n`;
    }
  }

  if (insights.top_rejection_reasons.length > 0) {
    block += `\nMost common REJECTION reasons from operator (AVOID these patterns):\n`;
    for (const r of insights.top_rejection_reasons.slice(0, 5)) {
      block += `- "${r.reason}" (${r.count}x rejected)\n`;
    }
  }

  if (insights.reply_rate > 0) {
    block += `\nProspect reply rate: ${insights.reply_rate}% of sent messages got a reply.\n`;
  }

  block += `--- END LEARNING DATA ---\n`;
  return block;
}

/**
 * Get raw insights for dashboard display
 */
export async function getLearningStats() {
  return await generateInsights();
}
