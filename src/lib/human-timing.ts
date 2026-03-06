// ============================================
// Human-Like Timing — Reply delay calculations
// ============================================

/**
 * Calculate a realistic reply delay based on when the prospect messaged.
 * Returns delay in milliseconds.
 */
export function calculateReplyDelay(prospectMsgReceivedAt?: string): number {
  if (!prospectMsgReceivedAt) {
    // No timestamp — use a moderate delay
    return jitter(10 * 60 * 1000, 0.4); // ~10 min ± 40%
  }

  const ageMs = Date.now() - new Date(prospectMsgReceivedAt).getTime();
  const ageMinutes = ageMs / 60000;

  let baseDelayMs: number;

  if (ageMinutes < 60) {
    // Fresh message (< 1h) — reply in 3-15 minutes
    baseDelayMs = randomBetween(3, 15) * 60 * 1000;
  } else if (ageMinutes < 240) {
    // 1-4 hours old — reply in 10-30 minutes
    baseDelayMs = randomBetween(10, 30) * 60 * 1000;
  } else if (ageMinutes < 1440) {
    // 4-24 hours old — reply in 15-60 minutes
    baseDelayMs = randomBetween(15, 60) * 60 * 1000;
  } else {
    // Older than 24h — reply in 30-120 minutes
    baseDelayMs = randomBetween(30, 120) * 60 * 1000;
  }

  return jitter(baseDelayMs, 0.3);
}

/**
 * Add a "typing" delay based on message length.
 * Simulates the time it would take a human to type the message.
 * Returns delay in milliseconds (5-30 seconds).
 */
export function calculateTypingDelay(messageLength: number): number {
  // Average human types ~40 words per minute = ~200 chars per minute
  // But for short LinkedIn DMs, people often copy-paste or type quickly
  const baseSeconds = Math.min(30, Math.max(5, messageLength / 15));
  return jitter(baseSeconds * 1000, 0.3);
}

/**
 * Calculate stagger delay between consecutive messages.
 * Minimum 2-5 minute gap between sends.
 */
export function calculateStaggerDelay(): number {
  return randomBetween(2, 5) * 60 * 1000 + jitter(30 * 1000, 0.5);
}

/**
 * Check if current time is within working hours.
 * Mon-Fri, 8:30 - 18:30 CET.
 */
export function isWithinWorkingHours(): boolean {
  const now = new Date();
  // Convert to CET (UTC+1, or UTC+2 in summer)
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
 * Returns a Date for when sending can resume.
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

  // Set to 8:30 CET
  next.setUTCHours(8 - cetOffset + Math.floor(Math.random() * 2), 30 + Math.floor(Math.random() * 30), 0, 0);
  return next;
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
  // Rough CET/CEST check (last Sunday of March to last Sunday of October)
  const month = date.getUTCMonth();
  if (month > 2 && month < 9) return true;
  if (month < 2 || month > 9) return false;
  const day = date.getUTCDate();
  const weekday = date.getUTCDay();
  const lastSunday = day - weekday;
  if (month === 2) return lastSunday >= 25;
  return lastSunday < 25;
}
