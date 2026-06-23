import MiniSearch from "minisearch";
import type { FilterState, MenuData, MenuItem, ScoredItem, SortMode } from "./types";

export function createSearchIndex(items: MenuItem[]): MiniSearch<MenuItem> {
  const index = new MiniSearch<MenuItem>({
    fields: ["name", "description", "storeName", "searchText"],
    storeFields: [
      "id",
      "name",
      "description",
      "price",
      "storeId",
      "storeName",
      "storeLogo",
      "photoUrl",
      "available",
      "dietaryTags",
      "searchText",
    ],
    searchOptions: {
      boost: { name: 3, storeName: 2, description: 1 },
      fuzzy: 0.2,
      prefix: true,
    },
  });
  index.addAll(items);
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

function compareItems(a: MenuItem, b: MenuItem, sort: SortMode): number {
  switch (sort) {
    case "price-asc":
      return (a.price ?? Number.POSITIVE_INFINITY) - (b.price ?? Number.POSITIVE_INFINITY);
    case "price-desc":
      return (b.price ?? Number.NEGATIVE_INFINITY) - (a.price ?? Number.NEGATIVE_INFINITY);
    case "name":
      return a.name.localeCompare(b.name);
    case "restaurant":
      return (
        a.storeName.localeCompare(b.storeName) || a.name.localeCompare(b.name)
      );
    default:
      return 0;
  }
}

export function searchItems(
  data: MenuData,
  index: MiniSearch<MenuItem>,
  state: FilterState,
): ScoredItem[] {
  const query = state.query.trim();
  let results: ScoredItem[];

  if (query) {
    const hits = index.search(query);
    results = hits
      .map((hit) => ({
        item: hit as unknown as MenuItem,
        score: hit.score,
      }))
      .filter(({ item }) => passesFilters(item, state));
  } else {
    results = data.items
      .filter((item) => passesFilters(item, state))
      .map((item) => ({ item, score: 0 }));
  }

  const sort = query ? state.sort : state.sort === "relevance" ? "name" : state.sort;
  if (sort === "relevance") {
    results.sort((a, b) => b.score - a.score || compareItems(a.item, b.item, "name"));
  } else {
    results.sort((a, b) => compareItems(a.item, b.item, sort));
  }

  return results;
}

export function formatPrice(price: number | null): string {
  if (price === null) {
    return "—";
  }
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: price % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(price);
}