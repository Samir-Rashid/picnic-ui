export type SortMode =
  | "relevance"
  | "price-asc"
  | "price-desc"
  | "name"
  | "restaurant";

export type DietaryTag = "gf" | "vegan" | "vegetarian" | "dairy-free" | "halal" | "spicy" | "keto";

export interface MenuItem {
  id: string;
  name: string;
  description: string;
  price: number | null;
  storeId: string;
  storeName: string;
  storeLogo: string | null;
  photoUrl: string | null;
  available: boolean;
  dietaryTags: DietaryTag[];
  searchText: string;
}

export interface StoreInfo {
  id: string;
  name: string;
  logoUrl: string | null;
}

export interface MenuData {
  meta: {
    itemCount: number;
    storeCount: number;
    availableCount: number;
    scrapedAt: string;
    priceMax: number;
  };
  stores: StoreInfo[];
  items: MenuItem[];
}

export interface FilterState {
  query: string;
  sort: SortMode;
  maxPrice: number | null;
  storeIds: Set<string>;
  dietary: Set<DietaryTag>;
  showUnavailable: boolean;
}

export interface ScoredItem {
  item: MenuItem;
  score: number;
}