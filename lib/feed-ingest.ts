import { getDb } from "@/lib/db";
import { groupListings, type InternalListing } from "@/lib/catalog-discovery";
import { persistCatalogSnapshot } from "@/lib/catalog-store";
import { fetchImpactCatalogItems, impactConfigured, listImpactCatalogs } from "@/lib/impact";
import { reserveProviderBudget } from "@/lib/provider-budget";
import type { CatalogBrowseCategory } from "@/lib/types";

/**
 * Optional bulk ingestion of Impact advertiser catalogs into the shared catalog (Neon), so catalog
 * browse shows brand and store offers without a live call per search. OFF by default.
 *
 * Environment:
 *   FEED_INGEST_ENABLED=true          turns it on (also needs the Impact keys)
 *   IMPACT_FEED_CATALOG_IDS=42,77     comma-separated catalog ids to ingest (see /admin/providers > Preview feeds)
 *   FEED_PAGES_PER_RUN=2              Impact pages read per scheduled run (default 2, max 6)
 *   FEED_ITEM_REGEX=...               which items to keep, tested on category + name (default: footwear)
 *   FEED_MAX_DB_MB=350                stop ingesting when the database is this large (Neon free plan: 512 MB)
 *
 * Each run reads a few pages per catalog and remembers where it stopped (feed_ingest_state), so a large
 * catalog is covered over several days. Feed offers are kept for 7 days and pruned 3 days after expiry.
 */
export const FEED_PAGE_SIZE = 250;
const DEFAULT_REGEX = "\\b(?:shoes?|sneakers?|trainers?|boots?|sandals?|slides?|clogs?|loafers?|runners?|footwear|cleats?)\\b";

export function feedEnabled(): boolean {
  return process.env.FEED_INGEST_ENABLED === "true" && impactConfigured() && feedCatalogIds().length > 0;
}
export function feedCatalogIds(): string[] {
  return [...new Set((process.env.IMPACT_FEED_CATALOG_IDS ?? "").split(",").map((id) => id.trim()).filter((id) => /^[A-Za-z0-9_-]{1,40}$/.test(id)))];
}
function pagesPerRun(): number {
  const value = Number(process.env.FEED_PAGES_PER_RUN ?? 2);
  return Number.isFinite(value) ? Math.max(1, Math.min(6, Math.floor(value))) : 2;
}
export function feedItemRegex(): RegExp {
  try { return new RegExp(process.env.FEED_ITEM_REGEX || DEFAULT_REGEX, "i"); } catch { return new RegExp(DEFAULT_REGEX, "i"); }
}

const str = (...values: unknown[]) => {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return "";
};
const norm = (value: string) => value.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, " ").trim();
const price = (value: unknown) => { const n = Number(String(value ?? "").replace(/[^0-9.]/g, "")); return Number.isFinite(n) && n > 0 ? n : undefined; };

export function feedItemText(item: Record<string, unknown>): string {
  return `${str(item.Category)} ${str(item.SubCategory)} ${str(item.ProductType)} ${str(item.Name)}`;
}

function guessCategory(text: string): CatalogBrowseCategory {
  if (/\b(?:shoes?|sneakers?|trainers?|boots?|sandals?|slides?|clogs?|loafers?|runners?|footwear|cleats?)\b/i.test(text)) return "sneakers";
  if (/\b(?:shirt|tee|hoodie|jacket|pants|shorts|apparel|sweatshirt|leggings|jersey|dress)\b/i.test(text)) return "apparel";
  return "accessories";
}
function guessGender(item: Record<string, unknown>): InternalListing["gender"] {
  const text = `${str(item.Gender)} ${str(item.Name)}`.toLowerCase();
  if (/\b(?:kids?|boys?|girls?|youth|junior|toddler|infant|grade school|preschool|gs)\b/.test(text)) return "Kids";
  const men = /\b(?:men|mens|male)\b/.test(text);
  const women = /\b(?:women|womens|female|ladies)\b/.test(text);
  if (men && women) return "Unisex";
  if (men) return "Men";
  if (women) return "Women";
  return /\bunisex\b/.test(text) ? "Unisex" : "Unknown";
}

/** Impact feeds list one item per size/colour variant. Variants of one product at one store become a single
 * listing: sizes are the in-stock variants, the price is the lowest, and the link is the cheapest variant's. */
