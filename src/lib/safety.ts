// ============================================
// Safety Module — Anti-Detection & Loop Prevention
// ============================================

interface SafetyCheck {
  allowed: boolean;
  reason?: string;
  delay_ms?: number;
}

// Track last response times per conversation
const lastResponseTime: Map<string, number> = new Map();
const dailyMessageCount: { date: string; count: number } = { date: '', count: 0 };
const respondedMessageIds: Set<string> = new Set();

// ============================================
// Configuration
// ============================================

const SAFETY_CONFIG = {
  // Minimum delay before responding (ms) — 45 seconds
  MIN_DELAY_MS: 45_000,
  // Maximum delay before responding (ms) — 8 minutes
  MAX_DELAY_MS: 480_000,
  // Cooldown per conversation (ms) — 5 minutes
  CONVERSATION_COOLDOWN_MS: 300_000,
  // Max agent messages per day
  MAX_DAILY_MESSAGES: 15,
  // Max messages per hour
  MAX_HOURLY_MESSAGES: 5,
  // Working hours (0-23)
  WORKING_HOURS_START: 9,
  WORKING_HOURS_END: 18,
  // Weekend detection
  BLOCK_WEEKENDS: true,
};

// ============================================
// Core Safety Checks
// ============================================

/**
 * Run ALL safety checks before sending a message.
 * Returns { allowed, reason, delay_ms }
 */
export function runSafetyChecks(
  conversationId: string,
  lastMessageRole: string,
  messageId: string,
  globalAgentEnabled: boolean,
  conversationAutoRespond: boolean,
  workingHoursStart?: number,
  workingHoursEnd?: number,
): SafetyCheck {
  // 1. Global agent toggle
  if (!globalAgentEnabled) {
    return { allowed: false, reason: 'Global agent is OFF' };
  }

  // 2. Per-conversation toggle
  if (!conversationAutoRespond) {
    return { allowed: false, reason: 'Auto-respond is OFF for this conversation' };
  }

  // 3. Loop prevention — don't respond to our own messages
  if (lastMessageRole === 'agent' || lastMessageRole === 'human') {
    return { allowed: false, reason: 'Last message was from us — preventing loop' };
  }

  // 4. Duplicate message check
  if (respondedMessageIds.has(messageId)) {
    return { allowed: false, reason: 'Already responded to this message' };
  }

  // 5. Conversation cooldown
  const lastTime = lastResponseTime.get(conversationId);
  if (lastTime && Date.now() - lastTime < SAFETY_CONFIG.CONVERSATION_COOLDOWN_MS) {
    const remaining = SAFETY_CONFIG.CONVERSATION_COOLDOWN_MS - (Date.now() - lastTime);
    return { allowed: false, reason: `Cooldown active — ${Math.ceil(remaining / 1000)}s remaining` };
  }

  // 6. Working hours check
  const start = workingHoursStart ?? SAFETY_CONFIG.WORKING_HOURS_START;
  const end = workingHoursEnd ?? SAFETY_CONFIG.WORKING_HOURS_END;
  if (!isWithinWorkingHours(start, end)) {
    return { allowed: false, reason: 'Outside working hours' };
  }

  // 7. Weekend check
  if (SAFETY_CONFIG.BLOCK_WEEKENDS && isWeekend()) {
    return { allowed: false, reason: 'Weekend — agent is paused' };
  }

  // 8. Daily message limit
  if (getDailyCount() >= SAFETY_CONFIG.MAX_DAILY_MESSAGES) {
    return { allowed: false, reason: `Daily limit reached (${SAFETY_CONFIG.MAX_DAILY_MESSAGES} messages)` };
  }

  // All checks passed — calculate a random human-like delay
  const delay = calculateHumanDelay();
  return { allowed: true, delay_ms: delay };
}

/**
 * Mark a message as responded to (for deduplication)
 */
export function markAsResponded(conversationId: string, messageId: string): void {
  respondedMessageIds.add(messageId);
  lastResponseTime.set(conversationId, Date.now());
  incrementDailyCount();

  // Clean up old message IDs (keep last 1000)
  if (respondedMessageIds.size > 1000) {
    const arr = Array.from(respondedMessageIds);
    respondedMessageIds.clear();
    arr.slice(-500).forEach(id => respondedMessageIds.add(id));
  }
}

// ============================================
// Helper Functions
// ============================================

function isWithinWorkingHours(start: number, end: number): boolean {
  // Use CET/Amsterdam timezone
  const now = new Date();
  const hour = now.getUTCHours() + 1; // Rough CET offset
  return hour >= start && hour < end;
}

function isWeekend(): boolean {
  const day = new Date().getDay();
  return day === 0 || day === 6; // Sunday = 0, Saturday = 6
}

function calculateHumanDelay(): number {
  // Random delay between MIN and MAX, with bell-curve distribution
  // This makes most responses land in the middle range (more natural)
  const u1 = Math.random();
  const u2 = Math.random();
  // Box-Muller for normal distribution
  const normal = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  // Center around the midpoint with spread
  const midpoint = (SAFETY_CONFIG.MIN_DELAY_MS + SAFETY_CONFIG.MAX_DELAY_MS) / 2;
  const spread = (SAFETY_CONFIG.MAX_DELAY_MS - SAFETY_CONFIG.MIN_DELAY_MS) / 4;
  let delay = midpoint + normal * spread;
  // Clamp to bounds
  delay = Math.max(SAFETY_CONFIG.MIN_DELAY_MS, Math.min(SAFETY_CONFIG.MAX_DELAY_MS, delay));
  return Math.round(delay);
}

function getDailyCount(): number {
  const today = new Date().toISOString().split('T')[0];
  if (dailyMessageCount.date !== today) {
    dailyMessageCount.date = today;
    dailyMessageCount.count = 0;
  }
  return dailyMessageCount.count;
}

function incrementDailyCount(): void {
  const today = new Date().toISOString().split('T')[0];
  if (dailyMessageCount.date !== today) {
    dailyMessageCount.date = today;
    dailyMessageCount.count = 0;
  }
  dailyMessageCount.count++;
}

/**
 * Get current safety stats for the dashboard
 */
export function getSafetyStats() {
  return {
    daily_messages_sent: getDailyCount(),
    daily_limit: SAFETY_CONFIG.MAX_DAILY_MESSAGES,
    is_working_hours: isWithinWorkingHours(SAFETY_CONFIG.WORKING_HOURS_START, SAFETY_CONFIG.WORKING_HOURS_END),
    is_weekend: isWeekend(),
    active_cooldowns: lastResponseTime.size,
  };
}
