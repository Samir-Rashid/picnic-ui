import type { DietaryTag, FilterState, SortMode } from "./types";

const SORT_MODES: SortMode[] = [
  "relevance",
  "price-asc",
  "price-desc",
  "name",
  "restaurant",
];

const DIETARY_TAGS: DietaryTag[] = [
  "gf",
  "vegan",
  "vegetarian",
  "dairy-free",
  "halal",
  "spicy",
  "keto",
];

export function readStateFromUrl(): Partial<FilterState> {
  const params = new URLSearchParams(window.location.search);
  const partial: Partial<FilterState> = {};

  const query = params.get("q");
  if (query) {
    partial.query = query;
  }

  const sort = params.get("sort");
  if (sort && SORT_MODES.includes(sort as SortMode)) {
    partial.sort = sort as SortMode;
  }

  const maxPrice = params.get("maxPrice");
  if (maxPrice) {
    const parsed = Number(maxPrice);
    if (!Number.isNaN(parsed) && parsed > 0) {
      partial.maxPrice = parsed;
    }
  }

  const stores = params.get("stores");
  if (stores) {
    partial.storeIds = new Set(stores.split(",").filter(Boolean));
  }

  const dietary = params.get("dietary");
  if (dietary) {
    partial.dietary = new Set(
      dietary
        .split(",")
        .filter((tag): tag is DietaryTag => DIETARY_TAGS.includes(tag as DietaryTag)),
    );
  }

  if (params.get("showUnavailable") === "1") {
    partial.showUnavailable = true;
  }

  return partial;
}

export function writeStateToUrl(state: FilterState): void {
  const params = new URLSearchParams();

  if (state.query.trim()) {
    params.set("q", state.query.trim());
  }
  if (state.sort !== "relevance") {
    params.set("sort", state.sort);
  }
  if (state.maxPrice !== null) {
    params.set("maxPrice", String(state.maxPrice));
  }
  if (state.storeIds.size > 0) {
    params.set("stores", [...state.storeIds].sort().join(","));
  }
  if (state.dietary.size > 0) {
    params.set("dietary", [...state.dietary].sort().join(","));
  }
  if (state.showUnavailable) {
    params.set("showUnavailable", "1");
  }

  const next = params.toString();
  const nextUrl = next ? `?${next}` : window.location.pathname;
  const currentUrl = window.location.search
    ? `?${window.location.search.slice(1)}`
    : window.location.pathname;

  if (nextUrl !== currentUrl) {
    window.history.replaceState(null, "", nextUrl);
  }
}