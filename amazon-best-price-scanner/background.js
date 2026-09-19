const FETCH_DELAY_MS = 300;
const CONDITION_KEYS = ['new', 'like_new', 'very_good', 'good', 'acceptable'];

let activeScanId = 0;

chrome.runtime.onMessage.addListener((message, sender) => {
  if (message?.type !== 'SCAN') return;
  const tabId = sender.tab?.id;
  if (tabId == null) return;

  activeScanId += 1;
  runScan(message.variants, tabId, activeScanId);
});

async function runScan(variants, tabId, scanId) {
  for (const variant of variants) {
    if (scanId !== activeScanId) return;

    const prices = await fetchConditions(variant.asin);

    if (scanId !== activeScanId) return;
    chrome.tabs.sendMessage(tabId, {
      type: 'RESULT',
      asin: variant.asin,
      name: variant.name,
      prices,
    });

    await delay(FETCH_DELAY_MS);
  }

  if (scanId === activeScanId) {
    chrome.tabs.sendMessage(tabId, { type: 'DONE' });
  }
}

async function fetchConditions(asin) {
  const empty = Object.fromEntries(CONDITION_KEYS.map((key) => [key, null]));
  try {
    const res = await fetch(`https://www.amazon.com/gp/offer-listing/${asin}`, {
      credentials: 'include',
    });
    if (!res.ok) return empty;
    const html = await res.text();
    return parseAllConditions(html);
  } catch {
    return empty;
  }
}

// Amazon's offer-listing markup shifts over time, so this matches on the
// condition heading text itself rather than a specific class name, then
// takes the lowest price found before the next heading.
function parseAllConditions(html) {
  const conditions = Object.fromEntries(CONDITION_KEYS.map((key) => [key, null]));

  const headingRegex = /(Used\s*-\s*Like New|Used\s*-\s*Very Good|Used\s*-\s*Good|Used\s*-\s*Acceptable|>\s*New\s*<)/gi;
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

function conditionKeyForLabel(label) {
  if (/Like New/i.test(label)) return 'like_new';
  if (/Very Good/i.test(label)) return 'very_good';
  if (/Acceptable/i.test(label)) return 'acceptable';
  if (/Good/i.test(label)) return 'good';
  return 'new';
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
