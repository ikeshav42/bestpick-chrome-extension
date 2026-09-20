(function (BestPick) {
  const { state, el, overallBest, applyView, renderTable, computeFilteredVariants } = BestPick;

  let eventsBound = false;

  BestPick.bindPanelEvents = function bindPanelEvents() {
    if (eventsBound) return;
    eventsBound = true;

    el('abps-close').addEventListener('click', () => {
      el('abps-panel-root').style.display = 'none';
    });

    el('abps-scan-again').addEventListener('click', () => {
      if (state.scanning) return;
      BestPick.runScanFor(state.variants);
    });

    el('abps-back').addEventListener('click', () => {
      state.view = 'summary';
      applyView();
    });

    el('abps-back-to-filters').addEventListener('click', () => {
      state.view = 'filters';
      BestPick.renderFilters();
      applyView();
    });

    el('abps-filter-fields').addEventListener('change', (e) => {
      const field = e.target.closest('[data-dim]');
      if (!field) return;
      state.filters[field.dataset.dim] = e.target.value;
      BestPick.updateFilterWarning();
    });

    el('abps-filter-scan').addEventListener('click', () => {
      const variants = computeFilteredVariants(state.dimensionData, state.filters);
      if (!variants.length) return;
      BestPick.runScanFor(variants);
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
  };

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
})(window.BestPick);
