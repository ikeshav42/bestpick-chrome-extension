(function () {
  const CONDITION_LABELS = {
    new: 'New',
    like_new: 'Used — Like New',
    very_good: 'Used — Very Good',
    good: 'Used — Good',
    acceptable: 'Used — Acceptable',
  };
  const CONDITION_KEYS = Object.keys(CONDITION_LABELS);

  const state = {
    variants: [],
    results: {}, // asin -> { name, prices }
    view: 'summary', // 'summary' | 'detail'
    activeCondition: 'very_good',
    sortBy: 'price_asc',
    scanned: 0,
    total: 0,
    scanning: false,
    blockedUntil: null,
  };

  let eventsBound = false;
  let hideProgressTimer = null;
  let blockedCountdownTimer = null;

  function el(id) {
    return document.getElementById(id);
  }

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

    el('abps-back').addEventListener('click', () => {
      state.view = 'summary';
      applyView();
    });

    el('abps-hero').addEventListener('click', () => {
      const best = overallBest();
      if (!best) return;
      state.activeCondition = best.condition;
      state.view = 'detail';
      applyView();
      renderTable();
    });

    document.querySelectorAll('#abps-cards .abps-card').forEach((card) => {
      card.addEventListener('click', () => {
        state.activeCondition = card.dataset.condition;
        state.view = 'detail';
        applyView();
        renderTable();
      });
    });

    document.querySelectorAll('#abps-tabs .abps-tab').forEach((tab) => {
      tab.addEventListener('click', () => {
        state.activeCondition = tab.dataset.condition;
        renderTable();
      });
    });

    el('abps-sort').addEventListener('change', (e) => {
      state.sortBy = e.target.value;
      renderTable();
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
      showBlockedBanner(message.retryAt);
    }
  }

  function applyView() {
    el('abps-summary').hidden = state.view !== 'summary';
    el('abps-detail').hidden = state.view !== 'detail';
  }

  function updateProgress() {
    const wrap = el('abps-progress-wrap');
    if (!wrap) return;

    clearTimeout(hideProgressTimer);
    wrap.classList.remove('abps-progress-done');

    if (state.scanning) {
      wrap.hidden = false;
      const pct = state.total ? Math.round((state.scanned / state.total) * 100) : 0;
      el('abps-progress-fill').style.width = `${pct}%`;
      el('abps-progress-label').textContent = `Fetching: ${state.scanned} / ${state.total}`;
      return;
    }

    if (state.blockedUntil || state.total === 0) {
      wrap.hidden = true;
      return;
    }

    // Briefly show a completed state instead of the bar just vanishing.
    wrap.hidden = false;
    wrap.classList.add('abps-progress-done');
    el('abps-progress-fill').style.width = '100%';
    el('abps-progress-label').textContent = `✓ Done — ${state.total} variants`;
    hideProgressTimer = setTimeout(() => {
      wrap.hidden = true;
    }, 2500);
  }

  function showBlockedBanner(retryAt) {
    const banner = el('abps-blocked-banner');
    const rescanBtn = el('abps-scan-again');
    if (!banner) return;

    banner.hidden = false;
    rescanBtn.disabled = true;

    clearInterval(blockedCountdownTimer);
    const tick = () => {
      const remainingMs = retryAt - Date.now();
      if (remainingMs <= 0) {
        el('abps-blocked-text').textContent = 'You can try scanning again now.';
        el('abps-blocked-countdown').textContent = '';
        rescanBtn.disabled = false;
        clearInterval(blockedCountdownTimer);
        return;
      }
      const totalSec = Math.ceil(remainingMs / 1000);
      const mm = String(Math.floor(totalSec / 60)).padStart(2, '0');
      const ss = String(totalSec % 60).padStart(2, '0');
      el('abps-blocked-text').textContent =
        'Amazon is temporarily limiting requests from this network. This wait time is an estimate, not an official figure.';
      el('abps-blocked-countdown').textContent = `Try again in ${mm}:${ss}`;
    };
    tick();
    blockedCountdownTimer = setInterval(tick, 1000);
  }

  function hideBlockedBanner() {
    clearInterval(blockedCountdownTimer);
    const banner = el('abps-blocked-banner');
    if (banner) banner.hidden = true;
    const rescanBtn = el('abps-scan-again');
    if (rescanBtn) rescanBtn.disabled = false;
  }

  // Best { price, variantName, asin } seen so far for one condition, or null.
  function bestForCondition(condition) {
    let best = null;
    for (const result of Object.values(state.results)) {
      const entry = result.prices[condition];
      if (entry && (!best || entry.price < best.price)) {
        best = { price: entry.price, variantName: result.name, asin: null };
      }
    }
    return best;
  }

  function overallBest() {
    let best = null;
    for (const condition of CONDITION_KEYS) {
      const candidate = bestForCondition(condition);
      if (candidate && (!best || candidate.price < best.price)) {
        best = { ...candidate, condition };
      }
    }
    return best;
  }

  function conditionHasAnyResults(condition) {
    return Object.values(state.results).some((r) => r.prices[condition]);
  }

  function renderSummary() {
    const heroPrice = el('abps-hero-price');
    const heroMeta = el('abps-hero-meta');
    if (!heroPrice) return;

    const best = overallBest();
    if (best) {
      heroPrice.textContent = `$${best.price.toFixed(2)}`;
      heroMeta.textContent = `${best.variantName} — ${CONDITION_LABELS[best.condition]}`;
    } else {
      heroPrice.textContent = '—';
      heroMeta.textContent = state.scanning ? 'Scanning…' : 'No offers found';
    }

    document.querySelectorAll('#abps-cards .abps-card').forEach((card) => {
      const condition = card.dataset.condition;
      const priceEl = card.querySelector('[data-role="price"]');
      const nameEl = card.querySelector('[data-role="name"]');
      const candidate = bestForCondition(condition);

      if (candidate) {
        priceEl.textContent = `$${candidate.price.toFixed(2)}`;
        nameEl.textContent = candidate.variantName;
      } else {
        priceEl.textContent = '—';
        nameEl.textContent = '';
      }

      const doneScanning = state.scanned === state.total && !state.scanning;
      card.classList.toggle('empty', doneScanning && !candidate);
    });
  }

  function compareRows(a, b, sortBy) {
    if (a.price == null && b.price == null) return a.name.localeCompare(b.name);
    if (a.price == null) return 1;
    if (b.price == null) return -1;

    switch (sortBy) {
      case 'price_desc':
        return b.price - a.price;
      case 'name_asc':
        return a.name.localeCompare(b.name);
      case 'name_desc':
        return b.name.localeCompare(a.name);
      case 'price_asc':
      default:
        return a.price - b.price;
    }
  }

  function renderTable() {
    const tbody = el('abps-tbody');
    const status = el('abps-status');
    if (!tbody) return;

    document.querySelectorAll('#abps-tabs .abps-tab').forEach((tab) => {
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

    const cheapest = rows.reduce(
      (min, r) => (r.price != null && (min == null || r.price < min) ? r.price : min),
      null
    );

    rows.sort((a, b) => compareRows(a, b, state.sortBy));

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
