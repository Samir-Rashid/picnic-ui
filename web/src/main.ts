import "./style.css";
import { openLlmExport } from "./llmExport";
import { createSearchIndex, formatPrice, searchItems } from "./search";
import type {
  DietaryTag,
  FilterState,
  MenuData,
  MenuItem,
  ModifierGroup,
  ModifierOption,
  ScoredItem,
  SortMode,
} from "./types";
import {
  isTypingInField,
  renderKeyboardHelpPanel,
  syncRowFocus,
} from "./keyboard";
import { ResultsList, type ResultsMountOptions } from "./resultsList";
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

function formatOptionPrice(price: number): string {
  if (price <= 0) {
    return "included";
  }
  return `+${formatPrice(price)}`;
}

function renderItemPrice(item: MenuItem, expanded: boolean): string {
  const amount = formatPrice(item.price);
  if (amount === "—") {
    return `<span class="item-price-amount">${amount}</span>`;
  }

  const hasModifiers = Boolean(item.hasModifiers);
  const toggle = hasModifiers
    ? `<button type="button" class="item-price-toggle" aria-expanded="${expanded ? "true" : "false"}" aria-label="${expanded ? "Hide customization options" : "Show customization options"}"></button>`
    : `<span class="item-price-toggle is-empty" aria-hidden="true"></span>`;

  return `<span class="item-price-amount">${amount}</span>${toggle}`;
}

function renderModifierGroups(groups: ModifierGroup[], depth = 0): string {
  return groups
    .map((group) => {
      const requirement = group.required
        ? group.minChoices === group.maxChoices
          ? `Pick ${group.minChoices}`
          : `Pick ${group.minChoices}–${group.maxChoices}`
        : group.maxChoices > 0
          ? `Up to ${group.maxChoices}`
          : "Optional";
      const options = group.options
        .map((option) => renderModifierOption(option, depth))
        .join("");
      return `
        <section class="modifier-group" style="--modifier-depth: ${depth}">
          <div class="modifier-group-head">
            <span class="modifier-group-name">${escapeHtml(group.name)}</span>
            <span class="modifier-group-rule">${escapeHtml(requirement)}</span>
          </div>
          <ul class="modifier-options">${options}</ul>
        </section>
      `;
    })
    .join("");
}

function renderModifierOption(option: ModifierOption, depth: number): string {
  const nested = option.nested?.length
    ? `<div class="modifier-nested">${renderModifierGroups(option.nested, depth + 1)}</div>`
    : "";
  return `
    <li class="modifier-option">
      <span class="modifier-option-name">${escapeHtml(option.name)}</span>
      <span class="modifier-option-price">${escapeHtml(formatOptionPrice(option.price))}</span>
      ${nested}
    </li>
  `;
}

function renderItemTitle(item: MenuItem): string {
  const name = escapeHtml(item.name);
  if (item.itemUrl) {
    return `<a class="item-link" href="${escapeAttr(item.itemUrl)}" target="_blank" rel="noopener noreferrer" aria-label="${escapeAttr(`${item.name} (opens on Picnic)`)}"><span class="item-link-text">${name}</span><span class="item-link-icon" aria-hidden="true">↗</span></a>`;
  }
  return name;
}

function renderStoreName(item: MenuItem): string {
  const name = escapeHtml(item.storeName);
  if (item.storeUrl) {
    return `<a class="store-link" href="${escapeAttr(item.storeUrl)}" target="_blank" rel="noopener noreferrer">${name}</a>`;
  }
  return `<span>${name}</span>`;
}

