(function (BestPick) {
  const {
    state,
    el,
    CONDITION_LABELS,
    bestForCondition,
    overallBest,
    conditionHasAnyResults,
    compareRows,
    escapeHtml,
    getPackInfo,
    distinctDimensionValues,
    computeFilteredVariants,
    MAX_SCAN_VARIANTS,
  } = BestPick;

  function packLabel(info) {
    return `${info.qty}-pack · $${info.perUnit.toFixed(2)}/unit`;
  }

  let hideProgressTimer = null;
  let blockedCountdownTimer = null;

  BestPick.applyView = function applyView() {
    el('abps-filters').hidden = state.view !== 'filters';
    el('abps-summary').hidden = state.view !== 'summary';
    el('abps-detail').hidden = state.view !== 'detail';
    el('abps-back-to-filters').hidden = !state.dimensionData;
  };

  BestPick.renderFilters = function renderFilters() {
    const container = el('abps-filter-fields');
    if (!container || !state.dimensionData) return;

    const { dimensions, labels } = state.dimensionData;

    container.innerHTML = dimensions
      .map((dim, i) => {
        const values = distinctDimensionValues(state.dimensionData, i);
        const selected = state.filters[dim] || 'ANY';
        const options = ['ANY', ...values]
          .map((v) => {
            const label = v === 'ANY' ? 'Any' : v;
            const isSelected = v === selected ? ' selected' : '';
            return `<option value="${escapeHtml(v)}"${isSelected}>${escapeHtml(label)}</option>`;
          })
          .join('');
        return `
          <div class="abps-filter-field" data-dim="${escapeHtml(dim)}">
            <label>${escapeHtml(labels[dim] || dim)}</label>
            <select>${options}</select>
          </div>`;
      })
      .join('');

    updateFilterWarning();
  };

  function updateFilterWarning() {
    const warning = el('abps-filter-warning');
    const scanBtn = el('abps-filter-scan');
    if (!warning || !state.dimensionData) return;

    const matches = computeFilteredVariants(state.dimensionData, state.filters);
    if (matches.length > MAX_SCAN_VARIANTS) {
      warning.hidden = false;
      warning.textContent = `${matches.length} combinations match — narrow at least one more filter (max ${MAX_SCAN_VARIANTS} per scan).`;
      scanBtn.disabled = true;
    } else if (matches.length === 0) {
      warning.hidden = false;
      warning.textContent = 'No combinations match this selection.';
      scanBtn.disabled = true;
    } else {
      warning.hidden = true;
      scanBtn.disabled = false;
      scanBtn.textContent = `Scan ${matches.length} ${matches.length === 1 ? 'option' : 'options'}`;
    }
  }

  BestPick.updateFilterWarning = updateFilterWarning;

  BestPick.updateProgress = function updateProgress() {
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
  };

  BestPick.showBlockedBanner = function showBlockedBanner(retryAt) {
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
  };

  BestPick.hideBlockedBanner = function hideBlockedBanner() {
    clearInterval(blockedCountdownTimer);
    const banner = el('abps-blocked-banner');
    if (banner) banner.hidden = true;
    const rescanBtn = el('abps-scan-again');
    if (rescanBtn) rescanBtn.disabled = false;
  };

  BestPick.renderSummary = function renderSummary() {
    const heroPrice = el('abps-hero-price');
    const heroMeta = el('abps-hero-meta');
    if (!heroPrice) return;

    const heroPack = el('abps-hero-pack');
    const best = overallBest();
    if (best) {
      heroPrice.textContent = `$${best.price.toFixed(2)}`;
      heroMeta.textContent = `${best.variantName} — ${CONDITION_LABELS[best.condition]}`;

      const pack = getPackInfo(best.price, best.variantName);
      heroPack.hidden = !pack;
      if (pack) heroPack.textContent = packLabel(pack);
    } else {
      heroPrice.textContent = '—';
      heroMeta.textContent = state.scanning ? 'Scanning…' : 'No offers found';
      heroPack.hidden = true;
    }

    document.querySelectorAll('#abps-cards .abps-card').forEach((card) => {
      const condition = card.dataset.condition;
      const priceEl = card.querySelector('[data-role="price"]');
      const packEl = card.querySelector('[data-role="pack"]');
      const nameEl = card.querySelector('[data-role="name"]');
      const candidate = bestForCondition(condition);

      if (candidate) {
        priceEl.textContent = `$${candidate.price.toFixed(2)}`;
        nameEl.textContent = candidate.variantName;

        const pack = getPackInfo(candidate.price, candidate.variantName);
        packEl.hidden = !pack;
        if (pack) packEl.textContent = packLabel(pack);
      } else {
        priceEl.textContent = '—';
        nameEl.textContent = '';
        packEl.hidden = true;
      }

      const doneScanning = state.scanned === state.total && !state.scanning;
      card.classList.toggle('empty', doneScanning && !candidate);
    });
  };

  BestPick.renderTable = function renderTable() {
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
        const pack = row.price != null ? getPackInfo(row.price, row.name) : null;
        const packBadge = pack ? `<div class="abps-pack-badge">${escapeHtml(packLabel(pack))}</div>` : '';
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
            <td>${priceLabel}${packBadge}</td>
            <td>${link}</td>
          </tr>`;
      })
      .join('');

    status.textContent = `Showing: ${CONDITION_LABELS[state.activeCondition]} — ${state.total} variants`;
  };
})(window.BestPick);
