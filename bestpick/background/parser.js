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
 * takes the lowest price found before the next heading.
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
