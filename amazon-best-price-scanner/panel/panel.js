(function () {
  const CONDITION_LABELS = {
    new: 'New',
    like_new: 'Used — Like New',
    very_good: 'Used — Very Good',
    good: 'Used — Good',
    acceptable: 'Used — Acceptable',
  };

  const state = {
    variants: [],
    results: {}, // asin -> { name, prices }
    activeCondition: 'very_good',
    scanned: 0,
    total: 0,
    scanning: false,
  };

  let eventsBound = false;

  function el(id) {
    return document.getElementById(id);
  }

  function openPanel(variants) {
    state.variants = variants;
    state.results = {};
    state.scanned = 0;
    state.total = variants.length;
    state.scanning = true;

    const root = el('abps-panel-root');
    if (root) root.style.display = 'block';

    bindPanelEvents();
    updateProgress();
    renderTable();

    chrome.runtime.sendMessage({ type: 'SCAN', variants });
  }

  function bindPanelEvents() {
    if (eventsBound) return;
    eventsBound = true;

    el('abps-close').addEventListener('click', () => {
      el('abps-panel-root').style.display = 'none';
    });

    el('abps-scan-again').addEventListener('click', () => {
      if (state.scanning) return;
      openPanel(state.variants);
    });

    document.querySelectorAll('.abps-tab').forEach((tab) => {
      tab.addEventListener('click', () => {
        state.activeCondition = tab.dataset.condition;
        renderTable();
      });
    });

    makeDraggable(el('abps-panel'), el('abps-drag-handle'));
  }

  function makeDraggable(panelEl, handleEl) {
    let dragging = false;
    let offsetX = 0;
    let offsetY = 0;

    handleEl.addEventListener('mousedown', (e) => {
      dragging = true;
      const rect = panelEl.getBoundingClientRect();
      offsetX = e.clientX - rect.left;
      offsetY = e.clientY - rect.top;
    });

    document.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      panelEl.style.left = `${e.clientX - offsetX}px`;
      panelEl.style.top = `${e.clientY - offsetY}px`;
      panelEl.style.right = 'auto';
    });

    document.addEventListener('mouseup', () => {
      dragging = false;
    });
  }

  function handleMessage(message) {
    if (message.type === 'RESULT') {
      state.results[message.asin] = { name: message.name, prices: message.prices };
      state.scanned += 1;
      updateProgress();
      renderTable();
    } else if (message.type === 'DONE') {
      state.scanning = false;
      updateProgress();
    }
  }

  function updateProgress() {
    const wrap = el('abps-progress-wrap');
    if (!wrap) return;

    if (state.scanning) {
      wrap.hidden = false;
      const pct = state.total ? Math.round((state.scanned / state.total) * 100) : 0;
      el('abps-progress-fill').style.width = `${pct}%`;
      el('abps-progress-label').textContent = `Fetching: ${state.scanned} / ${state.total}`;
    } else {
      wrap.hidden = true;
    }
  }

  function conditionHasAnyResults(condition) {
    return Object.values(state.results).some((r) => r.prices[condition]);
  }

  function renderTable() {
    const tbody = el('abps-tbody');
    const status = el('abps-status');
    if (!tbody) return;

    document.querySelectorAll('.abps-tab').forEach((tab) => {
      const condition = tab.dataset.condition;
      tab.classList.toggle('active', condition === state.activeCondition);
      const doneScanning = state.scanned === state.total && !state.scanning;
      tab.classList.toggle('empty', doneScanning && !conditionHasAnyResults(condition));
    });

    const rows = state.variants.map((variant) => {
      const result = state.results[variant.asin];
      const entry = result?.prices?.[state.activeCondition];
      return {
        asin: variant.asin,
        name: result?.name || variant.name,
        price: entry ? entry.price : null,
        pending: !result,
      };
    });

    rows.sort((a, b) => {
      if (a.price == null && b.price == null) return 0;
      if (a.price == null) return 1;
      if (b.price == null) return -1;
      return a.price - b.price;
    });

    const cheapest = rows.find((r) => r.price != null)?.price;

    tbody.innerHTML = rows
      .map((row) => {
        const priceLabel = row.pending ? '…' : row.price != null ? `$${row.price.toFixed(2)}` : '—';
        const isBest = row.price != null && row.price === cheapest;
        const rowClass = row.price == null && !row.pending ? 'abps-dim' : '';
        const url = `https://www.amazon.com/gp/offer-listing/${row.asin}`;
        const link =
          row.price != null
            ? `<a href="${url}" target="_blank" rel="noopener">View</a>`
            : row.pending
            ? ''
            : '(none)';

        return `
          <tr class="${rowClass}">
            <td>${isBest ? '★ ' : ''}${escapeHtml(row.name)}</td>
            <td>${priceLabel}</td>
            <td>${link}</td>
          </tr>`;
      })
      .join('');

    status.textContent = `Showing: ${CONDITION_LABELS[state.activeCondition]} — ${state.total} variants`;
  }

  function escapeHtml(str) {
    return str.replace(
      /[&<>"']/g,
      (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
    );
  }

  window.__abpsOpenPanel = openPanel;
  window.__abpsHandleMessage = handleMessage;
})();
