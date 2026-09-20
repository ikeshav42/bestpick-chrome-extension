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

  // Above this, filtering down to one specific combination before scanning
  // stops being "convenient" and starts being "scan a whole product family,"
  // which is both slow and the kind of request volume that gets a network
  // flagged as a bot — so we require the user to narrow further instead.
  BestPick.MAX_SCAN_VARIANTS = 30;

  BestPick.state = {
    variants: [],
    results: {}, // asin -> { name, prices }
    view: 'summary', // 'filters' | 'summary' | 'detail'
    activeCondition: 'very_good',
    sortBy: 'price_asc',
    scanned: 0,
    total: 0,
    scanning: false,
    blockedUntil: null,
    dimensionData: null, // { dimensions, labels, valuesByAsin, currentAsin } | null
    filters: {}, // dimension key -> selected value, or 'ANY'
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

  // Multi-unit variants ("Pack of 10", "4-Pack", "Set of 3") show up across
  // many listings — comparing their raw price against a single-unit variant
  // is misleading, so callers use this to show a per-unit price alongside it.
  BestPick.extractPackQuantity = function extractPackQuantity(name) {
    const match = name.match(/(?:pack of|set of)\s*(\d+)|(\d+)\s*[- ]?pack\b/i);
    if (!match) return 1;
    const qty = parseInt(match[1] || match[2], 10);
    return qty > 1 ? qty : 1;
  };

  // Returns { qty, perUnit } for a multi-unit variant, or null for a single unit.
  BestPick.getPackInfo = function getPackInfo(price, name) {
    const qty = BestPick.extractPackQuantity(name);
    return qty > 1 ? { qty, perUnit: price / qty } : null;
  };

  // Distinct values for one dimension, in first-seen order, across every
  // ASIN in the discovered variant matrix.
  BestPick.distinctDimensionValues = function distinctDimensionValues(dimensionData, dimIndex) {
    const seen = new Set();
    const values = [];
    for (const dims of Object.values(dimensionData.valuesByAsin)) {
      const v = dims[dimIndex];
      if (v != null && !seen.has(v)) {
        seen.add(v);
        values.push(v);
      }
    }
    return values;
  };

  // ASINs matching the current filter selection ('ANY' or unset matches
  // every value for that dimension), built from the discovered matrix.
  BestPick.computeFilteredVariants = function computeFilteredVariants(dimensionData, filters) {
    const { dimensions, valuesByAsin } = dimensionData;
    const matches = [];
    for (const [asin, values] of Object.entries(valuesByAsin)) {
      const isMatch = dimensions.every((dim, i) => {
        const filterVal = filters[dim];
        return !filterVal || filterVal === 'ANY' || values[i] === filterVal;
      });
      if (isMatch) matches.push({ asin, name: values.join(' / ') });
    }
    return matches;
  };

  BestPick.escapeHtml = function escapeHtml(str) {
    return str.replace(
      /[&<>"']/g,
      (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
    );
  };
})(window.BestPick);
