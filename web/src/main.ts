import "./style.css";
import { createSearchIndex, formatPrice, searchItems } from "./search";
import type { DietaryTag, FilterState, MenuData, SortMode } from "./types";
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

function renderCard(item: MenuData["items"][number]): string {
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
    ? `<p class="description">${escapeHtml(item.description)}</p>`
    : "";

  return `
    <article class="card${item.available ? "" : " unavailable"}">
      ${photo}
      <div>
        <div class="card-head">
          <h2>${escapeHtml(item.name)}</h2>
          <div class="price">${formatPrice(item.price)}</div>
        </div>
        <div class="store-line">${storeLogo}<span>${escapeHtml(item.storeName)}</span></div>
        ${description}
        ${tags ? `<div class="tags">${tags}</div>` : ""}
      </div>
    </article>
  `;
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

async function init(): Promise<void> {
  const response = await fetch(`${import.meta.env.BASE_URL}menu.json`);
  if (!response.ok) {
    throw new Error("Failed to load menu.json");
  }
  const data = (await response.json()) as MenuData;
  const index = createSearchIndex(data.items);
  let state = defaultState();

  const render = () => {
    const results = searchItems(data, index, state);
    writeStateToUrl(state);

    const storeOptions = data.stores
      .map((store) => {
        const selected = state.storeIds.has(store.id) ? "selected" : "";
        return `<option value="${escapeAttr(store.id)}" ${selected}>${escapeHtml(store.name)}</option>`;
      })
      .join("");

    const dietaryChips = DIETARY_OPTIONS.map(({ tag, label }) => {
      const active = state.dietary.has(tag) ? "active" : "";
      return `<button type="button" class="chip ${active}" data-dietary="${tag}">${label}</button>`;
    }).join("");

    const pricePresets = PRICE_PRESETS.map((preset) => {
      const active = state.maxPrice === preset ? "active" : "";
      return `<button type="button" class="preset ${active}" data-preset="${preset}">$${preset}</button>`;
    }).join("");

    app.innerHTML = `
      <header class="hero">
        <h1>Picnic Lunch Finder</h1>
        <p>${data.meta.availableCount} available items across ${data.meta.storeCount} restaurants</p>
      </header>

      <section class="panel">
        <div class="search-row">
          <input
            id="search"
            class="search-input"
            type="search"
            placeholder="Search meals, ingredients, restaurants..."
            value="${escapeAttr(state.query)}"
            autocomplete="off"
            spellcheck="false"
          />
        </div>

        <div class="controls">
          <div class="control-row">
            <label class="inline">
              Sort
              <select id="sort">
                <option value="relevance" ${state.sort === "relevance" ? "selected" : ""}>Relevance</option>
                <option value="price-asc" ${state.sort === "price-asc" ? "selected" : ""}>Price: low to high</option>
                <option value="price-desc" ${state.sort === "price-desc" ? "selected" : ""}>Price: high to low</option>
                <option value="name" ${state.sort === "name" ? "selected" : ""}>Name</option>
                <option value="restaurant" ${state.sort === "restaurant" ? "selected" : ""}>Restaurant</option>
              </select>
            </label>

            <label class="inline">
              Max price
              <input
                id="maxPrice"
                class="price-input"
                type="number"
                min="0"
                step="0.5"
                placeholder="Any"
                value="${state.maxPrice ?? ""}"
              />
            </label>
            ${pricePresets}
          </div>

          <div class="control-row">
            ${dietaryChips}
          </div>

          <div class="control-row">
            <select id="stores" class="store-filter" multiple size="4" aria-label="Filter restaurants">
              ${storeOptions}
            </select>
            <label class="inline">
              <input id="showUnavailable" type="checkbox" ${state.showUnavailable ? "checked" : ""} />
              Show unavailable
            </label>
          </div>
        </div>
      </section>

      <div class="status-bar">
        <span>${statusMessage(state, results.length)}</span>
        ${
          hasActiveFilters(state)
            ? `<button type="button" class="clear-btn" id="clearFilters">Clear filters</button>`
            : ""
        }
      </div>

      <section class="results">
        ${
          results.length > 0
            ? results.map(({ item }) => renderCard(item)).join("")
            : `<div class="empty">No items match these filters. Try raising the max price or clearing filters.</div>`
        }
      </section>

      <footer class="footer">
        Menu snapshot · ${escapeHtml(data.meta.scrapedAt)} · Not affiliated with Picnic
      </footer>
    `;

    bindHandlers(render);
  };

  const bindHandlers = (rerender: () => void) => {
    const searchInput = document.querySelector<HTMLInputElement>("#search");
    const sortSelect = document.querySelector<HTMLSelectElement>("#sort");
    const maxPriceInput = document.querySelector<HTMLInputElement>("#maxPrice");
    const storesSelect = document.querySelector<HTMLSelectElement>("#stores");
    const showUnavailableInput = document.querySelector<HTMLInputElement>("#showUnavailable");
    const clearButton = document.querySelector<HTMLButtonElement>("#clearFilters");

    searchInput?.addEventListener("input", () => {
      state = { ...state, query: searchInput.value };
      rerender();
      searchInput.focus();
      const end = searchInput.value.length;
      searchInput.setSelectionRange(end, end);
    });

    sortSelect?.addEventListener("change", () => {
      state = { ...state, sort: sortSelect.value as SortMode };
      rerender();
    });

    maxPriceInput?.addEventListener("input", () => {
      const raw = maxPriceInput.value.trim();
      state = {
        ...state,
        maxPrice: raw ? Number(raw) : null,
      };
      rerender();
    });

    storesSelect?.addEventListener("change", () => {
      const selected = [...storesSelect.selectedOptions].map((option) => option.value);
      state = { ...state, storeIds: new Set(selected) };
      rerender();
    });

    showUnavailableInput?.addEventListener("change", () => {
      state = { ...state, showUnavailable: showUnavailableInput.checked };
      rerender();
    });

    clearButton?.addEventListener("click", () => {
      state = defaultState();
      state = {
        ...state,
        query: "",
        sort: "relevance",
        maxPrice: null,
        storeIds: new Set(),
        dietary: new Set(),
        showUnavailable: false,
      };
      rerender();
    });

    document.querySelectorAll<HTMLButtonElement>("[data-dietary]").forEach((button) => {
      button.addEventListener("click", () => {
        const tag = button.dataset.dietary as DietaryTag;
        const next = new Set(state.dietary);
        if (next.has(tag)) {
          next.delete(tag);
        } else {
          next.add(tag);
        }
        state = { ...state, dietary: next };
        rerender();
      });
    });

    document.querySelectorAll<HTMLButtonElement>("[data-preset]").forEach((button) => {
      button.addEventListener("click", () => {
        const preset = Number(button.dataset.preset);
        state = {
          ...state,
          maxPrice: state.maxPrice === preset ? null : preset,
        };
        rerender();
      });
    });
  };

  document.addEventListener("keydown", (event) => {
    const target = event.target as HTMLElement | null;
    const typingInField =
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target instanceof HTMLSelectElement;

    if (event.key === "/" && !typingInField) {
      event.preventDefault();
      document.querySelector<HTMLInputElement>("#search")?.focus();
    }
    if (event.key === "Escape" && !typingInField) {
      state = { ...state, query: "" };
      render();
    }
  });

  render();
}

init().catch((error) => {
  if (app) {
    app.innerHTML = `<div class="empty">Failed to load menu data. Run the index build first.</div>`;
  }
  console.error(error);
});