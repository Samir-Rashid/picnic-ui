import "./style.css";
import { createSearchIndex, formatPrice, searchItems } from "./search";
import type { DietaryTag, FilterState, MenuData, MenuItem, SortMode } from "./types";
import { readStateFromUrl, writeStateToUrl } from "./urlState";

const DIETARY_OPTIONS: { tag: DietaryTag; label: string }[] = [
  { tag: "gf", label: "GF" },
  { tag: "vegan", label: "Vegan" },
  { tag: "vegetarian", label: "Vegetarian" },
  { tag: "spicy", label: "Spicy" },
  { tag: "dairy-free", label: "Dairy-free" },
  { tag: "halal", label: "Halal" },
];

const PRICE_PRESETS = [12, 15, 20];

const root = document.querySelector<HTMLDivElement>("#app");
if (!root) {
  throw new Error("Missing #app root");
}
const app: HTMLDivElement = root;

function defaultState(): FilterState {
  const fromUrl = readStateFromUrl();
  return {
    query: fromUrl.query ?? "",
    sort: fromUrl.sort ?? "relevance",
    maxPrice: fromUrl.maxPrice ?? null,
    storeIds: fromUrl.storeIds ?? new Set(),
    dietary: fromUrl.dietary ?? new Set(),
    showUnavailable: fromUrl.showUnavailable ?? false,
  };
}

function hasActiveFilters(state: FilterState): boolean {
  return (
    state.query.trim().length > 0 ||
    state.maxPrice !== null ||
    state.storeIds.size > 0 ||
    state.dietary.size > 0 ||
    state.showUnavailable ||
    state.sort !== "relevance"
  );
}

function statusMessage(state: FilterState, count: number): string {
  const parts: string[] = [];
  if (state.maxPrice !== null) {
    parts.push(`under ${formatPrice(state.maxPrice)}`);
  }
  if (state.query.trim()) {
    parts.push(`for "${state.query.trim()}"`);
  }
  if (parts.length === 0) {
    return `${count} item${count === 1 ? "" : "s"}`;
  }
  return `${count} result${count === 1 ? "" : "s"} ${parts.join(" ")}`;
}

