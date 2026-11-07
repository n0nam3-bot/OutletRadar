import type { CatalogBrowseProduct } from "@/lib/types";
import type { SizeSystem } from "@/lib/size-match";

/**
 * Saved searches live in the visitor's own browser (localStorage): nothing is sent to or stored on the
 * server, so no account or e-mail address is needed. Each saved search remembers its criteria and the
 * lowest price it saw for every product the last time it was run, so the next run can report price drops.
 */
export type SavedSearch = {
  id: string;
  query: string;
  type: string;
  brand: string;
  gender: string;
  releaseYear: string;
  size: string;
  sizeChoice: "auto" | SizeSystem;
  color: string;
  minPrice: string;
  maxPrice: string;
  saleOnly: boolean;
  createdAt: string;
  lastRunAt?: string;
  /** product key -> lowest relevant price at the last run */
  prices: Record<string, number>;
};

export type SearchCriteria = Omit<SavedSearch, "id" | "createdAt" | "lastRunAt" | "prices">;
export type PriceChange = { key: string; title: string; from: number; to: number };
export type PriceChangeSummary = { drops: PriceChange[]; rises: PriceChange[]; newProducts: number; compared: number };

export const SAVED_SEARCH_KEY = "outlet-radar:saved-searches:v1";
export const MAX_SAVED_SEARCHES = 20;
const MAX_TRACKED_PRODUCTS = 200;

const norm = (value: string) => value.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, " ").trim();

/** Same criteria -> same id, so saving an identical search twice updates it instead of duplicating it. */
export function savedSearchId(criteria: SearchCriteria): string {
  const parts = [criteria.query, criteria.type, criteria.brand, criteria.gender, criteria.releaseYear, criteria.size, criteria.sizeChoice, criteria.color, criteria.minPrice, criteria.maxPrice, criteria.saleOnly ? "sale" : ""];
  const text = parts.map((part) => norm(String(part ?? ""))).join("|");
  let hash = 5381;
  for (let index = 0; index < text.length; index++) hash = ((hash << 5) + hash + text.charCodeAt(index)) >>> 0;
  return `s${hash.toString(36)}`;
}

/** Stable key for a product across runs: style code when known, otherwise brand + title. */
export function productKey(product: Pick<CatalogBrowseProduct, "styleCode" | "brand" | "title">): string {
  return product.styleCode ? `sc:${norm(product.styleCode).replace(/\s+/g, "")}` : `tt:${norm(`${product.brand} ${product.title}`)}`;
}

export function describeSearch(search: SearchCriteria): string {
  const bits = [search.query.trim()];
  if (search.brand && search.brand !== "all") bits.push(search.brand);
  if (search.gender && search.gender !== "all") bits.push(search.gender);
  if (search.releaseYear) bits.push(search.releaseYear);
  if (search.size.trim()) bits.push(`size ${search.size.trim()}`);
  if (search.color.trim()) bits.push(search.color.trim());
  if (search.minPrice || search.maxPrice) bits.push(`$${search.minPrice || "0"}\u2013${search.maxPrice ? `$${search.maxPrice}` : "any"}`);
  if (search.saleOnly) bits.push("sale only");
  return bits.filter(Boolean).join(" \u00b7 ");
}

export function summarizePriceChanges(
  previous: Record<string, number>,
  current: Array<{ key: string; title: string; price: number }>,
): PriceChangeSummary {
  const drops: PriceChange[] = [];
  const rises: PriceChange[] = [];
  let newProducts = 0;
  let compared = 0;
  for (const item of current) {
    const before = previous[item.key];
    if (typeof before !== "number") { newProducts++; continue; }
    compared++;
    if (item.price < before - 0.005) drops.push({ key: item.key, title: item.title, from: before, to: item.price });
    else if (item.price > before + 0.005) rises.push({ key: item.key, title: item.title, from: before, to: item.price });
  }
  drops.sort((a, b) => (b.from - b.to) - (a.from - a.to));
  rises.sort((a, b) => (b.to - b.from) - (a.to - a.from));
  return { drops, rises, newProducts, compared };
}

/** Keeps the cheapest MAX_TRACKED_PRODUCTS entries so one broad search cannot fill browser storage. */
export function priceSnapshot(current: Array<{ key: string; price: number }>): Record<string, number> {
  return Object.fromEntries([...current].sort((a, b) => a.price - b.price).slice(0, MAX_TRACKED_PRODUCTS).map((item) => [item.key, item.price]));
}

type StorageLike = Pick<Storage, "getItem" | "setItem">;

export function loadSavedSearches(storage: StorageLike | null): SavedSearch[] {
  if (!storage) return [];
  try {
    const parsed = JSON.parse(storage.getItem(SAVED_SEARCH_KEY) ?? "[]") as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is SavedSearch => Boolean(item) && typeof item === "object" && typeof (item as SavedSearch).id === "string" && typeof (item as SavedSearch).query === "string")
      .map((item) => ({ ...item, prices: item.prices && typeof item.prices === "object" ? item.prices : {} }))
      .slice(0, MAX_SAVED_SEARCHES);
  } catch { return []; }
}

export function persistSavedSearches(storage: StorageLike | null, searches: SavedSearch[]): boolean {
  if (!storage) return false;
  try { storage.setItem(SAVED_SEARCH_KEY, JSON.stringify(searches.slice(0, MAX_SAVED_SEARCHES))); return true; }
  catch { return false; }
}

/** Adds or refreshes a search (newest first, capped). Returns the new list. */
export function upsertSavedSearch(list: SavedSearch[], criteria: SearchCriteria, prices: Record<string, number>, now = new Date()): SavedSearch[] {
  const id = savedSearchId(criteria);
  const existing = list.find((item) => item.id === id);
  const entry: SavedSearch = { ...criteria, id, createdAt: existing?.createdAt ?? now.toISOString(), lastRunAt: now.toISOString(), prices };
  return [entry, ...list.filter((item) => item.id !== id)].slice(0, MAX_SAVED_SEARCHES);
}
