import type { MarketplaceOffer } from "@/lib/types";

/**
 * Impact.com partner API (https://integrations.impact.com/partner-api-reference).
 * Searches the product catalogs of every advertiser (adidas, New Balance, Puma, Reebok, Vans,
 * Converse, department stores, ...) that has approved your Impact publisher account. Each item
 * carries your affiliate tracking link, so these offers can earn commission.
 *
 * Used live in Compare offers only: cached for IMPACT_CACHE_HOURS and never written to the
 * normalized catalog tables. Which stores appear depends entirely on the programs you have joined.
 *
 * Environment: IMPACT_ACCOUNT_SID and IMPACT_AUTH_TOKEN (Impact dashboard > Account Settings >
 * API). Authentication is HTTP Basic over HTTPS; the token is never sent to the browser.
 */
export const IMPACT_CACHE_HOURS = 3;
const BASE = "https://api.impact.com/Mediapartners";

export function impactConfigured(): boolean {
  return Boolean(process.env.IMPACT_ACCOUNT_SID && process.env.IMPACT_AUTH_TOKEN);
}

function obj(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function text(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return "";
}

async function impactGet(path: string, params: Record<string, string> = {}): Promise<Record<string, unknown>> {
  const sid = process.env.IMPACT_ACCOUNT_SID;
  const token = process.env.IMPACT_AUTH_TOKEN;
  if (!sid || !token) throw new Error("IMPACT_ACCOUNT_SID and IMPACT_AUTH_TOKEN are not configured.");
  const url = new URL(`${BASE}/${encodeURIComponent(sid)}${path}`);
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
  const response = await fetch(url, {
    headers: { authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`, accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${text(payload.Message, payload.message, payload.error) || "Impact request failed."}`);
  }
  return payload;
}

// Catalog id -> advertiser name, refreshed at most every 6 hours per server instance.
let catalogNames: { at: number; names: Map<string, string> } | null = null;
async function advertiserNames(): Promise<Map<string, string>> {
  if (catalogNames && Date.now() - catalogNames.at < 6 * 3600_000) return catalogNames.names;
  const names = new Map<string, string>();
  try {
    const payload = await impactGet("/Catalogs", { PageSize: "100" });
    const catalogs = Array.isArray(payload.Catalogs) ? payload.Catalogs : [];
    for (const raw of catalogs) {
      const catalog = obj(raw);
      const id = text(catalog?.Id, catalog?.CatalogId);
      const name = text(catalog?.CampaignName, catalog?.AdvertiserName, catalog?.Name);
      if (id && name) names.set(id, name);
    }
  } catch { /* fall back to a generic label below */ }
  catalogNames = { at: Date.now(), names };
  return names;
}

/** Searches every approved catalog. `tokens` are model words of the selected product; they are
 * AND-ed as case-insensitive "contains" tests on the item name. Strict matching is applied by the caller. */
export async function searchImpact(tokens: string[], limit = 50): Promise<Record<string, unknown>[]> {
  const safe = tokens.map((token) => token.replace(/[^a-z0-9]/gi, "")).filter(Boolean).slice(0, 4);
  if (!safe.length) return [];
  const query = safe.map((token) => `Name~'${token}'`).join(" AND ");
  const payload = await impactGet("/Catalogs/ItemSearch", { Query: query, PageSize: String(limit) });
  const items = payload.Items;
  return Array.isArray(items) ? items.map(obj).filter((item): item is Record<string, unknown> => !!item) : [];
}

export async function impactOffers(items: Record<string, unknown>[]): Promise<MarketplaceOffer[]> {
  const names = await advertiserNames();
  const out: MarketplaceOffer[] = [];
  for (const item of items) {
    const title = text(item.Name);
    const url = text(item.Url);
    if (!title || !/^https?:\/\//i.test(url)) continue;
    const catalogId = text(item.CatalogId) || (text(item.Uri).match(/\/Catalogs\/(\d+)\/Items\//)?.[1] ?? "");
    const retailer = text(item.CampaignName, item.AdvertiserName) || names.get(catalogId) || text(item.Manufacturer) || "Partner store";
    const price = Number(String(item.CurrentPrice ?? "").replace(/[^0-9.]/g, ""));
    const stock = text(item.StockAvailability).toLowerCase().replace(/[\s_-]/g, "");
    const available = stock === "instock" || stock === "limitedavailability";
    const unavailable = stock === "outofstock";
    out.push({
      id: `impact:${text(item.CatalogItemId, item.Id) || url}`,
      providerProductId: text(item.CatalogItemId, item.Id) || undefined,
      source: "impact", retailer, condition: "New", channel: "online",
      title, url, affiliate: true, imageUrl: text(item.ImageUrl) || undefined, brand: text(item.Manufacturer) || undefined,
      price: Number.isFinite(price) && price > 0 ? price : undefined,
      currency: (text(item.Currency) || "USD").toUpperCase(),
      priceLabel: "Store price",
      availability: unavailable ? "unavailable" : available ? "available" : "unknown",
      availabilityLabel: unavailable ? "Store feed reports out of stock · confirm on the seller page"
        : available ? "Store feed reports in stock · confirm size and checkout on the seller page"
        : "Store listing found · selected-size stock is not confirmed",
    });
  }
  return out;
}

/** Advertiser catalogs available to this publisher account (id + advertiser name). */
export async function listImpactCatalogs(): Promise<Array<{ id: string; name: string }>> {
  const payload = await impactGet("/Catalogs", { PageSize: "100" });
  const catalogs = Array.isArray(payload.Catalogs) ? payload.Catalogs : [];
  return catalogs.map((raw) => {
    const catalog = obj(raw);
    return { id: text(catalog?.Id, catalog?.CatalogId), name: text(catalog?.CampaignName, catalog?.AdvertiserName, catalog?.Name) || "Unnamed catalog" };
  }).filter((catalog) => catalog.id);
}

/** One page of a catalog's items. `numPages` comes from Impact's pagination fields when present. */
export async function fetchImpactCatalogItems(catalogId: string, page: number, pageSize: number): Promise<{ items: Record<string, unknown>[]; numPages: number | null }> {
  const payload = await impactGet(`/Catalogs/${encodeURIComponent(catalogId)}/Items`, { Page: String(page), PageSize: String(pageSize) });
  const items = Array.isArray(payload.Items) ? payload.Items.map(obj).filter((item): item is Record<string, unknown> => !!item) : [];
  const pages = Number(payload["@numpages"]);
  return { items, numPages: Number.isFinite(pages) && pages > 0 ? pages : null };
}
