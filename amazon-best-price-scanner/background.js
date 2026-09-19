const CONDITION_KEYS = ['new', 'like_new', 'very_good', 'good', 'acceptable'];

// Measured: each offer-listing fetch takes ~2.4s round trip (server/network
// bound), which dwarfs this delay — so the delay barely affects total scan
// time and exists mainly to avoid a perfectly uniform request cadence.
// Concurrency is the real speed lever; 5 measured ~2x faster than 3 with
// no errors, while keeping sustained throughput (~5 / 2.4s ≈ 2 req/s) well
// under anything that looks like scraping.
const CONCURRENCY = 5;
const MIN_DELAY_MS = 250;
const JITTER_MS = 350;

// Amazon doesn't publish how long a bot-check block lasts, so this is a
// conservative estimate that escalates (5m, 10m, 20m, ... capped at 1h) if
// it keeps happening, rather than a number we actually know to be correct.
const COOLDOWN_KEY = 'abpsCooldownUntil';
const STREAK_KEY = 'abpsBlockStreak';
const BASE_COOLDOWN_MS = 5 * 60 * 1000;
const MAX_COOLDOWN_MS = 60 * 60 * 1000;
const BLOCK_THRESHOLD = 3; // abort the scan after this many confirmed blocks

let activeScanId = 0;

chrome.runtime.onMessage.addListener((message, sender) => {
  if (message?.type !== 'SCAN') return;
  const tabId = sender.tab?.id;
  if (tabId == null) return;

  activeScanId += 1;
  handleScanRequest(message.variants, tabId, activeScanId);
});

async function handleScanRequest(variants, tabId, scanId) {
  const cooldownUntil = await getCooldown();
  if (Date.now() < cooldownUntil) {
    chrome.tabs.sendMessage(tabId, { type: 'BLOCKED', retryAt: cooldownUntil });
    return;
  }
  await runScan(variants, tabId, scanId);
}

async function runScan(variants, tabId, scanId) {
  const queue = [...variants];
  let blockedHits = 0;
  let aborted = false;

  async function worker() {
    while (queue.length) {
      if (scanId !== activeScanId || aborted) return;
      const variant = queue.shift();

      const { prices, blocked } = await fetchConditions(variant.asin);
      if (scanId !== activeScanId || aborted) return;

      if (blocked) {
        blockedHits += 1;
        // Enough confirmed blocks means the network is flagged, not that
        // this one variant has no offers — stop hammering it and back off.
        if (blockedHits >= BLOCK_THRESHOLD) {
          aborted = true;
          queue.length = 0;
          const retryAt = await startCooldown();
          chrome.tabs.sendMessage(tabId, { type: 'BLOCKED', retryAt });
          return;
        }
        continue;
      }

      chrome.tabs.sendMessage(tabId, {
        type: 'RESULT',
        asin: variant.asin,
        name: variant.name,
        prices,
      });

      await delay(MIN_DELAY_MS + Math.random() * JITTER_MS);
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, variants.length) }, worker));

  if (scanId === activeScanId && !aborted) {
    await chrome.storage.local.remove(STREAK_KEY);
    chrome.tabs.sendMessage(tabId, { type: 'DONE' });
  }
}

async function getCooldown() {
  const { [COOLDOWN_KEY]: until = 0 } = await chrome.storage.local.get(COOLDOWN_KEY);
  return until;
}

async function startCooldown() {
  const { [STREAK_KEY]: streak = 0 } = await chrome.storage.local.get(STREAK_KEY);
  const duration = Math.min(BASE_COOLDOWN_MS * 2 ** streak, MAX_COOLDOWN_MS);
  const until = Date.now() + duration;
  await chrome.storage.local.set({ [COOLDOWN_KEY]: until, [STREAK_KEY]: streak + 1 });
  return until;
}

async function fetchConditions(asin, attempt = 0) {
  const empty = Object.fromEntries(CONDITION_KEYS.map((key) => [key, null]));
  try {
    // No cookies: these background scans shouldn't be tied to the user's
    // account or feed into their personalized browsing history/recommendations.
    const res = await fetch(`https://www.amazon.com/gp/offer-listing/${asin}`, {
      credentials: 'omit',
    });
    if (!res.ok) return { prices: empty, blocked: false };
    const html = await res.text();

    // A rate-limited/blocked request comes back as a tiny "please confirm
    // you're not a robot" page, not an HTTP error — treating it as "no
    // offers" would silently report wrong data. Back off and retry once.
    if (isBlockedPage(html)) {
      if (attempt >= 1) return { prices: empty, blocked: true };
      await delay(1500 + Math.random() * 1500);
      return fetchConditions(asin, attempt + 1);
    }

    return { prices: parseAllConditions(html), blocked: false };
  } catch {
    return { prices: empty, blocked: false };
  }
}

function isBlockedPage(html) {
  return html.length < 5000 && /validateCaptcha|Type the characters you see/i.test(html);
}

// Amazon's offer-listing markup shifts over time, so this matches on the
// condition heading text itself rather than a specific class name, then
// takes the lowest price found before the next heading.
function parseAllConditions(html) {
  const conditions = Object.fromEntries(CONDITION_KEYS.map((key) => [key, null]));

  // "New" means the ordinary buy-it-now price a shopper pays for a brand
  // new item — Amazon's own buybox price — not a marketplace "New"
  // condition listing, which third-party sellers rarely post separately.
  conditions.new = extractBuyboxPrice(html);

  const headingRegex = /(Used\s*-\s*Like New|Used\s*-\s*Very Good|Used\s*-\s*Good|Used\s*-\s*Acceptable)/gi;
  const matches = [...html.matchAll(headingRegex)];

  matches.forEach((match, i) => {
    const label = match[0];
    const chunkStart = match.index + label.length;
    const chunkEnd = i + 1 < matches.length ? matches[i + 1].index : html.length;
    const chunk = html.slice(chunkStart, Math.min(chunkEnd, chunkStart + 4000));

    const priceMatches = [...chunk.matchAll(/\$([\d,]+\.\d{2})/g)].map((m) =>
      parseFloat(m[1].replace(/,/g, ''))
    );
    if (priceMatches.length === 0) return;

    const key = conditionKeyForLabel(label);
    const lowest = Math.min(...priceMatches);
    const existing = conditions[key];
    if (!existing || lowest < existing.price) {
      conditions[key] = { price: lowest, count: priceMatches.length };
    }
  });

  return conditions;
}

// The offer-listing URL redirects to the product's own /dp/ page, whose
// buybox renders the current price into a "a-offscreen" span (for screen
// readers) ahead of any used-offer content further down the page, so the
// first match is reliably the primary new-item price.
function extractBuyboxPrice(html) {
  const match = html.match(/class="a-offscreen">\s*\$([\d,]+\.\d{2})\s*</);
  if (!match) return null;
  return { price: parseFloat(match[1].replace(/,/g, '')), count: 1 };
}

function conditionKeyForLabel(label) {
  if (/Like New/i.test(label)) return 'like_new';
  if (/Very Good/i.test(label)) return 'very_good';
  if (/Acceptable/i.test(label)) return 'acceptable';
  return 'good';
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
