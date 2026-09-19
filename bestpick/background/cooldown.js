import { COOLDOWN_KEY, STREAK_KEY, BASE_COOLDOWN_MS, MAX_COOLDOWN_MS } from './config.js';

/** Timestamp (ms) until which scanning should be refused, or 0 if clear. */
export async function getCooldown() {
  const { [COOLDOWN_KEY]: until = 0 } = await chrome.storage.local.get(COOLDOWN_KEY);
  return until;
}

/** Starts (or escalates) a cooldown and returns its expiry timestamp. */
export async function startCooldown() {
  const { [STREAK_KEY]: streak = 0 } = await chrome.storage.local.get(STREAK_KEY);
  const duration = Math.min(BASE_COOLDOWN_MS * 2 ** streak, MAX_COOLDOWN_MS);
  const until = Date.now() + duration;
  await chrome.storage.local.set({ [COOLDOWN_KEY]: until, [STREAK_KEY]: streak + 1 });
  return until;
}

/** Resets the escalation streak after a scan completes with no blocks. */
export async function clearBlockStreak() {
  await chrome.storage.local.remove(STREAK_KEY);
}
