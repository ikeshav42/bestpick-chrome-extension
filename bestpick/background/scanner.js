import { CONCURRENCY, MIN_DELAY_MS, JITTER_MS, BLOCK_THRESHOLD, BASE_COOLDOWN_MS } from './config.js';
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

/**
 * Sends a message to the content script in `tabId`, swallowing delivery
 * failures. The tab may be closed, navigated away, or have no content script
 * (e.g. it was already open when the extension was installed/reloaded) — in
 * every one of those cases there is nobody listening, and the rejected
 * sendMessage would otherwise surface as an unhandled rejection in the
 * service worker.
 *
 * The send is awaited, so this relies on the content script's listener
 * returning `undefined` (content.js never calls sendResponse) — Chrome then
 * settles the promise immediately. If that listener ever returns `true`, the
 * promise would never settle and every awaiting caller would hang.
 *
 * Returns whether the message was delivered.
 */
async function sendToTab(tabId, message) {
  try {
    await chrome.tabs.sendMessage(tabId, message);
    return true;
  } catch (err) {
    console.warn('Tab message dropped', { type: message.type, tabId, error: err?.message });
    return false;
  }
}

/**
 * Starts the cooldown and reports when scanning may resume. If the cooldown
 * can't be persisted (e.g. a storage quota error) the tab still has to be
 * told to back off, so fall back to the base duration.
 */
async function startCooldownSafely() {
  try {
    return await startCooldown();
  } catch (err) {
    console.warn('Failed to persist cooldown', { error: err?.message });
    return Date.now() + BASE_COOLDOWN_MS;
  }
}

/** Entry point for a SCAN request: checks for an active cooldown before doing any work. */
export async function handleScanRequest(variants, tabId, scanId) {
  // A storage read failure must not skip the cooldown check, but it shouldn't
  // kill the scan either. Fail closed — assume a cooldown is active for the
  // base duration rather than bursting requests at an already-flagged network.
  // The next scan request re-reads storage, so a spurious wait is one-shot.
  let cooldownUntil = 0;
  try {
    cooldownUntil = await getCooldown();
  } catch (err) {
    console.warn('Failed to read cooldown', { error: err?.message });
    cooldownUntil = Date.now() + BASE_COOLDOWN_MS;
  }
  if (Date.now() < cooldownUntil) {
    await sendToTab(tabId, { type: 'BLOCKED', retryAt: cooldownUntil });
    return;
  }
  await runScan(variants, tabId, scanId);
}

async function runScan(variants, tabId, scanId) {
  const queue = [...variants];
  let blockedHits = 0;
  let aborted = false;
  // Cap the threshold at the scan size — otherwise a small scan (e.g. 2
  // variants) can never accumulate enough blocked hits to trip it, and a
  // fully-blocked scan silently reports "no offers" instead of backing off.
  const blockThreshold = Math.min(BLOCK_THRESHOLD, variants.length);

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
        if (blockedHits >= blockThreshold) {
          aborted = true;
          queue.length = 0;
          const retryAt = await startCooldownSafely();
          await sendToTab(tabId, { type: 'BLOCKED', retryAt });
          return;
        }
        continue;
      }

      const delivered = await sendToTab(tabId, {
        type: 'RESULT',
        asin: variant.asin,
        name: variant.name,
        prices,
      });

      // The tab went away (closed or navigated), so nobody is listening.
      // Stop fetching instead of hammering Amazon for a scan no one will
      // see — an abandoned scan can still trip the block threshold and lock
      // the user out of every tab with a site-wide cooldown.
      if (!delivered) {
        aborted = true;
        queue.length = 0;
        return;
      }

      await delay(MIN_DELAY_MS + Math.random() * JITTER_MS);
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, variants.length) }, worker));

  if (isCurrentScan(scanId) && !aborted) {
    // A storage failure here must not suppress the DONE signal — the panel
    // would otherwise sit at "scanning" forever.
    try {
      await clearBlockStreak();
    } catch (err) {
      console.warn('Failed to clear block streak', { error: err?.message });
    }
    await sendToTab(tabId, { type: 'DONE' });
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
