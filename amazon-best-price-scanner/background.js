const CONDITION_KEYS = ['new', 'like_new', 'very_good', 'good', 'acceptable'];

// A few requests in flight at once, each on its own randomly-jittered
// delay, gets us well under 20s for ~40 variants without the perfectly
// even, all-at-once request pattern that's easy to fingerprint as a bot.
const CONCURRENCY = 3;
const MIN_DELAY_MS = 250;
const JITTER_MS = 350;

let activeScanId = 0;

chrome.runtime.onMessage.addListener((message, sender) => {
  if (message?.type !== 'SCAN') return;
  const tabId = sender.tab?.id;
  if (tabId == null) return;

  activeScanId += 1;
  runScan(message.variants, tabId, activeScanId);
});

async function runScan(variants, tabId, scanId) {
  const queue = [...variants];

  async function worker() {
    while (queue.length) {
      if (scanId !== activeScanId) return;
      const variant = queue.shift();

      const prices = await fetchConditions(variant.asin);

      if (scanId !== activeScanId) return;
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

  if (scanId === activeScanId) {
    chrome.tabs.sendMessage(tabId, { type: 'DONE' });
  }
}

async function fetchConditions(asin, attempt = 0) {
  const empty = Object.fromEntries(CONDITION_KEYS.map((key) => [key, null]));
  try {
    // No cookies: these background scans shouldn't be tied to the user's
    // account or feed into their personalized browsing history/recommendations.
    const res = await fetch(`https://www.amazon.com/gp/offer-listing/${asin}`, {
      credentials: 'omit',
    });
    if (!res.ok) return empty;
    const html = await res.text();

    // A rate-limited/blocked request comes back as a tiny "please confirm
    // you're not a robot" page, not an HTTP error — treating it as "no
    // offers" would silently report wrong data. Back off and retry once.
    if (isBlockedPage(html)) {
      if (attempt >= 1) return empty;
      await delay(1500 + Math.random() * 1500);
      return fetchConditions(asin, attempt + 1);
    }

    return parseAllConditions(html);
  } catch {
    return empty;
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
