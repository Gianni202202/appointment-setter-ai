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

import * as fs from 'fs';
import * as path from 'path';

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
  last_updated: string;
}

// Persistence
const PERSIST_DIR = '/tmp/appointmentai';

function ensurePersistDir() {
  try { fs.mkdirSync(PERSIST_DIR, { recursive: true }); } catch {}
}

function readLearningData(): LearningEntry[] {
  ensurePersistDir();
  const filePath = path.join(PERSIST_DIR, 'learning_data.json');
  try {
    const data = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(data);
  } catch {
    return [];
  }
}

function writeLearningData(data: LearningEntry[]) {
  ensurePersistDir();
  const filePath = path.join(PERSIST_DIR, 'learning_data.json');
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

/**
 * Record a draft outcome for learning
 */
export function recordDraftOutcome(entry: {
  chat_id: string;
  phase: string;
  original_message: string;
  edited_message?: string;
  outcome: DraftOutcome;
  sentiment?: string;
}) {
  const data = readLearningData();
  
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
  };

  data.push(newEntry);
  
  // Keep last 500 entries to prevent unbounded growth
  if (data.length > 500) {
    data.splice(0, data.length - 500);
  }
  
  writeLearningData(data);
  return newEntry;
}

/**
 * Record that a prospect replied after our message
 */
export function recordProspectReply(chat_id: string, wasPositive: boolean) {
  const data = readLearningData();
  // Find the most recent entry for this chat
  for (let i = data.length - 1; i >= 0; i--) {
    if (data[i].chat_id === chat_id) {
      data[i].prospect_replied = true;
      data[i].reply_was_positive = wasPositive;
      break;
    }
  }
  writeLearningData(data);
}

/**
 * Generate insights from all learning data
 */
export function generateInsights(): LearningInsights {
  const data = readLearningData();
  
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
    last_updated: new Date().toISOString(),
  };
}

/**
 * Build a learning context string to inject into Claude's prompt
 * This is the KEY function — it creates a summary of what the AI has learned
 * that gets added to the system prompt for every new draft generation
 */
export function buildLearningPromptBlock(): string {
  const insights = generateInsights();
  
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

  block += `--- END LEARNING DATA ---\n`;
  return block;
}

/**
 * Get raw insights for dashboard display
 */
export function getLearningStats() {
  return generateInsights();
}