function renderItemRow(
  item: MenuItem,
  expanded: boolean,
  focused: boolean,
  modifierGroups?: ModifierGroup[],
): string {
  const hasModifiers = Boolean(item.hasModifiers);
  const photo = item.photoUrl
    ? `<img class="thumb" src="${escapeAttr(item.photoUrl)}" alt="" loading="lazy" decoding="async" />`
    : `<div class="thumb placeholder" aria-hidden="true"></div>`;

  const storeLogo = item.storeLogo
    ? `<img class="store-logo" src="${escapeAttr(item.storeLogo)}" alt="" loading="lazy" />`
    : "";

  const tags = [
    ...(item.special ? [`<span class="tag">Special</span>`] : []),
    ...item.dietaryTags.map(
      (tag) => `<span class="tag">${escapeHtml(formatDietaryTag(tag))}</span>`,
    ),
    ...(item.available ? [] : [`<span class="tag warn">Unavailable</span>`]),
  ].join("");

  const description = item.description
    ? `<p class="item-description">${escapeHtml(item.description)}</p>`
    : "";

  const modifierPanel =
    expanded && hasModifiers && modifierGroups?.length
      ? `<div class="item-modifiers-panel"><div class="item-modifiers">${renderModifierGroups(modifierGroups)}</div></div>`
      : "";

  return `
    <article
      class="item-row${item.available ? "" : " unavailable"}${expanded ? " is-expanded" : ""}${focused ? " is-focused" : ""}${hasModifiers ? " has-modifiers" : ""}${item.itemUrl ? " has-item-link" : ""}"
      data-item-id="${escapeAttr(item.id)}"
      data-has-modifiers="${hasModifiers ? "true" : "false"}"
      ${item.itemUrl ? `data-item-url="${escapeAttr(item.itemUrl)}"` : ""}
      tabindex="${focused ? "0" : "-1"}"
    >
      ${photo}
      <div class="item-body">
        <div class="item-top">
          <div class="item-head">
            <h2 class="item-title">${renderItemTitle(item)}</h2>
            <div class="item-price">${renderItemPrice(item, expanded)}</div>
          </div>
          <div class="item-meta">${storeLogo}${renderStoreName(item)}</div>
        </div>
        ${modifierPanel}
        ${description}
        ${tags ? `<div class="item-tags">${tags}</div>` : ""}
      </div>
    </article>
  `;
}

function updateItemRowExpanded(
  row: HTMLElement,
  expanded: boolean,
  modifierGroups?: ModifierGroup[],
): void {
  row.classList.toggle("is-expanded", expanded);

  const toggle = row.querySelector<HTMLButtonElement>(".item-price-toggle");
  if (toggle) {
    toggle.setAttribute("aria-expanded", expanded ? "true" : "false");
    toggle.setAttribute(
      "aria-label",
      expanded ? "Hide customization options" : "Show customization options",
    );
  }

  const existingPanel = row.querySelector(".item-modifiers-panel");
  if (expanded && modifierGroups?.length) {
    const panelHtml = `<div class="item-modifiers-panel"><div class="item-modifiers">${renderModifierGroups(modifierGroups)}</div></div>`;
    if (existingPanel) {
      existingPanel.outerHTML = panelHtml;
    } else {
      row.querySelector(".item-top")?.insertAdjacentHTML("afterend", panelHtml);
    }
    return;
  }

  existingPanel?.remove();
}

function moveFocusInResults(
  results: ScoredItem[],
  focusedItemId: string | null,
  delta: 1 | -1,
): string | null {
  if (results.length === 0) {
    return null;
  }

  let index = focusedItemId
    ? results.findIndex(({ item }) => item.id === focusedItemId)
    : -1;

  if (index === -1) {
    index = delta === 1 ? 0 : results.length - 1;
  } else {
    index = Math.max(0, Math.min(results.length - 1, index + delta));
  }

  return results[index]?.item.id ?? null;
}

function focusBoundaryInResults(
  results: ScoredItem[],
  position: "first" | "last",
): string | null {
  if (results.length === 0) {
    return null;
  }
  const item = position === "first" ? results[0].item : results[results.length - 1].item;
  return item.id;
}

