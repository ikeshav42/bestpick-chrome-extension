(function () {
  const VARIANT_SELECTOR = 'li[data-asin]';

  function extractVariants() {
    const seen = new Set();
    const variants = [];

    document.querySelectorAll(VARIANT_SELECTOR).forEach((li) => {
      const asin = li.getAttribute('data-asin');
      if (!asin || seen.has(asin)) return;
      seen.add(asin);

      // Color/style swatches carry a title or an <img alt>. Size/dimension
      // swatches (e.g. "5.9 x 3.2 x 6 inches (Pack of 10)") are text-only —
      // Amazon renders their label into this nested span instead.
      const name =
        li.getAttribute('title') ||
        li.querySelector('img')?.alt ||
        li.querySelector('.swatch-title-text-display')?.textContent?.trim() ||
        'Unknown';
      variants.push({ asin, name });
    });

    return variants;
  }

  // Extracts one JSON value (object or array) starting right after `"key" :`
  // in a blob of JS source, using bracket-depth counting that respects
  // string literals — safer than a lazy regex against nested structures.
  function extractJsonValue(text, keyPattern) {
    const keyIdx = text.indexOf(keyPattern);
    if (keyIdx === -1) return null;
    const colonIdx = text.indexOf(':', keyIdx + keyPattern.length);
    if (colonIdx === -1) return null;

    let i = colonIdx + 1;
    while (i < text.length && /\s/.test(text[i])) i++;
    const openChar = text[i];
    if (openChar !== '{' && openChar !== '[') return null;
    const closeChar = openChar === '{' ? '}' : ']';

    const start = i;
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (; i < text.length; i++) {
      const ch = text[i];
      if (inString) {
        if (escaped) escaped = false;
        else if (ch === '\\') escaped = true;
        else if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') inString = true;
      else if (ch === openChar) depth++;
      else if (ch === closeChar) {
        depth--;
        if (depth === 0) {
          i++;
          break;
        }
      }
    }

    try {
      return JSON.parse(text.slice(start, i));
    } catch {
      return null;
    }
  }

  // Amazon embeds the full variant matrix (every dimension × every ASIN,
  // e.g. every Size × Color combination) in a script registered under the
  // module name 'twister-js-init-dpx-data' — present across very different
  // page templates (tested against single- and multi-dimension listings).
  // This is the only way to see dimensions like Size that aren't exposed as
  // individually clickable swatches with their own data-asin in the DOM.
  function extractVariantDimensions() {
    const scripts = document.querySelectorAll('script');
    for (const script of scripts) {
      const text = script.textContent;
      if (!text || !text.includes("P.register('twister-js-init-dpx-data'")) continue;

      const dimensions = extractJsonValue(text, '"dimensions"');
      const labels = extractJsonValue(text, '"variationDisplayLabels"');
      const valuesByAsin = extractJsonValue(text, '"dimensionValuesDisplayData"');
      const currentAsinMatch = text.match(/"currentAsin"\s*:\s*"([A-Z0-9]+)"/);

      if (!Array.isArray(dimensions) || dimensions.length < 2 || !labels || !valuesByAsin) {
        // Only worth using when there's more than one dimension — a single
        // dimension is already fully covered by the swatch scrape above.
        continue;
      }

      return {
        dimensions,
        labels,
        valuesByAsin,
        currentAsin: currentAsinMatch ? currentAsinMatch[1] : null,
      };
    }
    return null;
  }

  function injectScanButton(variants, dimensionData) {
    const button = document.createElement('button');
    button.id = 'abps-scan-button';
    button.textContent = variants.length ? 'Scan Prices' : 'No variants detected';
    button.disabled = variants.length === 0;
    button.title = variants.length
      ? `Scan ${variants.length} variants for the best price`
      : 'No variant swatches detected on this page';

    button.addEventListener('click', () => {
      window.__abpsOpenPanel?.(variants, dimensionData);
    });

    document.body.appendChild(button);
  }

  async function injectPanel() {
    const url = chrome.runtime.getURL('panel/panel.html');
    const html = await (await fetch(url)).text();

    const container = document.createElement('div');
    container.id = 'abps-panel-root';
    container.style.display = 'none';
    container.innerHTML = html;

    document.body.appendChild(container);
  }

  chrome.runtime.onMessage.addListener((message) => {
    window.__abpsHandleMessage?.(message);
  });

  async function init() {
    injectScanButton(extractVariants(), extractVariantDimensions());
    await injectPanel();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
