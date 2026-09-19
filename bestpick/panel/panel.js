(function (BestPick) {
  const { state, el, bindPanelEvents, hideBlockedBanner, updateProgress, renderSummary, renderTable, applyView } =
    BestPick;

  function openPanel(variants) {
    state.variants = variants;
    state.results = {};
    state.view = 'summary';
    state.scanned = 0;
    state.total = variants.length;
    state.scanning = true;
    state.blockedUntil = null;

    const root = el('abps-panel-root');
    if (root) root.style.display = 'block';

    bindPanelEvents();
    hideBlockedBanner();
    updateProgress();
    renderSummary();
    renderTable();
    applyView();

    chrome.runtime.sendMessage({ type: 'SCAN', variants });
  }

  function handleMessage(message) {
    if (message.type === 'RESULT') {
      state.results[message.asin] = { name: message.name, prices: message.prices };
      state.scanned += 1;
      updateProgress();
      renderSummary();
      renderTable();
    } else if (message.type === 'DONE') {
      state.scanning = false;
      updateProgress();
      renderSummary();
      renderTable();
    } else if (message.type === 'BLOCKED') {
      state.scanning = false;
      state.blockedUntil = message.retryAt;
      updateProgress();
      BestPick.showBlockedBanner(message.retryAt);
    }
  }

  // openPanel is on the namespace (not just a local closure) because
  // events.js's re-scan handler calls BestPick.openPanel directly.
  BestPick.openPanel = openPanel;
  BestPick.handleMessage = handleMessage;

  window.__abpsOpenPanel = openPanel;
  window.__abpsHandleMessage = handleMessage;
})(window.BestPick);
