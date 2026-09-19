(function () {
  const VARIANT_SELECTOR = 'li[data-asin]';

  function extractVariants() {
    const seen = new Set();
    const variants = [];

    document.querySelectorAll(VARIANT_SELECTOR).forEach((li) => {
      const asin = li.getAttribute('data-asin');
      if (!asin || seen.has(asin)) return;
      seen.add(asin);

      const name = li.getAttribute('title') || li.querySelector('img')?.alt || 'Unknown';
      variants.push({ asin, name });
    });

    return variants;
  }

  function injectScanButton(variants) {
    const button = document.createElement('button');
    button.id = 'abps-scan-button';
    button.textContent = variants.length ? 'Scan Prices' : 'No variants detected';
    button.disabled = variants.length === 0;
    button.title = variants.length
      ? `Scan ${variants.length} variants for the best price`
      : 'No variant swatches detected on this page';

    button.addEventListener('click', () => {
      window.__abpsOpenPanel?.(variants);
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
    injectScanButton(extractVariants());
    await injectPanel();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
