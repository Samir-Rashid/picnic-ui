import MiniSearch from "minisearch";
import type { FilterState, MenuItem, ScoredItem, SortMode } from "./types";

interface SearchDocument {
  id: string;
  name: string;
  description: string;
}

export function createSearchIndex(items: MenuItem[]): MiniSearch<SearchDocument> {
  const index = new MiniSearch<SearchDocument>({
    fields: ["name", "description"],
    storeFields: ["id"],
    searchOptions: {
      boost: { name: 4, description: 1 },
      fuzzy: 0.15,
      prefix: true,
    },
  });
  index.addAll(
    items.map((item) => ({
      id: item.id,
      name: item.name,
      description: item.description,
    })),
  );
  return index;
}

function passesFilters(item: MenuItem, state: FilterState): boolean {
  if (!state.showUnavailable && !item.available) {
    return false;
  }
  if (state.maxPrice !== null && item.price !== null && item.price > state.maxPrice) {
    return false;
  }
  if (state.storeIds.size > 0 && !state.storeIds.has(item.storeId)) {
    return false;
  }
  if (state.dietary.size > 0) {
    const hasAllTags = [...state.dietary].every((tag) => item.dietaryTags.includes(tag));
    if (!hasAllTags) {
      return false;
    }
  }
  return true;
}

function nameMatchBoost(item: MenuItem, query: string): number {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return 0;
  }
  const name = item.name.toLowerCase();
  if (name === normalizedQuery) {
    return 100;
  }
  if (name.startsWith(normalizedQuery)) {
    return 50;
  }
  if (name.includes(normalizedQuery)) {
    return 25;
  }
  const tokens = normalizedQuery.split(/\s+/).filter(Boolean);
  if (tokens.length > 1 && tokens.every((token) => name.includes(token))) {
    return 15;
  }
  return 0;
}

function compareSpecials(a: MenuItem, b: MenuItem): number {
  const aRank = a.special ? (a.specialRank ?? 0) : Number.POSITIVE_INFINITY;
  const bRank = b.special ? (b.specialRank ?? 0) : Number.POSITIVE_INFINITY;
  return aRank - bRank;
}

function isDefaultBrowse(state: FilterState): boolean {
  return !state.query.trim() && state.sort === "relevance";
}

function compareItems(a: MenuItem, b: MenuItem, sort: SortMode): number {
  switch (sort) {
    case "price-asc":
      return (a.price ?? Number.POSITIVE_INFINITY) - (b.price ?? Number.POSITIVE_INFINITY);
    case "price-desc":
      return (b.price ?? Number.NEGATIVE_INFINITY) - (a.price ?? Number.NEGATIVE_INFINITY);
    case "name":
      return a.name.localeCompare(b.name);
    case "restaurant":
      return a.storeName.localeCompare(b.storeName) || a.name.localeCompare(b.name);
    default:
      return 0;
  }
}

export function searchItems(
  itemsById: Map<string, MenuItem>,
  allItems: MenuItem[],
  index: MiniSearch<SearchDocument>,
  state: FilterState,
): ScoredItem[] {
  const query = state.query.trim();
  let results: ScoredItem[];

  if (query) {
    const normalizedQuery = query.toLowerCase();
    const hits = index.search(query);
    results = hits
      .map((hit) => {
        const item = itemsById.get(hit.id);
        if (!item) {
          return null;
        }
        const boost = nameMatchBoost(item, query);
        return {
          item,
          score: hit.score + boost,
          boost,
        };
      })
      .filter((entry): entry is { item: MenuItem; score: number; boost: number } => entry !== null)
      .filter(({ item, score, boost }) => {
        if (!passesFilters(item, state)) {
          return false;
        }
        if (boost > 0) {
          return true;
        }
        if (item.description.toLowerCase().includes(normalizedQuery)) {
          return true;
        }
        return score >= 6;
      })
      .map(({ item, score }) => ({ item, score }));
  } else {
    results = allItems
      .filter((item) => passesFilters(item, state))
      .map((item) => ({ item, score: 0 }));
  }

  if (query && state.sort === "relevance") {
    results.sort((a, b) => b.score - a.score || compareItems(a.item, b.item, "name"));
  } else if (isDefaultBrowse(state)) {
    results.sort(
      (a, b) =>
        compareSpecials(a.item, b.item) || compareItems(a.item, b.item, "name"),
    );
  } else {
    const sort = query || state.sort !== "relevance" ? state.sort : "name";
    const effectiveSort = sort === "relevance" ? "name" : sort;
    results.sort((a, b) => compareItems(a.item, b.item, effectiveSort));
  }

  return results;
}

export function formatPrice(price: number | null): string {
  if (price === null) {
    return "—";
  }
  const rounded = Math.round(price);
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(rounded);
}