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

1. `HubsMainContent` — list all restaurants for your hub/route (store IDs, slugs, facility IDs)
2. `storeContent` — fetch the **full menu** for each restaurant (same API the store page uses)

The home page only embeds a few featured items per restaurant. Per-store `storeContent` is the complete catalog.

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

### 4. Capture a store menu request

1. Open any restaurant page (e.g. Sushi Boat)
2. In Network, find the successful `storeContent` request:
   `order.trypicnic.com/api/picnic/graphql?operation=storeContent`
3. Copy as cURL → save as `capture_store_content.curl`

### 5. Save plain text

Save the copied commands as `capture.curl` and `capture_store_content.curl` in the repo root.

Important: the file must be plain UTF-8 text starting with `curl`. If your editor saves gibberish/binary, paste into TextEdit → Format → Make Plain Text, then save again.

### 6. Build config

```bash
uv run python main.py capture capture.curl
uv run python main.py capture capture_store_content.curl
```

The second command merges into the same `config.json` (updates cookies/headers if newer).

This writes:

- `config.json` — cookies, hub/route, delivery window, headers, store menu defaults
- `captured_hubs_main_content.graphql` — listing query from your browser
- `captured_store_content.graphql` — per-store menu query from your browser

All are gitignored.

### 7. Verify

```bash
uv run python main.py probe
```

You should see your restaurants (for example, 40 stores for a large office hub).

### 8. Scrape

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
| Missing `captured_store_content.graphql` | Capture a `storeContent` curl from any restaurant page |
| Missing items for one restaurant | Re-run `scrape`; each store is fetched via `storeContent` |

## Search UI

Static lunch finder in [`web/`](web/) — fuzzy search, max-price filter, restaurant filter, dietary chips, and shareable URL state.

### Build the menu index

After scraping (or whenever `data/` changes):

```bash
uv run python scripts/build_search_index.py
```

Writes `web/public/menu.json` and `web/public/modifiers.json` from `data/all_items_flat.json` and `data/manifest.json`. Curated lunch picks in [`config/featured_items.json`](config/featured_items.json) are merged by stable Picnic item ID (`special` flag + default sort rank).

### LLM text export

The UI footer link **Download menu for LLM** builds a plain-text export on demand from the loaded `menu.json` (available items only: restaurant, dish name, price, tags, description — no URLs or IDs).

CLI equivalent:

```bash
uv run python scripts/export_llm_menu.py
```

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

### Deploy to GitHub Pages

Pushes to `main` run [`.github/workflows/deploy-pages.yml`](.github/workflows/deploy-pages.yml), which builds `web/` and deploys `web/dist/` via the official GitHub Pages action. You can also trigger it manually from the Actions tab.

One-time repo setup:

1. Settings → Pages → Build and deployment → Source: **GitHub Actions**
2. Commit up-to-date `web/public/menu.json` and `web/public/modifiers.json` (run `build_search_index.py` locally after scraping)

The workflow sets `GH_PAGES_BASE` to `/<repo-name>/` so asset paths work on project pages (`https://<user>.github.io/<repo>/`).

### UI features

- Instant fuzzy search prioritizing dish names over descriptions
- Sticky search bar; filters collapse fluidly on scroll, with a **Filters** toggle when scrolled
- Sort by relevance, price, name, or restaurant
- Max price filter with $12 / $15 / $20 presets (rounded to nearest dollar)
- Searchable restaurant checklist (expand **Restaurants**, filter list, **Clear**)
- Dietary chips (GF, vegan, vegetarian, spicy, dairy-free, halal)
- Unavailable items hidden by default
- Item photos, store logos, and links to Picnic item / restaurant pages
- Modifier options on expandable rows (+ loads `modifiers.json` on demand)
- Progressive results list (loads more as you scroll)
- Light and dark mode via system preference
- Shareable URL state: `q`, `sort`, `maxPrice`, `stores`, `dietary`, `showUnavailable`

Keyboard shortcuts: `/` search, `j`/`k` or arrows navigate, `Enter`/`Space` expand item, `o` open on Picnic, `f` filters (when scrolled), `?` all shortcuts, `Esc` back out stepwise. See **Shortcuts** in the filter panel.

## Notes

- Menu content is stable day-to-day; re-run `scrape` then `build_search_index.py` to refresh the UI.
- Do not commit `config.json`, `capture.curl`, or `data/`.
- Delivery window values come from the captured request and should match what you see in the UI.