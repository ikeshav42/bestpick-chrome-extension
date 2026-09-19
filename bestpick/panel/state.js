// Shared namespace for the panel's scripts. They're declared as separate
// files in manifest.json's content_scripts (no bundler here), so they run
// in one shared isolated-world scope and hand things to each other through
// this object instead of ES module imports, which content scripts can't use.
window.BestPick = window.BestPick || {};

(function (BestPick) {
  BestPick.CONDITION_LABELS = {
    new: 'New',
    like_new: 'Used — Like New',
    very_good: 'Used — Very Good',
    good: 'Used — Good',
    acceptable: 'Used — Acceptable',
  };
  BestPick.CONDITION_KEYS = Object.keys(BestPick.CONDITION_LABELS);

  BestPick.state = {
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

  BestPick.el = function el(id) {
    return document.getElementById(id);
  };

  // Best { price, variantName } seen so far for one condition, or null.
  BestPick.bestForCondition = function bestForCondition(condition) {
    let best = null;
    for (const result of Object.values(BestPick.state.results)) {
      const entry = result.prices[condition];
      if (entry && (!best || entry.price < best.price)) {
        best = { price: entry.price, variantName: result.name };
      }
    }
    return best;
  };

  BestPick.overallBest = function overallBest() {
    let best = null;
    for (const condition of BestPick.CONDITION_KEYS) {
      const candidate = BestPick.bestForCondition(condition);
      if (candidate && (!best || candidate.price < best.price)) {
        best = { ...candidate, condition };
      }
    }
    return best;
  };

  BestPick.conditionHasAnyResults = function conditionHasAnyResults(condition) {
    return Object.values(BestPick.state.results).some((r) => r.prices[condition]);
  };

  BestPick.compareRows = function compareRows(a, b, sortBy) {
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
  };

  BestPick.escapeHtml = function escapeHtml(str) {
    return str.replace(
      /[&<>"']/g,
      (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
    );
  };
})(window.BestPick);
