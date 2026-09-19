import { nextScanId, handleScanRequest } from './scanner.js';

chrome.runtime.onMessage.addListener((message, sender) => {
  if (message?.type !== 'SCAN') return;
  const tabId = sender.tab?.id;
  if (tabId == null) return;

  const scanId = nextScanId();
  handleScanRequest(message.variants, tabId, scanId);
});
