// Measured: each offer-listing fetch takes ~2.4s round trip (server/network
// bound), which dwarfs this delay — so the delay barely affects total scan
// time and exists mainly to avoid a perfectly uniform request cadence.
// Concurrency is the real speed lever; 5 measured ~2x faster than 3 with
// no errors, while keeping sustained throughput (~5 / 2.4s ≈ 2 req/s) well
// under anything that looks like scraping.
export const CONCURRENCY = 5;
export const MIN_DELAY_MS = 250;
export const JITTER_MS = 350;

export const CONDITION_KEYS = ['new', 'like_new', 'very_good', 'good', 'acceptable'];

// Abort a scan after this many confirmed bot-check blocks — enough to tell
// the network is flagged rather than that individual variants have no offers.
export const BLOCK_THRESHOLD = 3;

// Amazon doesn't publish how long a bot-check block lasts, so this is a
// conservative estimate that escalates (5m, 10m, 20m, ... capped at 1h) if
// it keeps happening, rather than a number we actually know to be correct.
export const COOLDOWN_KEY = 'abpsCooldownUntil';
export const STREAK_KEY = 'abpsBlockStreak';
export const BASE_COOLDOWN_MS = 5 * 60 * 1000;
export const MAX_COOLDOWN_MS = 60 * 60 * 1000;
