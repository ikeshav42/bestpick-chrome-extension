# Amazon Best Price Scanner — Chrome Extension Plan

## Concept

A Chrome extension that scans every variant of an Amazon product and finds the **best price per condition** across all of them. The user picks their preferred condition (New, Used Like New, Used Very Good, etc.) and instantly sees which variant gives them that condition at the lowest price.

---

## What It Looks Like

When the user opens the panel on any Amazon product page with variants, they see:

```
┌─────────────────────────────────────────────────────┐
│  Amazon Best Price Scanner          [Scan] [✕]      │
│                                                     │
│  Condition Filter:                                  │
│  [New] [Like New] [Very Good] [Good] [Acceptable]  │
│         ↑ selected tab highlights                   │
│                                                     │
│  Showing: Used — Very Good          44 variants     │
│  ─────────────────────────────────────────────      │
│  ★ Carbon Fiber Coffee       $11.99   → View        │
│  ★ Lichee Black              $11.99   → View        │
│    Alaska Blue               $13.08   → View        │
│    Carbon Fiber Black        $13.44   → View        │
│    ...                                              │
│    Alaska Cherry             —        (none)        │
│                                                     │
│  Fetching: ████████████░░░░░░░  28 / 44             │
└─────────────────────────────────────────────────────┘
```

---

## Data Model

For each variant, the scanner fetches its offer listing page and extracts **all available conditions**, not just the cheapest used price. The internal data shape per variant:

```json
{
  "asin": "B079DCW7GB",
  "name": "Carbon Fiber Coffee",
  "prices": {
    "new":        { "price": 19.99, "count": 3 },
    "like_new":   { "price": 12.49, "count": 1 },
    "very_good":  { "price": 11.99, "count": 2 },
    "good":       { "price": 10.50, "count": 4 },
    "acceptable": null
  }
}
```

This means scanning once gives the user the full picture — switching condition tabs is instant, no re-fetching needed.

---

## Architecture (Manifest V3)

### `content.js` — Content Script
Runs on `amazon.com/dp/*` pages.

- Extracts all variant ASINs and names from `li[data-asin]` swatches
- Injects the **"Scan Prices"** button into the page
- Injects the panel HTML into the DOM
- Relays messages between the panel and the background worker

### `background.js` — Service Worker
Does all network work off the main thread.

- Receives the ASIN list, fetches `/gp/offer-listing/{ASIN}?condition=used` for each
- Parses the full offer listing DOM — extracts **every condition group**, not just the first price
- Streams structured results back per-variant as they complete
- Respects a 300ms inter-request delay to avoid rate limiting
- Also checks the **new condition** separately via `/gp/offer-listing/{ASIN}?condition=new`
  - OR parses both from the offer listing if Amazon shows all conditions on one page

### `panel.js` + `panel.html` + `panel.css` — UI Panel
A floating, draggable panel injected into the page.

- **Condition tabs** at the top: New | Like New | Very Good | Good | Acceptable
- **Sorted table** under the active tab: cheapest variant first
- Live progress bar during scan; table populates row by row as results arrive
- "No listing" rows pushed to the bottom, dimmed
- Each row has a **→ View** link that navigates to that variant's offer listing

---

## File Structure

```
amazon-best-price-scanner/
├── manifest.json
├── background.js
├── content.js
├── panel/
│   ├── panel.html
│   ├── panel.js
│   └── panel.css
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

---

## `manifest.json`

```json
{
  "manifest_version": 3,
  "name": "Amazon Best Price Scanner",
  "version": "1.0",
  "description": "Find the cheapest variant for any condition across all product variants.",
  "permissions": ["scripting", "storage"],
  "host_permissions": ["https://www.amazon.com/*"],
  "background": {
    "service_worker": "background.js"
  },
  "content_scripts": [
    {
      "matches": ["https://www.amazon.com/dp/*"],
      "js": ["content.js"]
    }
  ]
}
```

---

## Parsing Strategy

### Variant Extraction (content.js)
```js
const variants = Array.from(document.querySelectorAll('li[data-asin]'))
  .map(li => ({
    asin: li.getAttribute('data-asin'),
    name: li.getAttribute('title') || li.querySelector('img')?.alt || 'Unknown'
  }))
  .filter((v, i, arr) => arr.findIndex(x => x.asin === v.asin) === i); // deduplicate
