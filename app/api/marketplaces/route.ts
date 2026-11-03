import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import type { MarketplaceOffer, MarketplaceSourceStatus } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

// Hard ceilings preserve a buffer under the advertised free-tier quotas.
const PCKT_MONTHLY_BUDGET = 450;
const SERPAPI_MONTHLY_BUDGET = 200;
const CACHE_HOURS = 6;
const pcktSources = [
  { key: "stockx", name: "StockX", path: "/v1/catalog/stockx/search", credits: 0.4, params: (q: string) => ({ query: q, page: "1", market: "US" }) },
  { key: "goat", name: "GOAT", path: "/v1/catalog/goat/search", credits: 0.3, params: (q: string) => ({ query: q, page: "0" }) },
  { key: "flightclub", name: "Flight Club", path: "/v1/flightclub/search", credits: 1, params: (q: string) => ({ query: q, pageNumber: "1", countryCode: "US", currencyCode: "USD" }) },
  { key: "kickscrew", name: "Kicks Crew", path: "/v1/kickscrew/search", credits: 0.5, params: (q: string) => ({ query: q }) },
] as const;
type ProviderKey = typeof pcktSources[number]["key"];
type SourceKey = ProviderKey | "shopping";
type SourceStatus = MarketplaceSourceStatus & { key: SourceKey };