function formatDietaryTag(tag: DietaryTag): string {
  return DIETARY_OPTIONS.find((option) => option.tag === tag)?.label ?? tag;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function escapeAttr(value: string): string {
  return escapeHtml(value);
}

function renderItemRow(item: MenuItem): string {
  const photo = item.photoUrl
    ? `<img class="thumb" src="${escapeAttr(item.photoUrl)}" alt="" loading="lazy" decoding="async" />`
    : `<div class="thumb placeholder">No photo</div>`;

  const storeLogo = item.storeLogo
    ? `<img class="store-logo" src="${escapeAttr(item.storeLogo)}" alt="" loading="lazy" />`
    : "";

  const tags = [
    ...item.dietaryTags.map(
      (tag) => `<span class="tag">${escapeHtml(formatDietaryTag(tag))}</span>`,
    ),
    ...(item.available ? [] : [`<span class="tag warn">Unavailable</span>`]),
  ].join("");

  const description = item.description
    ? `<p class="item-description">${escapeHtml(item.description)}</p>`
    : "";

  return `
    <article class="item-row${item.available ? "" : " unavailable"}">
      ${photo}
      <div class="item-body">
        <h2 class="item-title">${escapeHtml(item.name)}</h2>
        <div class="item-meta">${storeLogo}<span>${escapeHtml(item.storeName)}</span></div>
        ${description}
        ${tags ? `<div class="item-tags">${tags}</div>` : ""}
      </div>
      <div class="item-price">${formatPrice(item.price)}</div>
    </article>
  `;
}

interface UiRefs {
  searchInput: HTMLInputElement;
  sortSelect: HTMLSelectElement;
  maxPriceInput: HTMLInputElement;
  showUnavailableInput: HTMLInputElement;
  statusText: HTMLSpanElement;
  clearButton: HTMLButtonElement;
  resultsEl: HTMLElement;
  dietaryChips: Map<DietaryTag, HTMLButtonElement>;
  pricePresets: Map<number, HTMLButtonElement>;
  storeChips: Map<string, HTMLButtonElement>;
}

function mountShell(data: MenuData): UiRefs {
  const dietaryChips = new Map<DietaryTag, HTMLButtonElement>();
  const pricePresets = new Map<number, HTMLButtonElement>();
  const storeChips = new Map<string, HTMLButtonElement>();

  const dietaryHtml = DIETARY_OPTIONS.map(({ tag, label }) => {
    return `<button type="button" class="chip" data-dietary="${tag}">${label}</button>`;
  }).join("");

  const presetHtml = PRICE_PRESETS.map(
    (preset) =>
      `<button type="button" class="chip" data-preset="${preset}">$${preset}</button>`,
  ).join("");

  const storeHtml = data.stores
    .map(
      (store) =>
        `<button type="button" class="chip store-chip" data-store="${escapeAttr(store.id)}" title="${escapeAttr(store.name)}">${escapeHtml(store.name)}</button>`,
    )
    .join("");

  app.innerHTML = `
    <section class="toolbar">
      <div class="toolbar-section">
        <input
          id="search"
          class="search-input"
          type="search"
          placeholder="Search dishes, ingredients…"
          autocomplete="off"
          spellcheck="false"
        />
      </div>

      <div class="toolbar-section">
        <div class="filter-grid">
          <div class="filter-row">
            <label class="field">
              Sort
              <select id="sort">
                <option value="relevance">Relevance</option>
                <option value="price-asc">Price: low to high</option>
                <option value="price-desc">Price: high to low</option>
                <option value="name">Name</option>
                <option value="restaurant">Restaurant</option>
              </select>
            </label>

            <label class="field">
              Max
              <input id="maxPrice" type="number" min="0" step="1" placeholder="Any" />
            </label>
            ${presetHtml}
          </div>

          <div>
            <div class="chip-group-label">Dietary</div>
            <div class="filter-row">${dietaryHtml}</div>
          </div>

          <div>
            <div class="chip-group-label">Restaurants (${data.stores.length})</div>
            <div class="filter-row store-chips">${storeHtml}</div>
            <div class="store-actions">
              <button type="button" class="text-btn" id="clearStores">Clear</button>
            </div>
          </div>

          <div class="filter-row">
            <label class="checkbox-field">
              <input id="showUnavailable" type="checkbox" />
              Show unavailable
            </label>
          </div>
        </div>
      </div>
    </section>

    <div class="status-bar">
      <span id="statusText"></span>
      <button type="button" class="text-btn" id="clearFilters" hidden>Clear filters</button>
    </div>

    <section class="results" id="results"></section>

    <footer class="page-footer">
      Menu snapshot · ${escapeHtml(data.meta.scrapedAt)} · Not affiliated with Picnic
    </footer>
  `;

  document.querySelectorAll<HTMLButtonElement>("[data-dietary]").forEach((button) => {
    dietaryChips.set(button.dataset.dietary as DietaryTag, button);
  });
  document.querySelectorAll<HTMLButtonElement>("[data-preset]").forEach((button) => {
    pricePresets.set(Number(button.dataset.preset), button);
  });
  document.querySelectorAll<HTMLButtonElement>("[data-store]").forEach((button) => {
    storeChips.set(button.dataset.store!, button);
  });

  return {
    searchInput: document.querySelector("#search")!,
    sortSelect: document.querySelector("#sort")!,
    maxPriceInput: document.querySelector("#maxPrice")!,
    showUnavailableInput: document.querySelector("#showUnavailable")!,
    statusText: document.querySelector("#statusText")!,
    clearButton: document.querySelector("#clearFilters")!,
    resultsEl: document.querySelector("#results")!,
    dietaryChips,
    pricePresets,
    storeChips,
  };
}

function syncControls(state: FilterState, refs: UiRefs): void {
  if (refs.searchInput.value !== state.query) {
    refs.searchInput.value = state.query;
  }
  refs.sortSelect.value = state.sort;
  refs.maxPriceInput.value = state.maxPrice !== null ? String(state.maxPrice) : "";
  refs.showUnavailableInput.checked = state.showUnavailable;

  refs.dietaryChips.forEach((button, tag) => {
    button.classList.toggle("active", state.dietary.has(tag));
  });
  refs.pricePresets.forEach((button, preset) => {
    button.classList.toggle("active", state.maxPrice === preset);
  });
  refs.storeChips.forEach((button, storeId) => {
    button.classList.toggle("active", state.storeIds.has(storeId));
  });

  refs.clearButton.hidden = !hasActiveFilters(state);
}

function updateResults(
  data: MenuData,
  index: ReturnType<typeof createSearchIndex>,
  state: FilterState,
  refs: UiRefs,
): void {
  const results = searchItems(data, index, state);
  writeStateToUrl(state);

  refs.statusText.textContent = statusMessage(state, results.length);
  syncControls(state, refs);

  if (results.length === 0) {
    refs.resultsEl.innerHTML =
      `<div class="empty">No items match these filters. Try raising the max price or clearing filters.</div>`;
    return;
  }

  refs.resultsEl.innerHTML = results.map(({ item }) => renderItemRow(item)).join("");
}

async function init(): Promise<void> {
  const response = await fetch(`${import.meta.env.BASE_URL}menu.json`);
  if (!response.ok) {
    throw new Error("Failed to load menu.json");
  }
  const data = (await response.json()) as MenuData;
  const index = createSearchIndex(data.items);
  let state = defaultState();
  const refs = mountShell(data);

  const refresh = () => updateResults(data, index, state, refs);

  refs.searchInput.addEventListener("input", () => {
    state = { ...state, query: refs.searchInput.value };
    refresh();
  });

  refs.sortSelect.addEventListener("change", () => {
    state = { ...state, sort: refs.sortSelect.value as SortMode };
    refresh();
  });

  refs.maxPriceInput.addEventListener("input", () => {
    const raw = refs.maxPriceInput.value.trim();
    state = { ...state, maxPrice: raw ? Number(raw) : null };
    refresh();
  });

  refs.showUnavailableInput.addEventListener("change", () => {
    state = { ...state, showUnavailable: refs.showUnavailableInput.checked };
    refresh();
  });

  refs.clearButton.addEventListener("click", () => {
    state = {
      ...defaultState(),
      query: "",
      sort: "relevance",
      maxPrice: null,
      storeIds: new Set(),
      dietary: new Set(),
      showUnavailable: false,
    };
    refresh();
    refs.searchInput.focus();
  });

  refs.dietaryChips.forEach((button, tag) => {
    button.addEventListener("click", () => {
      const next = new Set(state.dietary);
      if (next.has(tag)) {
        next.delete(tag);
      } else {
        next.add(tag);
      }
      state = { ...state, dietary: next };
      refresh();
    });
  });

  refs.pricePresets.forEach((button, preset) => {
    button.addEventListener("click", () => {
      state = {
        ...state,
        maxPrice: state.maxPrice === preset ? null : preset,
      };
      refresh();
    });
  });

  refs.storeChips.forEach((button, storeId) => {
    button.addEventListener("click", () => {
      const next = new Set(state.storeIds);
      if (next.has(storeId)) {
        next.delete(storeId);
      } else {
        next.add(storeId);
      }
      state = { ...state, storeIds: next };
      refresh();
    });
  });

  document.querySelector("#clearStores")!.addEventListener("click", () => {
    state = { ...state, storeIds: new Set() };
    refresh();
  });

  document.addEventListener("keydown", (event) => {
    const target = event.target as HTMLElement | null;
    const typingInField =
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target instanceof HTMLSelectElement;

    if (event.key === "/" && !typingInField) {
      event.preventDefault();
      refs.searchInput.focus();
    }
    if (event.key === "Escape" && !typingInField) {
      state = { ...state, query: "" };
      refresh();
    }
  });

  refresh();
}

init().catch((error) => {
  app.innerHTML = `<div class="empty">Failed to load menu data. Run the index build first.</div>`;
  console.error(error);
});