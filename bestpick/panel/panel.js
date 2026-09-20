(function (BestPick) {
  const { state, el, bindPanelEvents, hideBlockedBanner, updateProgress, renderSummary, renderTable, applyView } =
    BestPick;

  // Entry point from the page's "Scan Prices" button. When the page has
  // multiple variant dimensions (e.g. Size + Color), we don't know yet
  // which combination the user wants — scanning all of them can mean
  // hundreds of requests (see MAX_SCAN_VARIANTS) — so this opens a filter
  // screen first instead of scanning immediately.
  function openPanel(variants, dimensionData) {
    state.dimensionData = dimensionData || null;

    const root = el('abps-panel-root');
    if (root) root.style.display = 'block';

    bindPanelEvents();
    hideBlockedBanner();

    if (state.dimensionData) {
      initFiltersFromCurrentAsin();
      state.view = 'filters';
      BestPick.renderFilters();
      applyView();
      return;
    }

    runScanFor(variants);
  }

  function initFiltersFromCurrentAsin() {
    const { dimensions, valuesByAsin, currentAsin } = state.dimensionData;
    const currentValues = currentAsin ? valuesByAsin[currentAsin] : null;
    state.filters = {};
    dimensions.forEach((dim, i) => {
      state.filters[dim] = currentValues ? currentValues[i] : 'ANY';
    });
  }

  // Starts (or restarts) an actual price scan for a concrete variant list —
  // either the page's own swatch list (no multi-dimension data found), or
  // the subset the user picked via the filter screen.
  function runScanFor(variants) {
    state.variants = variants;
    state.results = {};
    state.view = 'summary';
    state.scanned = 0;
    state.total = variants.length;
    state.scanning = true;
    state.blockedUntil = null;

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

  // These are on the namespace (not just local closures) because events.js
  // calls them directly for re-scan, the filter "Scan" button, etc.
  BestPick.openPanel = openPanel;
  BestPick.runScanFor = runScanFor;
  BestPick.handleMessage = handleMessage;

  window.__abpsOpenPanel = openPanel;
  window.__abpsHandleMessage = handleMessage;
})(window.BestPick);