export function collapseFeedItems(items: Record<string, unknown>[], advertiser: string, regex: RegExp): InternalListing[] {
  const groups = new Map<string, Array<Record<string, unknown>>>();
  for (const item of items) {
    const name = str(item.Name);
    const brand = str(item.Manufacturer, item.Brand);
    const url = str(item.Url);
    if (!name || !brand || !/^https?:\/\//i.test(url) || !regex.test(feedItemText(item))) continue;
    const key = `${norm(brand)}|${norm(name)}|${norm(str(item.Color))}|${guessGender(item)}`;
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(item);
  }
  const out: InternalListing[] = [];
  for (const variants of groups.values()) {
    const stock = (item: Record<string, unknown>) => str(item.StockAvailability).toLowerCase().replace(/[\s_-]/g, "");
    const inStock = variants.filter((item) => stock(item) !== "outofstock");
    if (!inStock.length) continue; // every variant sold out: nothing to show
    const cheapest = [...inStock].sort((a, b) => (price(a.CurrentPrice) ?? Infinity) - (price(b.CurrentPrice) ?? Infinity))[0];
    const first = inStock[0];
    const current = price(cheapest.CurrentPrice);
    const original = price(cheapest.OriginalPrice) ?? price(first.OriginalPrice);
    const text = feedItemText(first);
    out.push({
      source: "impact", retailer: advertiser || "Partner store",
      title: str(first.Name), brand: str(first.Manufacturer, first.Brand), category: guessCategory(text),
      url: str(cheapest.Url), providerProductId: str(first.CatalogItemId, first.Id) || undefined,
      styleCode: str(first.Mpn, first.ModelNumber) || undefined,
      imageUrl: str(first.ImageUrl) || undefined,
      price: current, originalPrice: original && current && original > current ? original : undefined,
      currency: (str(first.Currency) || "USD").toUpperCase(),
      color: str(first.Color) || undefined,
      sizes: [...new Set(inStock.map((item) => str(item.Size)).filter(Boolean))],
      gender: guessGender(first),
      onSale: Boolean(original && current && original > current),
    } as InternalListing);
  }
  return out;
}

export type FeedRunResult = {
  ran: boolean; skipped?: string; pages: number; items: number; kept: number; products: number;
  catalogs: Array<{ id: string; name: string; page?: number; numPages?: number | null; items?: number; products?: number; error?: string }>;
};

export async function runFeedIngest(options: { maxPages?: number; deadline?: number } = {}): Promise<FeedRunResult> {
  const result: FeedRunResult = { ran: false, pages: 0, items: 0, kept: 0, products: 0, catalogs: [] };
  if (!feedEnabled()) return { ...result, skipped: "disabled" };
  const sql = getDb();
  if (!sql) return { ...result, skipped: "no_database" };

  // Storage guard for Neon's free plan. If the size cannot be read, carry on rather than stop forever.
  const maxMb = Number(process.env.FEED_MAX_DB_MB ?? 350);
  try {
    const size = await sql`SELECT pg_database_size(current_database())::float8 AS bytes` as Array<{ bytes: number }>;
    if (Number(size[0]?.bytes ?? 0) / 1048576 > maxMb) return { ...result, skipped: "storage_limit" };
  } catch { /* unknown size */ }

  try { await sql`DELETE FROM retailer_offers WHERE source = 'impact' AND expires_at IS NOT NULL AND expires_at < NOW() - INTERVAL '3 days'`; } catch { /* best-effort */ }

  let names = new Map<string, string>();
  try { names = new Map((await listImpactCatalogs()).map((catalog) => [catalog.id, catalog.name])); } catch { /* names are cosmetic */ }
  const ids = feedCatalogIds();
  try {
    for (const id of ids) await sql`INSERT INTO feed_ingest_state (catalog_id, advertiser_name) VALUES (${id}, ${names.get(id) ?? ""}) ON CONFLICT (catalog_id) DO UPDATE SET advertiser_name = CASE WHEN EXCLUDED.advertiser_name <> '' THEN EXCLUDED.advertiser_name ELSE feed_ingest_state.advertiser_name END`;
  } catch { return { ...result, skipped: "state_table_missing (run migration 006)" }; }

  const order = await sql`
    SELECT catalog_id, advertiser_name, next_page FROM feed_ingest_state
    WHERE catalog_id IN (SELECT jsonb_array_elements_text(${JSON.stringify(ids)}::jsonb))
    ORDER BY last_run_at ASC NULLS FIRST, catalog_id ASC
  ` as Array<{ catalog_id: string; advertiser_name: string; next_page: number }>;

  const regex = feedItemRegex();
  const maxPages = Math.max(1, Math.min(6, options.maxPages ?? pagesPerRun()));
  result.ran = true;
  // Catalogs take turns, one page each, until the page allowance for this run is used.
  const entries = new Map<string, FeedRunResult["catalogs"][number]>();
  const nextPage = new Map(order.map((row) => [row.catalog_id, Math.max(1, Number(row.next_page) || 1)]));
  const stopped = new Set<string>();
  while (result.pages < maxPages) {
    let progressed = false;
    for (const catalog of order) {
      if (result.pages >= maxPages || stopped.has(catalog.catalog_id)) continue;
      if (options.deadline && Date.now() + 12_000 > options.deadline) { stopped.add("__deadline__"); break; }
      let entry = entries.get(catalog.catalog_id);
      if (!entry) {
        entry = { id: catalog.catalog_id, name: catalog.advertiser_name || names.get(catalog.catalog_id) || catalog.catalog_id, items: 0, products: 0 };
        entries.set(catalog.catalog_id, entry);
        result.catalogs.push(entry);
      }
      try {
        if (!(await reserveProviderBudget("impact", 1))) { entry.error = "Impact safety budget reached"; stopped.add("__budget__"); break; }
        const page = nextPage.get(catalog.catalog_id) ?? 1;
        const { items, numPages } = await fetchImpactCatalogItems(catalog.catalog_id, page, FEED_PAGE_SIZE);
        const listings = collapseFeedItems(items, entry.name, regex);
        const products = listings.length ? groupListings(listings) : [];
        if (products.length) await persistCatalogSnapshot(products);
        // Trust Impact's page count when it gives one; otherwise a short page means the end.
        const finished = numPages !== null ? page >= numPages : items.length < FEED_PAGE_SIZE;
        await sql`
          UPDATE feed_ingest_state SET
            next_page = ${finished ? 1 : page + 1}, num_pages = ${numPages},
            items_seen = items_seen + ${items.length}, products_saved = products_saved + ${products.length},
            cycles = cycles + ${finished ? 1 : 0}, last_run_at = NOW(), last_error = NULL
          WHERE catalog_id = ${catalog.catalog_id}
        `;
        nextPage.set(catalog.catalog_id, finished ? 1 : page + 1);
        entry.page = page; entry.numPages = numPages;
        entry.items = (entry.items ?? 0) + items.length; entry.products = (entry.products ?? 0) + products.length;
        result.pages++; result.items += items.length; result.kept += listings.length; result.products += products.length;
        progressed = true;
      } catch (error) {
        entry.error = error instanceof Error ? error.message.slice(0, 200) : "ingestion failed";
        stopped.add(catalog.catalog_id);
        try { await sql`UPDATE feed_ingest_state SET last_run_at = NOW(), last_error = ${entry.error} WHERE catalog_id = ${catalog.catalog_id}`; } catch { /* best-effort */ }
      }
    }
    if (!progressed || stopped.has("__deadline__") || stopped.has("__budget__")) break;
  }
  return result;
}

export type FeedPreview = {
  catalogs: Array<{ id: string; name: string; selected: boolean }>;
  sample?: { catalogId: string; name: string; items: number; numPages: number | null; fields: string[]; matched: number; products: number; examples: Array<{ title: string; brand: string; price?: number; sizes: string[]; category: string }> };
  error?: string;
};

/** Reads the catalog list and the first page of one catalog (2 Impact calls) so the owner can check the
 * data and the item filter before turning ingestion on. Writes nothing. */
export async function previewFeeds(catalogId?: string): Promise<FeedPreview> {
  const selected = new Set(feedCatalogIds());
  let catalogs: FeedPreview["catalogs"] = [];
  try { catalogs = (await listImpactCatalogs()).map((catalog) => ({ ...catalog, selected: selected.has(catalog.id) })); }
  catch (error) { return { catalogs, error: error instanceof Error ? error.message : "Could not list Impact catalogs." }; }
  const target = catalogId ?? [...selected][0] ?? catalogs[0]?.id;
  if (!target) return { catalogs };
  try {
    const name = catalogs.find((catalog) => catalog.id === target)?.name ?? target;
    const { items, numPages } = await fetchImpactCatalogItems(target, 1, 50);
    const regex = feedItemRegex();
    const listings = collapseFeedItems(items, name, regex);
    return { catalogs, sample: {
      catalogId: target, name, items: items.length, numPages, fields: Object.keys(items[0] ?? {}).slice(0, 40),
      matched: items.filter((item) => regex.test(feedItemText(item))).length, products: listings.length,
      examples: listings.slice(0, 5).map((listing) => ({ title: listing.title, brand: listing.brand, price: listing.price, sizes: listing.sizes ?? [], category: listing.category })),
    } };
  } catch (error) {
    return { catalogs, error: error instanceof Error ? error.message : "Could not read the catalog." };
  }
}
