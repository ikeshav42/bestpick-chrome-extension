import { CONDITION_KEYS } from './config.js';

export function isBlockedPage(html) {
  return html.length < 5000 && /validateCaptcha|Type the characters you see/i.test(html);
}

export function emptyConditions() {
  return Object.fromEntries(CONDITION_KEYS.map((key) => [key, null]));
}

/**
 * Amazon's offer-listing markup shifts over time, so this matches on the
 * condition heading text itself rather than a specific class name, then
 * takes the lowest valid price found before the next heading.
 */
export function parseAllConditions(html) {
  const conditions = emptyConditions();

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

    const priceMatches = findValidPrices(chunk);
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

// Amazon renders a price into an "a-offscreen" span for screen readers in
// several unrelated contexts on the same page, not just the real buybox or
// offer price: a mini price under each variant swatch (e.g. "$66.79 ($5.57
// / pack)"), and — the one that actually bit us — a "$X.XX per count" unit
// price shown right next to a real multi-pack offer's total price, using
// the identical "a-offscreen" span, wrapped in a "...priceperunit-value"
// container. A naive "first" or "lowest" match over all "a-offscreen"
// prices on the page/chunk will grab one of these instead of the real
// price. This finds every "a-offscreen" price and drops any immediately
// preceded by a "priceperunit" wrapper, since that's specifically a
// per-unit annotation, not a standalone offer.
function findValidPrices(text) {
  const results = [];
  const regex = /class="a-offscreen">\s*\$([\d,]+\.\d{2})\s*</g;
  let match;
  while ((match = regex.exec(text))) {
    if (isWrappedInPerUnitSpan(text, match.index)) continue;
    results.push(parseFloat(match[1].replace(/,/g, '')));
  }
  return results;
}

// Checks only the *nearest* preceding "<span class=...>" tag's own class
// list — not a blind fixed-size text lookback. A wider text search would
// wrongly disqualify a real, unrelated price that just happens to fall
// within N characters of an earlier, already-consumed per-unit wrapper
// (a real bug caught by testing: per-unit noise placed *before* the real
// price in the markup was incorrectly excluding the real price too).
function isWrappedInPerUnitSpan(text, matchIndex) {
  const before = text.slice(Math.max(0, matchIndex - 300), matchIndex);
  const spanOpenTags = [...before.matchAll(/<span class="([^"]*)"/g)];
  if (spanOpenTags.length === 0) return false;
  const nearestSpanClass = spanOpenTags[spanOpenTags.length - 1][1];
  return /priceperunit/i.test(nearestSpanClass);
}

// The offer-listing URL redirects to the product's own /dp/ page. Scoping
// to the buybox's own container avoids picking up unrelated "a-offscreen"
// prices that appear earlier in the raw HTML (swatch mini-prices, etc).
const BUYBOX_CONTAINER_IDS = ['corePrice_feature_div', 'corePriceDisplay_desktop_feature_div', 'apex_desktop'];

function extractBuyboxPrice(html) {
  for (const id of BUYBOX_CONTAINER_IDS) {
    const start = html.indexOf(`id="${id}"`);
    if (start === -1) continue;
    const [price] = findValidPrices(html.slice(start, start + 4000));
    if (price != null) return { price, count: 1 };
  }

  // Fallback for pages that don't use any of the known container ids.
  const [price] = findValidPrices(html);
  if (price == null) return null;
  return { price, count: 1 };
}

function conditionKeyForLabel(label) {
  if (/Like New/i.test(label)) return 'like_new';
  if (/Very Good/i.test(label)) return 'very_good';
  if (/Acceptable/i.test(label)) return 'acceptable';
  return 'good';
}
