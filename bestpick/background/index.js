import { nextScanId, handleScanRequest } from './scanner.js';

chrome.runtime.onMessage.addListener((message, sender) => {
  if (message?.type !== 'SCAN') return;
  const tabId = sender.tab?.id;
  if (tabId == null) return;

  const scanId = nextScanId();
  // The scan runs in the background and reports back over chrome.tabs, so
  // nothing awaits this promise — catch here to keep a failure from surfacing
  // as an unhandled rejection in the service worker.
  handleScanRequest(message.variants, tabId, scanId).catch((err) => {
    console.warn('Scan failed', { tabId, scanId, error: err?.message });
  });
});
