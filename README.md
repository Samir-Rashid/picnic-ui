# picnic-ui

Tools for scraping and exploring Picnic office lunch menus from [order.trypicnic.com](https://order.trypicnic.com).

## How scraping works

Picnic is a React app that talks to a same-origin GraphQL proxy:

`https://order.trypicnic.com/api/picnic/graphql`

Authenticated requests use browser cookies (email OTP login). Your office hub is identified by:

- `hubId`
- `routeId`
- `deliveryWindowStart` / `deliveryWindowEnd`

Scrape flow:

1. `HubsMainContent` — list all restaurants for your hub/route
2. `SearchItemsAndStoresForHub` — collect menu items via wildcard and `a`–`z` searches, then dedupe

The home page only embeds featured items per restaurant. Search is how we collect the full catalog.

## One-time setup

```bash
uv sync
```

## Capture your session

Do this once, or again when cookies expire.

### 1. Log in

Open https://order.trypicnic.com and sign in with your work email.

### 2. Open DevTools

Safari: Develop → Show Web Inspector → Network

Chrome: View → Developer → Developer Tools → Network

### 3. Capture the listing request

1. Filter network requests for `graphql`
2. Reload the store listing page (`/`)
3. Click the successful `HubsMainContent` request to:
   `order.trypicnic.com/api/picnic/graphql?operation=HubsMainContent`
4. Right-click the request → **Copy as cURL**

### 4. Save plain text

Save the copied command as `capture.curl` in the repo root.

Important: the file must be plain UTF-8 text starting with `curl`. If your editor saves gibberish/binary, paste into TextEdit → Format → Make Plain Text, then save again.

### 5. Build config

```bash
uv run python main.py capture capture.curl
```

This writes:

- `config.json` — cookies, hub/route, delivery window, headers
- `captured_hubs_main_content.graphql` — exact query copied from your browser

Both files are gitignored.

### 6. Verify

```bash
uv run python main.py probe
```

You should see your restaurants (for example, 40 stores for a large office hub).

### 7. Scrape

```bash
uv run python main.py scrape
```

## Output

Results land in `data/`:

| File | Contents |
|------|----------|
| `manifest.json` | Store index and total item count |
| `menus/<store_id>.json` | Per-restaurant items, categories, modifier groups |
| `all_items.json` | Combined per-store export |
| `all_items_flat.json` | Deduped flat item list |
| `hubs_main_content.json` | Raw `HubsMainContent` response |

## Manual config

Copy [config.example.json](config.example.json) to `config.json` and fill in values from the `HubsMainContent` request payload in DevTools.

Required fields:

- `cookies`
- `hub_order_constraint.hubId`
- `hub_order_constraint.routeId`
- `hub_order_constraint.deliveryWindowStart`
- `hub_order_constraint.deliveryWindowEnd`
- `headers.application-version`
- `headers.x-client-session-id`

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `capture.curl does not look like plain-text curl` | Re-copy from DevTools and save as plain text |
| `probe` returns 0 stores | Cookies expired — capture a fresh curl |
| Auth / 401 errors | Capture a fresh curl while logged in |
| Missing items for one restaurant | Re-run `scrape`; search uses `*` + `a`–`z` and dedupes |

## Search UI

Static lunch finder in [`web/`](web/) — fuzzy search, max-price filter, restaurant filter, dietary chips, and shareable URL state.

### Build the menu index

After scraping (or whenever `data/` changes):

```bash
uv run python scripts/build_search_index.py
```

Writes `web/public/menu.json` from `data/all_items_flat.json` and `data/manifest.json`.

### Run locally

```bash
cd web
npm install
npm run dev
```

Open the URL Vite prints (usually http://localhost:5173).

### Build static site

```bash
cd web
npm run build
```

Output is in `web/dist/` — upload that folder to any static host (GitHub Pages, Cloudflare Pages, S3, etc.).

### UI features

- Instant fuzzy search across item name, description, and restaurant
- Sort by relevance, price, name, or restaurant
- Max price filter with $12 / $15 / $20 presets
- Restaurant multi-select filter
- Dietary chips (GF, vegan, vegetarian, spicy, etc.)
- Unavailable items hidden by default
- Shareable links via URL query params (`?q=bowl&maxPrice=15`)

Keyboard shortcuts: `/` focuses search, `Esc` clears the query.

## Notes

- Menu content is stable day-to-day; re-run `scrape` then `build_search_index.py` to refresh the UI.
- Do not commit `config.json`, `capture.curl`, or `data/`.
- Delivery window values come from the captured request and should match what you see in the UI.