function storeFilterSummary(state: FilterState): string {
  if (state.storeIds.size === 0) {
    return "All";
  }
  return `${state.storeIds.size} selected`;
}

interface UiRefs {
  toolbar: HTMLElement;
  filtersToggle: HTMLButtonElement;
  storeSummaryMeta: HTMLSpanElement;
  searchInput: HTMLInputElement;
  sortSelect: HTMLSelectElement;
  maxPriceInput: HTMLInputElement;
  showUnavailableInput: HTMLInputElement;
  storeFilterInput: HTMLInputElement;
  statusText: HTMLSpanElement;
  llmExportButton: HTMLButtonElement;
  clearButton: HTMLButtonElement;
  keyboardHelp: HTMLElement;
  keyboardHelpToggle: HTMLButtonElement;
  resultsEl: HTMLElement;
  dietaryChips: Map<DietaryTag, HTMLButtonElement>;
  pricePresets: Map<number, HTMLButtonElement>;
  storeCheckboxes: Map<string, HTMLInputElement>;
  storeOptions: HTMLLabelElement[];
}

function mountShell(data: MenuData): UiRefs {
  const dietaryChips = new Map<DietaryTag, HTMLButtonElement>();
  const pricePresets = new Map<number, HTMLButtonElement>();
  const storeCheckboxes = new Map<string, HTMLInputElement>();

  const dietaryHtml = DIETARY_OPTIONS.map(({ tag, label }) => {
    return `<button type="button" class="chip" data-dietary="${tag}">${label}</button>`;
  }).join("");

  const presetHtml = PRICE_PRESETS.map(
    (preset) =>
      `<button type="button" class="chip" data-preset="${preset}">$${preset}</button>`,
  ).join("");

  const storeHtml = data.stores
    .map(
      (store) => `
        <label class="store-option">
          <input type="checkbox" data-store="${escapeAttr(store.id)}" />
          <span>${escapeHtml(store.name)}</span>
        </label>`,
    )
    .join("");

  app.innerHTML = `
    <section class="toolbar" id="toolbar">
      <div class="toolbar-sticky">
        <div class="toolbar-section toolbar-search">
          <input
            id="search"
            class="search-input"
            type="search"
            placeholder="Search dishes, ingredients…  ( / to focus )"
            autocomplete="off"
            spellcheck="false"
          />
          <button type="button" class="filters-toggle" id="filtersToggle" hidden>Filters</button>
        </div>
      </div>

      <div class="toolbar-filters-wrap">
        <div class="toolbar-section toolbar-filters">
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
              <div class="chip-group-label">Dietary (heuristic)</div>
              <div class="filter-row">${dietaryHtml}</div>
            </div>

            <details class="store-details">
              <summary class="store-summary">
                <span>Restaurants (${data.stores.length})</span>
                <span class="store-summary-meta" id="storeSummaryMeta">All</span>
              </summary>
              <div class="store-details-body">
                <div class="store-filter-row">
                  <input
                    id="storeFilter"
                    class="store-filter-input"
                    type="search"
                    placeholder="Filter restaurants…"
                    autocomplete="off"
                    spellcheck="false"
                  />
                  <button type="button" class="text-btn" id="clearStores">Clear</button>
                </div>
                <div class="store-list">${storeHtml}</div>
              </div>
            </details>

            <div class="filter-row filter-row-spread">
              <label class="checkbox-field">
                <input id="showUnavailable" type="checkbox" />
                Show unavailable
              </label>
              <button type="button" class="text-btn" id="keyboardHelpToggle">
                Shortcuts
              </button>
            </div>
          </div>
        </div>
      </div>
    </section>

    <section class="results-panel">
      <div class="results-header">
        <span id="statusText"></span>
        <div class="results-header-end">
          <p class="results-meta">
            Menu snapshot ${escapeHtml(data.meta.scrapedAt)}
          </p>
          <span class="results-meta-note">Not affiliated with Picnic</span>
          <div class="results-actions">
            <button type="button" class="link-btn" id="llmExport">Download menu for LLM</button>
            <button type="button" class="link-btn" id="clearFilters" hidden>Clear filters</button>
          </div>
        </div>
      </div>
      <div class="results" id="results"></div>
    </section>
    ${renderKeyboardHelpPanel()}
  `;

  document.querySelectorAll<HTMLButtonElement>("[data-dietary]").forEach((button) => {
    dietaryChips.set(button.dataset.dietary as DietaryTag, button);
  });
  document.querySelectorAll<HTMLButtonElement>("[data-preset]").forEach((button) => {
    pricePresets.set(Number(button.dataset.preset), button);
  });
  document.querySelectorAll<HTMLInputElement>("[data-store]").forEach((input) => {
    storeCheckboxes.set(input.dataset.store!, input);
  });

  const storeOptions = [...document.querySelectorAll<HTMLLabelElement>(".store-option")];

  return {
    toolbar: document.querySelector("#toolbar")!,
    filtersToggle: document.querySelector("#filtersToggle")!,
    storeSummaryMeta: document.querySelector("#storeSummaryMeta")!,
    searchInput: document.querySelector("#search")!,
    sortSelect: document.querySelector("#sort")!,
    maxPriceInput: document.querySelector("#maxPrice")!,
    showUnavailableInput: document.querySelector("#showUnavailable")!,
    storeFilterInput: document.querySelector("#storeFilter")!,
    statusText: document.querySelector("#statusText")!,
    llmExportButton: document.querySelector("#llmExport")!,
    clearButton: document.querySelector("#clearFilters")!,
    keyboardHelp: document.querySelector("#keyboardHelp")!,
    keyboardHelpToggle: document.querySelector("#keyboardHelpToggle")!,
    resultsEl: document.querySelector("#results")!,
    dietaryChips,
    pricePresets,
    storeCheckboxes,
    storeOptions,
  };
}