function obj(value: unknown): Record<string, unknown> | null { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null; }
function str(...values: unknown[]) { for (const value of values) if (typeof value === "string" && value.trim()) return value.trim(); return ""; }
function num(...values: unknown[]): number | undefined {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
    if (typeof value === "string") { const n = Number(value.replace(/[^0-9.]/g, "")); if (Number.isFinite(n) && n > 0) return n; }
  }
}
function norm(s: string) { return s.toLowerCase().normalize("NFKD").replace(/[’']/g, "").replace(/[^a-z0-9.]+/g, " ").replace(/\s+/g, " ").trim(); }
function termsFor(query: string) {
  const ignored = new Set(["the", "and", "for", "with", "men", "mens", "women", "womens", "kids", "kid", "youth", "unisex", "size", "shoe", "shoes", "sneaker", "sneakers", "us", "nike"]);
  const terms = norm(query).split(" ").filter((x) => x && !ignored.has(x));
  return terms.includes("jordan") ? terms.filter((x) => x !== "air") : terms;
}
function isRelevant(title: string, brand: string, sku: string, query: string) {
  const tokens = new Set(norm(`${title} ${brand} ${sku}`).split(" "));
  return termsFor(query).every((term) => tokens.has(term));
}
function records(payload: unknown): Record<string, unknown>[] {
  const arrays: Record<string, unknown>[][] = [];
  const seen = new Set<object>();
  function walk(value: unknown, depth: number) {
    if (!value || typeof value !== "object" || depth > 7 || seen.has(value as object)) return;
    seen.add(value as object);
    if (Array.isArray(value)) {
      const items = value.map(obj).filter((x): x is Record<string, unknown> => !!x);
      if (items.some((x) => str(x.title, x.name, x.productName, x.product_name, x.display_name, x.product_title, x.model, x.model_name))) arrays.push(items);
      value.slice(0, 80).forEach((x) => walk(x, depth + 1));
    } else {
      for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
        if (["response", "data", "results", "products", "items", "hits", "catalog", "searchResults"].includes(key) || (depth < 3 && child && typeof child === "object")) walk(child, depth + 1);
      }
    }
  }
  walk(payload, 0);
  arrays.sort((a, b) => b.length - a.length);
  return arrays[0] ?? [];
}
function httpUrl(raw: string) { try { const u = new URL(raw); return ["http:", "https:"].includes(u.protocol) ? u.toString() : ""; } catch { return ""; } }
function productUrl(source: SourceKey, item: Record<string, unknown>) {
  const slug = str(item.slug, item.handle, item.url_key);
  const raw = httpUrl(str(item.url, item.link, item.product_url, item.productUrl, item.product_link));
  const hosts: Record<ProviderKey, string> = { stockx: "stockx.com", goat: "goat.com", flightclub: "flightclub.com", kickscrew: "kickscrew.com" };
  if (source === "shopping") return raw;
  if (raw) {
    try {
      const u = new URL(raw);
      if (u.hostname === hosts[source] || u.hostname.endsWith(`.${hosts[source]}`)) return raw;
      const unwrap = httpUrl(u.searchParams.get("u") || u.searchParams.get("url") || "");
      if (unwrap) { const h = new URL(unwrap).hostname; if (h === hosts[source] || h.endsWith(`.${hosts[source]}`)) return unwrap; }
    } catch { /* create a canonical first-party product URL below */ }
  }
  if (!slug) return "";
  if (source === "stockx") return `https://stockx.com/${encodeURIComponent(slug)}`;
  if (source === "goat") return `https://www.goat.com/sneakers/${encodeURIComponent(slug)}`;
  if (source === "flightclub") return `https://www.flightclub.com/${encodeURIComponent(slug)}`;
  return `https://www.kickscrew.com/products/${encodeURIComponent(slug)}`;
}
function normalizePckt(source: ProviderKey, x: Record<string, unknown>, query: string): MarketplaceOffer | null {
  const title = str(x.title, x.name, x.productName, x.product_name, x.display_name, x.product_title, x.model_name);
  const brand = str(x.brand, x.brandName, x.manufacturer);
  const sku = str(x.sku, x.style_code, x.styleCode, x.product_code);
  if (!title || !isRelevant(title, brand, sku, query)) return null;
  const url = productUrl(source, x); if (!url) return null;
  const name = pcktSources.find((s) => s.key === source)?.name ?? source;
  const price = num(x.lowest_ask, x.lowestAsk, x.price, x.specialDisplayPriceCents ? Number(x.specialDisplayPriceCents) / 100 : undefined, x.extracted_price);
  return {
    id: `${source}:${str(x.id, x.product_id, x.productId, x.slug, sku, url)}`, source, retailer: name, channel: "online", title, url,
    imageUrl: httpUrl(str(x.image_url, x.imageUrl, x.mainPictureUrl, x.gridPictureUrl, x.thumbnail)) || undefined,
    styleCode: sku || undefined, brand: brand || undefined, price, currency: "USD",
    priceLabel: price ? (source === "stockx" || source === "goat" ? "Lowest ask" : "Displayed price") : undefined,
    availability: "unknown", availabilityLabel: "Online listing found · selected-size stock not confirmed by this search",
    sourceUpdatedAt: str(x.updated_at, x.updatedAt) || undefined,
  };
}
function normalizeShopping(x: Record<string, unknown>, query: string): MarketplaceOffer | null {
  const title = str(x.title, x.product_title); const retailer = str(x.source, x.seller, x.merchant, x.store); const sku = str(x.product_id, x.sku, x.gtin);
  if (!title || !retailer || !isRelevant(title, retailer, sku, query)) return null;
  const url = httpUrl(str(x.product_link, x.link, x.url)); if (!url) return null;
  const price = num(x.extracted_price, x.price);
  return {
    id: `shopping:${str(x.product_id, x.position, title)}:${retailer}`, source: "shopping", retailer, channel: "online", title, url,
    imageUrl: httpUrl(str(x.thumbnail, x.image)) || undefined, styleCode: sku || undefined,
    price, priceLabel: price ? "Displayed price" : undefined, currency: "USD", availability: "unknown",
    availabilityLabel: "Retailer listing found · selected-size and live stock not independently verified",
  };
}
async function fetchJson(url: URL, headers?: HeadersInit) {
  const response = await fetch(url, { headers, cache: "no-store", signal: AbortSignal.timeout(7_000) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) { const x = obj(data); throw new Error(str(x?.message, x?.error, x?.detail) || `HTTP ${response.status}`); }
  return data;
}
async function waitForPcktSlot() {
  const sql = getDb(); if (!sql) throw new Error("Neon is required to enforce PCKT's shared rate limit.");
  const rows = await sql`
    INSERT INTO retailer_provider_request_gate (provider, next_allowed_at)
    VALUES ('pckt', now())
    ON CONFLICT (provider) DO UPDATE
      SET next_allowed_at = GREATEST(retailer_provider_request_gate.next_allowed_at, now()) + interval '1100 milliseconds'
    RETURNING next_allowed_at
  ` as Array<{ next_allowed_at: string | Date }>;
  const reservedAt = rows[0]?.next_allowed_at;
  const delay = reservedAt ? new Date(reservedAt).getTime() - Date.now() : 0;
  if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
}
async function reserveBudget(provider: "pckt" | "serpapi", units: number, ceiling: number) {
  const sql = getDb(); if (!sql) return false;
  const rows = await sql`
    INSERT INTO retailer_api_usage (provider, usage_month, units_reserved)
    VALUES (${provider}, date_trunc('month', now())::date, ${units})
    ON CONFLICT (provider, usage_month)
    DO UPDATE SET units_reserved = retailer_api_usage.units_reserved + EXCLUDED.units_reserved
    WHERE retailer_api_usage.units_reserved + EXCLUDED.units_reserved <= ${ceiling}
    RETURNING units_reserved
  `;
  return rows.length > 0;
}
async function reserveDailyLimit(request: NextRequest) {
  const sql = getDb(); if (!sql) return false;
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
  const salt = process.env.RATE_LIMIT_SALT || process.env.PCKT_API_KEY || "outlet-radar";
  const hash = createHash("sha256").update(`${salt}:${ip}`).digest("hex");
  const rows = await sql`
    INSERT INTO marketplace_search_rate_limits (ip_hash, usage_day, request_count)
    VALUES (${hash}, CURRENT_DATE, 1)
    ON CONFLICT (ip_hash, usage_day)
    DO UPDATE SET request_count = marketplace_search_rate_limits.request_count + 1
    WHERE marketplace_search_rate_limits.request_count < 5
    RETURNING request_count
  `;
  return rows.length > 0;
}
async function readCache(key: string) {
  const sql = getDb(); if (!sql) return null;
  const rows = await sql`SELECT results_json, sources_json, cached_at FROM retailer_search_cache WHERE cache_key = ${key} AND expires_at > now() LIMIT 1` as Array<Record<string, unknown>>;
  const row = rows[0]; if (!row) return null;
  const offers = typeof row.results_json === "string" ? JSON.parse(row.results_json) : row.results_json;
  const sources = typeof row.sources_json === "string" ? JSON.parse(row.sources_json) : row.sources_json;
  return Array.isArray(offers) ? { offers: offers as MarketplaceOffer[], sources: Array.isArray(sources) ? sources as SourceStatus[] : [], cachedAt: row.cached_at } : null;
}
async function writeCache(key: string, query: string, offers: MarketplaceOffer[], sources: SourceStatus[]) {
  const sql = getDb(); if (!sql) return;
  await sql`
    INSERT INTO retailer_search_cache (cache_key, query_text, results_json, sources_json, cached_at, expires_at)
    VALUES (${key}, ${query}, ${JSON.stringify(offers)}::jsonb, ${JSON.stringify(sources)}::jsonb, now(), now() + (${CACHE_HOURS} * interval '1 hour'))
    ON CONFLICT (cache_key) DO UPDATE SET query_text = EXCLUDED.query_text, results_json = EXCLUDED.results_json,
      sources_json = EXCLUDED.sources_json, cached_at = now(), expires_at = now() + (${CACHE_HOURS} * interval '1 hour')
  `;
}

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get("q")?.trim() ?? "";
  if (query.length < 2 || query.length > 100) return NextResponse.json({ error: "Enter a search between 2 and 100 characters." }, { status: 400 });
  if (!getDb()) return NextResponse.json({ error: "Neon must be connected so monthly free-tier request limits can be enforced." }, { status: 503 });
  const cacheKey = createHash("sha256").update(norm(query)).digest("hex");
  const pcktKey = process.env.PCKT_API_KEY;
  const serpKey = process.env.SERPAPI_API_KEY;
  try {
    const cached = await readCache(cacheKey);
    const newlyConfiguredSource = cached?.sources.some((source) => source.status === "not_configured" && ((source.key !== "shopping" && Boolean(pcktKey)) || (source.key === "shopping" && Boolean(serpKey))));
    if (cached && !newlyConfiguredSource) return NextResponse.json({ query, offers: cached.offers, sources: cached.sources, cached: true, cachedAt: cached.cachedAt, cacheHours: CACHE_HOURS });
  } catch { return NextResponse.json({ error: "The retailer cache table is missing. Run the latest db/schema.sql in Neon." }, { status: 503 }); }
  if (!(await reserveDailyLimit(request))) return NextResponse.json({ error: "The limit is 5 uncached retailer comparisons per IP per day. Cached searches remain available." }, { status: 429 });

  const offers: MarketplaceOffer[] = []; const sources: SourceStatus[] = [];
  if (!pcktKey) {
    for (const source of pcktSources) sources.push({ key: source.key, name: source.name, status: "not_configured", results: 0, message: "Add PCKT_API_KEY in Vercel to enable this source." });
  } else {
    for (const source of pcktSources) {
      if (!(await reserveBudget("pckt", source.credits, PCKT_MONTHLY_BUDGET))) {
        sources.push({ key: source.key, name: source.name, status: "budget_reached", results: 0, message: "Monthly free-credit safety limit reached; no request sent." }); continue;
      }
      try {
        await waitForPcktSlot(); // Shared Neon gate enforces the provider's global 1 request/second Free-plan limit.
        const url = new URL(`https://api.pckt.sh${source.path}`);
        Object.entries(source.params(query)).forEach(([k, v]) => url.searchParams.set(k, v));
        const payload = await fetchJson(url, { Authorization: `Bearer ${pcktKey}`, Accept: "application/json" });
        const found = records(payload).map((x) => normalizePckt(source.key, x, query)).filter((x): x is MarketplaceOffer => !!x);
        offers.push(...found);
        sources.push({ key: source.key, name: source.name, status: "success", results: found.length, message: found.length ? `${found.length} matching catalog listing(s); size stock is not inferred.` : "No exact matching model listings returned." });
      } catch (error) { sources.push({ key: source.key, name: source.name, status: "error", results: 0, message: error instanceof Error ? error.message : "Provider request failed." }); }
    }
  }

  if (!serpKey) sources.push({ key: "shopping", name: "Foot Locker & other retailers", status: "not_configured", results: 0, message: "Add SERPAPI_API_KEY to search Google Shopping merchants including Foot Locker, Champs Sports and JD Sports." });
  else if (!(await reserveBudget("serpapi", 1, SERPAPI_MONTHLY_BUDGET))) sources.push({ key: "shopping", name: "Google Shopping merchants", status: "budget_reached", results: 0, message: "Monthly free-search safety limit reached; no request sent." });
  else {
    try {
      const url = new URL("https://serpapi.com/search.json");
      url.searchParams.set("engine", "google_shopping"); url.searchParams.set("q", query); url.searchParams.set("gl", "us"); url.searchParams.set("hl", "en"); url.searchParams.set("api_key", serpKey);
      const payload = obj(await fetchJson(url)) ?? {}; const shopping = Array.isArray(payload.shopping_results) ? payload.shopping_results : [];
      const found = shopping.map(obj).filter((x): x is Record<string, unknown> => !!x).map((x) => normalizeShopping(x, query)).filter((x): x is MarketplaceOffer => !!x);
      offers.push(...found); sources.push({ key: "shopping", name: "Google Shopping merchants", status: "success", results: found.length, message: found.length ? "Retailer product listings found; verify selected-size stock on the retailer site." : "No exact matching merchant listings returned." });
    } catch (error) { sources.push({ key: "shopping", name: "Google Shopping merchants", status: "error", results: 0, message: error instanceof Error ? error.message : "Shopping search failed." }); }
  }

  const unique = new Map<string, MarketplaceOffer>();
  for (const offer of offers) { const key = `${offer.source}:${offer.url.toLowerCase()}`; if (!unique.has(key)) unique.set(key, offer); }
  const results = [...unique.values()].slice(0, 60);
  try { await writeCache(cacheKey, query, results, sources); } catch { /* return live provider results even if the cache write fails */ }
  return NextResponse.json({ query, offers: results, sources, cached: false, cacheHours: CACHE_HOURS, note: "These are online product listings. No physical-store stock is asserted unless a source supplies an item-specific store address and size-level inventory." });
}
