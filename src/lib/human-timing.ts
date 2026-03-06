// ============================================
// Human-Like Timing — Per-conversation reply delay calculations
// Implements research golden nuggets from forums/Reddit
// ============================================

type ConversationPhase = 'koud' | 'lauw' | 'warm' | 'proof' | 'call' | 'weerstand' | string;

/**
 * GOLDEN NUGGET #2: Phase-aware reply timing.
 * Each conversation phase has different expected response times.
 * Openers should be SLOW (don't seem desperate).
 * Active back-and-forth should be faster.
 */
const PHASE_TIMING: Record<string, { minMinutes: number; maxMinutes: number }> = {
  koud:      { minMinutes: 120, maxMinutes: 720 },   // 2-12h (first reply, don't seem desperate)
  lauw:      { minMinutes: 30,  maxMinutes: 180 },    // 30m-3h
  warm:      { minMinutes: 10,  maxMinutes: 45 },     // 10-45m (they're interested, be present)
  proof:     { minMinutes: 15,  maxMinutes: 60 },     // 15-60m
  call:      { minMinutes: 5,   maxMinutes: 20 },     // 5-20m (logistics, be quick)
  weerstand: { minMinutes: 60,  maxMinutes: 240 },    // 1-4h (give them space)
  default:   { minMinutes: 15,  maxMinutes: 90 },
};

/**
 * Calculate a realistic reply delay based on:
 * 1. Conversation phase (golden nugget #2)
 * 2. When the prospect messaged (message age)
 * 3. Prospect's own response pace (golden nugget #3: never faster than ~30% of their pace)
 * 
 * Returns delay in milliseconds.
 */
export function calculateReplyDelay(options: {
  prospectMsgReceivedAt?: string;
  phase?: ConversationPhase;
  prospectAvgResponseTimeMs?: number;
}): number {
  const { prospectMsgReceivedAt, phase, prospectAvgResponseTimeMs } = options;

  // 1. Get phase-based timing
  const phaseTiming = PHASE_TIMING[phase || 'default'] || PHASE_TIMING.default;
  let baseDelayMs = randomBetween(phaseTiming.minMinutes, phaseTiming.maxMinutes) * 60 * 1000;

  // 2. Adjust based on message age (if message is already old, reduce delay)
  if (prospectMsgReceivedAt) {
    const ageMs = Date.now() - new Date(prospectMsgReceivedAt).getTime();
    const ageMinutes = ageMs / 60000;

    // If message is already older than our planned delay, use a shorter delay
    if (ageMinutes > phaseTiming.maxMinutes) {
      baseDelayMs = randomBetween(3, 15) * 60 * 1000; // 3-15 min from now
    } else if (ageMinutes > phaseTiming.minMinutes) {
      // Message already within our delay window — respond in remaining time
      const remaining = (phaseTiming.maxMinutes - ageMinutes) * 60 * 1000;
      baseDelayMs = Math.max(3 * 60 * 1000, remaining * Math.random());
    }
  }

  // 3. GOLDEN NUGGET #3: Never reply faster than ~30% of prospect's avg response time
  // BUT: HARD CAP at 24 hours. If prospect took a week, we don't wait a week.
  if (prospectAvgResponseTimeMs && prospectAvgResponseTimeMs > 0) {
    const MAX_REPLY_DELAY_MS = 24 * 60 * 60 * 1000; // 24 hours hard cap
    const minDelay = Math.min(prospectAvgResponseTimeMs * 0.3, MAX_REPLY_DELAY_MS);
    baseDelayMs = Math.min(Math.max(baseDelayMs, minDelay), MAX_REPLY_DELAY_MS);
  }

  // HARD CAP: Never wait longer than 24 hours regardless of phase or prospect pace
  const ABSOLUTE_MAX_DELAY = 24 * 60 * 60 * 1000;
  baseDelayMs = Math.min(baseDelayMs, ABSOLUTE_MAX_DELAY);

  // Apply jitter (±30%)
  return jitter(baseDelayMs, 0.3);
}

/**
 * Add a "typing" delay based on message length.
 * Simulates the time it would take a human to type the message.
 * Returns delay in milliseconds (5-30 seconds).
 */
export function calculateTypingDelay(messageLength: number): number {
  // Average human types ~40 words per minute = ~200 chars per minute
  const baseSeconds = Math.min(30, Math.max(5, messageLength / 15));
  return jitter(baseSeconds * 1000, 0.3);
}