function filterStoreList(refs: UiRefs): void {
  const query = refs.storeFilterInput.value.trim().toLowerCase();
  refs.storeOptions.forEach((option) => {
    const name = option.textContent?.trim().toLowerCase() ?? "";
    option.hidden = query.length > 0 && !name.includes(query);
  });
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
  refs.storeCheckboxes.forEach((input, storeId) => {
    input.checked = state.storeIds.has(storeId);
  });
  refs.storeSummaryMeta.textContent = storeFilterSummary(state);

  refs.clearButton.hidden = !hasActiveFilters(state);
}

function setupScrollCollapse(refs: UiRefs): void {
  const collapseAt = 36;
  const expandAt = 16;
  const transitionMs = 460;
  let filtersCollapsed = window.scrollY > collapseAt;
  let transitionLockUntil = 0;

  const syncFiltersToggleLabel = () => {
    refs.filtersToggle.textContent = refs.toolbar.classList.contains("filters-open")
      ? "Hide"
      : "Filters";
  };

  const applyCollapsedState = (collapsed: boolean) => {
    if (collapsed) {
      refs.toolbar.classList.add("is-scrolled");
      refs.filtersToggle.hidden = false;
      syncFiltersToggleLabel();
      return;
    }

    refs.toolbar.classList.remove("is-scrolled", "filters-open");
    refs.filtersToggle.hidden = true;
    refs.filtersToggle.textContent = "Filters";
  };

  const setFiltersCollapsed = (collapsed: boolean) => {
    if (filtersCollapsed === collapsed) {
      return;
    }
    filtersCollapsed = collapsed;
    if (collapsed) {
      transitionLockUntil = performance.now() + transitionMs;
      refs.toolbar.classList.remove("filters-open");
      window.setTimeout(update, transitionMs + 20);
    } else {
      transitionLockUntil = 0;
    }
    applyCollapsedState(collapsed);
  };

  const update = () => {
    if (performance.now() < transitionLockUntil) {
      return;
    }

    const scrollY = window.scrollY;
    if (filtersCollapsed) {
      if (scrollY <= expandAt) {
        setFiltersCollapsed(false);
      }
      return;
    }

    if (scrollY >= collapseAt) {
      setFiltersCollapsed(true);
    }
  };

  let scrollRaf = 0;
  window.addEventListener(
    "scroll",
    () => {
      if (scrollRaf) {
        return;
      }
      scrollRaf = window.requestAnimationFrame(() => {
        scrollRaf = 0;
        update();
      });
    },
    { passive: true },
  );

  refs.filtersToggle.addEventListener("click", () => {
    transitionLockUntil = performance.now() + transitionMs;
    refs.toolbar.classList.toggle("filters-open");
    syncFiltersToggleLabel();
  });

  applyCollapsedState(filtersCollapsed);
  update();
}