```

### Offer Listing Parsing (background.js)
The offer listing page groups offers by condition. Each group has a header like
`"Used - Like New"` followed by offer rows with prices. Parse all groups in one pass:

```js
function parseAllConditions(doc) {
  const conditions = {};
  const headers = doc.querySelectorAll('.a-section.olp-link h6');  // or similar

  headers.forEach(header => {
    const label = header.textContent.trim();          // "Used - Like New"
    const priceEl = header.closest('.a-section')
                          .querySelector('.olpOfferPrice');
    const price = priceEl ? parseFloat(priceEl.textContent.replace(/[^0-9.]/g, '')) : null;

    if (label.includes('Like New'))   conditions.like_new   = price;
    if (label.includes('Very Good'))  conditions.very_good  = price;
    if (label.includes('Good') && !label.includes('Very')) conditions.good = price;
    if (label.includes('Acceptable')) conditions.acceptable = price;
    if (label.includes('New'))        conditions.new        = price;
  });

  return conditions;
}
```

> **Note:** Amazon's offer listing HTML structure can shift. The parser should be built
> with fallbacks — if the class-based selector fails, fall back to text-pattern matching
> on the full page text.

---

## Message Flow

```
content.js          background.js
    |                     |
    |-- { type: 'SCAN',   |
    |    asins: [...] } ->|
    |                     |-- fetch /offer-listing/ASIN1
    |                     |-- fetch /offer-listing/ASIN2  (after 300ms)
    |                     |   ...
    |<-- { type: 'RESULT',|
    |     asin, name,     |
    |     prices: {...} } |  (one message per variant, streams in)
    |                     |
    |<-- { type: 'DONE' } |
```

The panel updates its table on every `RESULT` message — no waiting for all 44 to finish.

---

## Condition Tab Behavior

| Tab | Shows |
|---|---|
| **New** | Variants with a new third-party offer. Amazon's own "New" listing is on the main page — this catches marketplace new sellers. |
| **Like New** | Used - Like New offers only |
| **Very Good** | Used - Very Good offers only |
| **Good** | Used - Good offers only |
| **Acceptable** | Used - Acceptable offers only |

Switching tabs re-sorts the already-fetched data client-side. Zero additional network requests.

Tabs with **zero results** across all variants are grayed out so the user knows not to bother.

---

## Known Challenges & Solutions

| Challenge | Solution |
|---|---|
| Amazon blocks page-context `fetch()` | Service worker fetch carries real cookies — not blocked |
| Offer listing HTML structure may vary | Class-based parser with text-pattern fallback |
| Duplicate ASINs in swatch list | Deduplicate by ASIN before scanning |
| Some variants have no used listings | Show "—" in table, push to bottom of list |
| Rate limiting from rapid requests | 300ms delay between fetches in background.js |
| No variant swatches on page | Hide the Scan button, show tooltip: "No variants detected" |
| Fetching 44 variants takes ~15–20s | Progressive streaming — table fills live, no waiting |

---

## Loading as Unpacked Extension (Dev)

1. Go to `chrome://extensions`
2. Enable **Developer mode** (toggle, top right)
3. Click **Load unpacked**
4. Select the `amazon-best-price-scanner/` folder
5. Visit any Amazon product page with variants and click **Scan Prices**

---

## v2 Roadmap

- **Session cache** via `chrome.storage.session` — re-opening the panel doesn't re-scan
- **Sort options** — sort by price, by variant name, or by availability count
- **Condition availability count** — show "(3 sellers)" next to each price
- **Multi-domain support** — `.co.uk`, `.ca`, `.de` via configurable host patterns
- **Copy table** — one-click copy results as TSV for pasting into a spreadsheet
- **Price history tooltip** — integrate Keepa API to show 30-day price trend on hover
