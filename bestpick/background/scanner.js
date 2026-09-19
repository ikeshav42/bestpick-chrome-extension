import { CONCURRENCY, MIN_DELAY_MS, JITTER_MS, BLOCK_THRESHOLD } from './config.js';
import { getCooldown, startCooldown, clearBlockStreak } from './cooldown.js';
import { emptyConditions, parseAllConditions, isBlockedPage } from './parser.js';

let activeScanId = 0;

/** Bumps and returns the id for a new scan; stale scans self-cancel by checking this. */
export function nextScanId() {
  activeScanId += 1;
  return activeScanId;
}

function isCurrentScan(scanId) {
  return scanId === activeScanId;
}

/** Entry point for a SCAN request: checks for an active cooldown before doing any work. */
export async function handleScanRequest(variants, tabId, scanId) {
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
      if (!isCurrentScan(scanId) || aborted) return;
      const variant = queue.shift();

      const { prices, blocked } = await fetchConditions(variant.asin);
      if (!isCurrentScan(scanId) || aborted) return;

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

  if (isCurrentScan(scanId) && !aborted) {
    await clearBlockStreak();
    chrome.tabs.sendMessage(tabId, { type: 'DONE' });
  }
}

async function fetchConditions(asin, attempt = 0) {
  const empty = emptyConditions();
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

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