/**
 * GOLDEN NUGGET #5: "Read receipt simulation"
 * A human reads the message before typing. Add a 30-90 second "read gap".
 */
export function calculateReadDelay(): number {
  return randomBetween(30, 90) * 1000;
}

/**
 * Calculate stagger delay between consecutive messages to DIFFERENT chats.
 * GOLDEN NUGGET #1: Cross-chat stagger — never reply to multiple chats simultaneously.
 * Minimum 5-15 minute gap between sends to different people.
 */
export function calculateCrossChatStagger(position: number): number {
  // First message: minimal delay, each subsequent one adds 5-15 min
  const baseMinutes = randomBetween(5, 15) * position;
  return baseMinutes * 60 * 1000 + jitter(60 * 1000, 0.5);
}

/**
 * Check if current time is within working hours.
 * Mon-Fri, 8:30 - 18:30 CET.
 * GOLDEN NUGGET #8: Start time randomized (not exactly 8:30)
 */
export function isWithinWorkingHours(): boolean {
  const now = new Date();
  const cetOffset = isCETSummerTime(now) ? 2 : 1;
  const cetHour = (now.getUTCHours() + cetOffset) % 24;
  const cetMinutes = cetHour * 60 + now.getUTCMinutes();
  const day = now.getUTCDay();

  // Weekend check
  if (day === 0 || day === 6) return false;

  // 8:30 = 510 minutes, 18:30 = 1110 minutes
  return cetMinutes >= 510 && cetMinutes <= 1110;
}

/**
 * Get the next available working hours window.
 * GOLDEN NUGGET #8: Randomize start within 8:30-10:00 window.
 */
export function getNextWorkingWindow(): Date {
  const now = new Date();
  const next = new Date(now);
  const cetOffset = isCETSummerTime(now) ? 2 : 1;

  // Move to next day if after working hours
  const cetHour = (now.getUTCHours() + cetOffset) % 24;
  if (cetHour >= 18 || (cetHour === 18 && now.getUTCMinutes() > 30)) {
    next.setUTCDate(next.getUTCDate() + 1);
  }

  // Skip weekends
  while (next.getUTCDay() === 0 || next.getUTCDay() === 6) {
    next.setUTCDate(next.getUTCDate() + 1);
  }

  // Set to random start between 8:30-10:00 CET
  const startHour = 8 + Math.floor(Math.random() * 2); // 8 or 9
  const startMin = startHour === 8 ? 30 + Math.floor(Math.random() * 30) : Math.floor(Math.random() * 60);
  next.setUTCHours(startHour - cetOffset, startMin, 0, 0);
  return next;
}

/**
 * GOLDEN NUGGET #7: Determine if today should be a "cooling off" day.
 * After a busy day (10+ messages sent yesterday), reduce today's capacity.
 */
export function getDailyCapacity(sentYesterday: number): number {
  const baseCapacity = 15;
  if (sentYesterday >= 12) {
    // Busy yesterday — cool off today (50-70% capacity)
    return Math.ceil(baseCapacity * randomBetween(0.3, 0.5));
  }
  if (sentYesterday >= 8) {
    // Moderate yesterday — slightly reduced (70-90%)
    return Math.ceil(baseCapacity * randomBetween(0.7, 0.9));
  }
  return baseCapacity;
}

/**
 * GOLDEN NUGGET #8: Occasional off-hours message.
 * 10% chance of allowing a late evening send (19:30-21:00), never on Sunday.
 */
export function allowOffHoursMessage(): boolean {
  const now = new Date();
  if (now.getUTCDay() === 0) return false; // Never Sunday
  
  const cetOffset = isCETSummerTime(now) ? 2 : 1;
  const cetHour = (now.getUTCHours() + cetOffset) % 24;
  
  // Only in the 19:30-21:00 window
  if (cetHour >= 19 && cetHour < 21) {
    return Math.random() < 0.1; // 10% chance
  }
  return false;
}

// ---- Helpers ----

function randomBetween(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function jitter(value: number, factor: number): number {
  const range = value * factor;
  return value + (Math.random() * 2 - 1) * range;
}

function isCETSummerTime(date: Date): boolean {
  const month = date.getUTCMonth();
  if (month > 2 && month < 9) return true;
  if (month < 2 || month > 9) return false;
  const day = date.getUTCDate();
  const weekday = date.getUTCDay();
  const lastSunday = day - weekday;
  if (month === 2) return lastSunday >= 25;
  return lastSunday < 25;
}