function updateResults(
  itemsById: Map<string, MenuItem>,
  allItems: MenuItem[],
  index: ReturnType<typeof createSearchIndex>,
  state: FilterState,
  refs: UiRefs,
  resultsList: ResultsList,
  mountOptions: ResultsMountOptions,
  expandedItemId: string | null,
  focusedItemId: string | null,
): { focusedItemId: string | null; cachedResults: ScoredItem[] } {
  const results = searchItems(itemsById, allItems, index, state);
  writeStateToUrl(state);

  refs.statusText.textContent = statusMessage(state, results.length);
  syncControls(state, refs);

  if (results.length === 0) {
    resultsList.reset();
    refs.resultsEl.innerHTML = `
      <div class="empty">
        No items found. Try
        <button type="button" class="link-btn" id="emptyClearFilters">clearing filters</button>.
      </div>
    `;
    return { focusedItemId: null, cachedResults: [] };
  }

  const visibleIds = new Set(results.map(({ item }) => item.id));
  const nextFocusedId =
    focusedItemId && visibleIds.has(focusedItemId) ? focusedItemId : null;
  const nextExpandedId =
    expandedItemId && visibleIds.has(expandedItemId) ? expandedItemId : null;

  resultsList.reset();
  resultsList.mount(results, renderItemRow, {
    ...mountOptions,
    expandedItemId: nextExpandedId,
    focusedItemId: nextFocusedId,
  });

  syncRowFocus(refs.resultsEl, nextFocusedId, { scroll: false });
  return { focusedItemId: nextFocusedId, cachedResults: results };
}

async function applyExpandToggle(
  itemId: string,
  refs: UiRefs,
  expandedItemId: string | null,
  getModifiers: (itemId: string) => Promise<ModifierGroup[] | undefined>,
): Promise<string | null> {
  const prevExpanded = expandedItemId;
  const nextExpanded = toggleExpandedItem(itemId, expandedItemId);

  const updateById = async (id: string, expanded: boolean) => {
    const row = refs.resultsEl.querySelector<HTMLElement>(
      `.item-row[data-item-id="${CSS.escape(id)}"]`,
    );
    if (!row) {
      return;
    }
    updateItemRowExpanded(row, expanded, expanded ? await getModifiers(id) : undefined);
  };

  if (prevExpanded && prevExpanded !== nextExpanded) {
    await updateById(prevExpanded, false);
  }
  await updateById(itemId, nextExpanded === itemId);

  return nextExpanded;
}

function toggleExpandedItem(
  itemId: string,
  expandedItemId: string | null,
): string | null {
  return expandedItemId === itemId ? null : itemId;
}

function openFocusedItem(refs: UiRefs, focusedItemId: string | null): void {
  if (!focusedItemId) {
    return;
  }
  const row = refs.resultsEl.querySelector<HTMLElement>(
    `.item-row[data-item-id="${CSS.escape(focusedItemId)}"]`,
  );
  const itemUrl = row?.dataset.itemUrl;
  if (itemUrl) {
    window.open(itemUrl, "_blank", "noopener,noreferrer");
  }
}

