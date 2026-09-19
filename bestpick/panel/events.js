(function (BestPick) {
  const { state, el, overallBest, applyView, renderTable } = BestPick;

  let eventsBound = false;

  BestPick.bindPanelEvents = function bindPanelEvents() {
    if (eventsBound) return;
    eventsBound = true;

    el('abps-close').addEventListener('click', () => {
      el('abps-panel-root').style.display = 'none';
    });

    el('abps-scan-again').addEventListener('click', () => {
      if (state.scanning) return;
      BestPick.openPanel(state.variants);
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