function setKeyboardHelpOpen(refs: UiRefs, open: boolean): void {
  refs.keyboardHelp.hidden = !open;
}

async function init(): Promise<void> {
  const response = await fetch(`${import.meta.env.BASE_URL}menu.json`);
  if (!response.ok) {
    throw new Error("Failed to load menu.json");
  }
  const data = (await response.json()) as MenuData;
  const itemsById = new Map(data.items.map((item) => [item.id, item]));
  const index = createSearchIndex(data.items);
  let modifiersById: Record<string, ModifierGroup[]> | null = data.modifiers ?? null;
  let modifiersRequest: Promise<Record<string, ModifierGroup[]>> | null = null;
  let state = defaultState();
  let expandedItemId: string | null = null;
  let focusedItemId: string | null = null;
  let cachedResults: ScoredItem[] = [];
  let filterDebounce: ReturnType<typeof setTimeout> | null = null;
  let refreshRaf = 0;
  const refs = mountShell(data);
  const resultsList = new ResultsList(refs.resultsEl);
  setupScrollCollapse(refs);

  const ensureModifiers = async (): Promise<Record<string, ModifierGroup[]>> => {
    if (modifiersById) {
      return modifiersById;
    }
    if (!modifiersRequest) {
      modifiersRequest = fetch(`${import.meta.env.BASE_URL}modifiers.json`)
        .then((response) => {
          if (!response.ok) {
            throw new Error("Failed to load modifiers.json");
          }
          return response.json() as Promise<Record<string, ModifierGroup[]>>;
        })
        .then((payload) => {
          modifiersById = payload;
          return payload;
        });
    }
    return modifiersRequest;
  };

  const getModifiersSync = (itemId: string): ModifierGroup[] | undefined =>
    modifiersById?.[itemId];

  const getModifiers = async (itemId: string): Promise<ModifierGroup[] | undefined> => {
    const modifiers = await ensureModifiers();
    return modifiers[itemId];
  };

  const mountOptions = (): ResultsMountOptions => ({
    expandedItemId,
    focusedItemId,
    getModifiers: getModifiersSync,
  });

  const remountResults = () => {
    resultsList.mount(cachedResults, renderItemRow, mountOptions());
    syncRowFocus(refs.resultsEl, focusedItemId, { scroll: false });
  };

  refs.llmExportButton.addEventListener("click", () => {
    openLlmExport(data);
  });

  const refresh = () => {
    if (expandedItemId && !cachedResults.some(({ item }) => item.id === expandedItemId)) {
      expandedItemId = null;
    }
    const next = updateResults(
      itemsById,
      data.items,
      index,
      state,
      refs,
      resultsList,
      mountOptions(),
      expandedItemId,
      focusedItemId,
    );
    focusedItemId = next.focusedItemId;
    cachedResults = next.cachedResults;
    if (expandedItemId && !cachedResults.some(({ item }) => item.id === expandedItemId)) {
      expandedItemId = null;
    } else if (expandedItemId && !getModifiersSync(expandedItemId)) {
      void ensureModifiers().then(() => {
        const row = refs.resultsEl.querySelector<HTMLElement>(
          `.item-row[data-item-id="${CSS.escape(expandedItemId!)}"]`,
        );
        const groups = getModifiersSync(expandedItemId!);
        if (row && groups?.length) {
          updateItemRowExpanded(row, true, groups);
        }
      });
    }
  };

  const scheduleRefresh = () => {
    if (refreshRaf) {
      return;
    }
    refreshRaf = window.requestAnimationFrame(() => {
      refreshRaf = 0;
      refresh();
    });
  };

  const focusItem = (itemId: string | null, scroll = true, reveal: "visible" | "all" = "visible") => {
    if (itemId) {
      const changed =
        reveal === "all"
          ? resultsList.revealAll()
          : resultsList.ensureItemVisible(itemId);
      if (changed) {
        remountResults();
      }
    }
    focusedItemId = itemId;
    syncRowFocus(refs.resultsEl, focusedItemId, { scroll });
  };

  refs.keyboardHelpToggle.addEventListener("click", () => {
    setKeyboardHelpOpen(refs, true);
  });

  refs.keyboardHelp.addEventListener("click", (event) => {
    if (event.target === refs.keyboardHelp) {
      setKeyboardHelpOpen(refs, false);
    }
  });

  const clearAllFilters = () => {
    state = {
      ...defaultState(),
      query: "",
      sort: "relevance",
      maxPrice: null,
      storeIds: new Set(),
      dietary: new Set(),
      showUnavailable: false,
    };
    expandedItemId = null;
    focusedItemId = null;
    refresh();
    refs.searchInput.focus();
  };

  refs.resultsEl.addEventListener("click", (event) => {
    const target = event.target as HTMLElement;
    if (target.closest("#emptyClearFilters")) {
      clearAllFilters();
      return;
    }
    if (target.closest("a")) {
      return;
    }

    const toggle = target.closest<HTMLButtonElement>(".item-price-toggle");
    if (toggle) {
      const row = toggle.closest<HTMLElement>(".item-row");
      const itemId = row?.dataset.itemId;
      if (itemId) {
        focusItem(itemId, false);
        void applyExpandToggle(itemId, refs, expandedItemId, getModifiers).then((next) => {
          expandedItemId = next;
        });
      }
      return;
    }

    const row = target.closest<HTMLElement>(".item-row");
    if (row?.dataset.itemId) {
      focusItem(row.dataset.itemId);
    }
  });

  refs.searchInput.addEventListener("input", () => {
    state = { ...state, query: refs.searchInput.value };
    scheduleRefresh();
  });

  refs.sortSelect.addEventListener("change", () => {
    state = { ...state, sort: refs.sortSelect.value as SortMode };
    scheduleRefresh();
  });

  refs.maxPriceInput.addEventListener("input", () => {
    const raw = refs.maxPriceInput.value.trim();
    state = { ...state, maxPrice: raw ? Number(raw) : null };
    if (filterDebounce !== null) {
      clearTimeout(filterDebounce);
    }
    filterDebounce = setTimeout(() => {
      filterDebounce = null;
      scheduleRefresh();
    }, 150);
  });

  refs.showUnavailableInput.addEventListener("change", () => {
    state = { ...state, showUnavailable: refs.showUnavailableInput.checked };
    scheduleRefresh();
  });

  refs.storeFilterInput.addEventListener("input", () => {
    filterStoreList(refs);
  });

  refs.clearButton.addEventListener("click", clearAllFilters);

  refs.dietaryChips.forEach((button, tag) => {
    button.addEventListener("click", () => {
      const next = new Set(state.dietary);
      if (next.has(tag)) {
        next.delete(tag);
      } else {
        next.add(tag);
      }
      state = { ...state, dietary: next };
      scheduleRefresh();
    });
  });

  refs.pricePresets.forEach((button, preset) => {
    button.addEventListener("click", () => {
      state = {
        ...state,
        maxPrice: state.maxPrice === preset ? null : preset,
      };
      scheduleRefresh();
    });
  });

  refs.storeCheckboxes.forEach((input, storeId) => {
    input.addEventListener("change", () => {
      const next = new Set(state.storeIds);
      if (input.checked) {
        next.add(storeId);
      } else {
        next.delete(storeId);
      }
      state = { ...state, storeIds: next };
      scheduleRefresh();
    });
  });

  document.querySelector("#clearStores")!.addEventListener("click", () => {
    state = { ...state, storeIds: new Set() };
    scheduleRefresh();
  });

  document.addEventListener("results:load-more", () => {
    resultsList.loadMore(renderItemRow, mountOptions());
    syncRowFocus(refs.resultsEl, focusedItemId, { scroll: false });
    if (expandedItemId) {
      const row = refs.resultsEl.querySelector<HTMLElement>(
        `.item-row[data-item-id="${CSS.escape(expandedItemId)}"]`,
      );
      if (row?.classList.contains("is-expanded") && !row.querySelector(".item-modifiers-panel")) {
        void getModifiers(expandedItemId).then((groups) => {
          if (groups?.length) {
            updateItemRowExpanded(row, true, groups);
          }
        });
      }
    }
  });

  refs.searchInput.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      refs.searchInput.blur();
      focusItem(focusBoundaryInResults(cachedResults, "first"));
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      refs.searchInput.blur();
    }
  });

  document.addEventListener("keydown", (event) => {
    const target = event.target as HTMLElement | null;
    const typingInField = isTypingInField(target);

    if (event.key === "?" && !typingInField) {
      event.preventDefault();
      setKeyboardHelpOpen(refs, refs.keyboardHelp.hidden);
      return;
    }

    if (!refs.keyboardHelp.hidden && event.key === "Escape") {
      event.preventDefault();
      setKeyboardHelpOpen(refs, false);
      return;
    }

    if (event.key === "/" && !typingInField) {
      event.preventDefault();
      refs.searchInput.focus();
      refs.searchInput.select();
      return;
    }

    if (typingInField) {
      return;
    }

    if (event.key === "j" || event.key === "ArrowDown") {
      event.preventDefault();
      focusItem(moveFocusInResults(cachedResults, focusedItemId, 1));
      return;
    }

    if (event.key === "k" || event.key === "ArrowUp") {
      event.preventDefault();
      focusItem(moveFocusInResults(cachedResults, focusedItemId, -1));
      return;
    }

    if (event.key === "g") {
      event.preventDefault();
      focusItem(focusBoundaryInResults(cachedResults, "first"));
      return;
    }

    if (event.key === "G") {
      event.preventDefault();
      focusItem(focusBoundaryInResults(cachedResults, "last"), true, "all");
      return;
    }

    if (event.key === "f" && !refs.filtersToggle.hidden) {
      event.preventDefault();
      refs.filtersToggle.click();
      return;
    }

    if (event.key === "o") {
      event.preventDefault();
      openFocusedItem(refs, focusedItemId);
      return;
    }

    if (event.key === "Enter" || event.key === " ") {
      const row =
        target?.closest<HTMLElement>(".item-row") ??
        (focusedItemId
          ? refs.resultsEl.querySelector<HTMLElement>(
              `.item-row[data-item-id="${CSS.escape(focusedItemId)}"]`,
            )
          : null);
      if (!row?.dataset.itemId) {
        return;
      }
      event.preventDefault();
      if (row.dataset.hasModifiers === "true") {
        void applyExpandToggle(row.dataset.itemId, refs, expandedItemId, getModifiers).then(
          (next) => {
            expandedItemId = next;
          },
        );
        return;
      }
      if (event.key === "Enter") {
        openFocusedItem(refs, row.dataset.itemId);
      }
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      if (expandedItemId) {
        const collapsedId = expandedItemId;
        expandedItemId = null;
        const row = refs.resultsEl.querySelector<HTMLElement>(
          `.item-row[data-item-id="${CSS.escape(collapsedId)}"]`,
        );
        if (row) {
          updateItemRowExpanded(row, false);
        }
        return;
      }
      if (focusedItemId) {
        focusItem(null);
        return;
      }
      if (state.query.trim()) {
        state = { ...state, query: "" };
        refresh();
        refs.searchInput.focus();
        return;
      }
      if (hasActiveFilters(state)) {
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
      }
    }
  });

  refresh();
}

init().catch((error) => {
  app.innerHTML = `<div class="empty">Failed to load menu data. Run the index build first.</div>`;
  console.error(error);
});