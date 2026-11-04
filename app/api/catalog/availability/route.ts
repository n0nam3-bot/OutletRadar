import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import type { MarketplaceSizeQuote } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 45;

const PCKT_MONTHLY_BUDGET = 450;
type QuoteSource = "stockx" | "goat" | "flightclub";
type ListingRef = { source: QuoteSource; providerProductId: string; retailer: string; catalogProductId: string; gender?: string };
type ProductRef = { catalogProductId: string; listings: ListingRef[]; needsImage: boolean };
type CachedDetail = { quotes: MarketplaceSizeQuote[]; imageUrl?: string; colors?: string[]; gender?: string };

function obj(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function str(...values: unknown[]): string {
  for (const value of values) if (typeof value === "string" && value.trim()) return value.trim();
  return "";
}
function num(...values: unknown[]): number | undefined {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) return value;
    if (typeof value === "string" && value.trim()) {
      const parsed = Number(value.replace(/[^0-9.]/g, ""));
      if (Number.isFinite(parsed) && parsed >= 0) return parsed;
    }
  }
  return undefined;
}
function moneyFromCents(value: unknown): number | undefined {
  const parsed = num(value);
  return parsed === undefined ? undefined : parsed / 100;
}
function walkObjects(value: unknown, visit: (record: Record<string, unknown>) => void, depth = 0, seen = new Set<object>()) {
  if (!value || typeof value !== "object" || depth > 8 || seen.has(value as object)) return;
  seen.add(value as object);
  if (Array.isArray(value)) {
    value.slice(0, 400).forEach((entry) => walkObjects(entry, visit, depth + 1, seen));
    return;
  }
  const record = value as Record<string, unknown>;
  visit(record);
  Object.values(record).forEach((child) => {
    if (child && typeof child === "object") walkObjects(child, visit, depth + 1, seen);
  });
}
function firstProductRecord(payload: unknown): Record<string, unknown> | null {
  let result: Record<string, unknown> | null = null;
  let score = -1;
  walkObjects(payload, (record) => {
    const title = str(record.title, record.name, record.model, record.product_name);
    const image = imageUrlFromItem(record);
    const hasProductSignals = Boolean(title || record.availableSizesNew || record.availableSizesNewV2 || record.variants || image);
    if (!hasProductSignals) return;
    const candidateScore = (title ? 2 : 0) + (record.availableSizesNew || record.availableSizesNewV2 ? 3 : 0) + (record.variants ? 1 : 0) + (image ? 2 : 0);
    if (candidateScore > score) { score = candidateScore; result = record; }
  });
  return result;
}
function imageUrlFromValue(value: unknown, depth = 0): string {
  if (depth > 6 || value == null) return "";
  if (typeof value === "string") {
    try { const url = new URL(value.startsWith("//") ? `https:${value}` : value); return ["http:", "https:"].includes(url.protocol) ? url.toString() : ""; } catch { return ""; }
  }
  if (Array.isArray(value)) {
    for (const entry of value.slice(0, 20)) { const found = imageUrlFromValue(entry, depth + 1); if (found) return found; }
    return "";
  }
  const record = obj(value);
  if (!record) return "";
  for (const key of ["url", "src", "src_url", "image_url", "imageUrl", "imageURL", "image_url_https", "original", "original_url", "originalSrc", "large", "large_url", "thumbnail", "thumbnail_url", "href", "secure_url", "main_image_url", "product_image_url", "featured_image_url"]) {
    const found = typeof record[key] === "string" ? imageUrlFromValue(record[key], depth + 1) : "";
    if (found) return found;
  }
  for (const key of ["images", "gallery", "image", "media", "photos", "image_360", "picture", "pictures", "primary_image", "primaryImage", "image_urls", "imageUrls", "product_images", "productImages", "featured_image", "featuredImage"]) {
    if (record[key] !== undefined) { const found = imageUrlFromValue(record[key], depth + 1); if (found) return found; }
  }
  for (const [key, child] of Object.entries(record)) {
    if (/image|picture|thumbnail|photo|media/i.test(key)) {
      const found = imageUrlFromValue(child, depth + 1);
      if (found) return found;
    }
  }
  return "";
}
function imageUrlFromItem(record: Record<string, unknown>): string | undefined {
  for (const key of ["image_url", "imageUrl", "imageURL", "mainPictureUrl", "gridPictureUrl", "mainGlowPictureUrl", "gridGlowPictureUrl", "pictureUrl", "thumbnail", "thumbnailUrl", "thumbnail_url", "main_image_url", "product_image_url", "featured_image_url", "productImageUrl", "primary_image", "primaryImage", "image", "images", "gallery", "image_360", "image_360_url", "media", "photos", "picture", "pictures", "image_urls", "imageUrls", "product_images", "productImages"]) {
    if (record[key] !== undefined) { const found = imageUrlFromValue(record[key]); if (found) return found; }
  }
  return undefined;
}
function sizeSystem(baseType: string): MarketplaceSizeQuote["sizeSystem"] {
  const text = baseType.toLowerCase().replace(/[_-]+/g, " ");
  if (/women|female|\bus\s*w\b/.test(text)) return "women";
  if (/youth|grade|kids|boys|girls|\bus\s*y\b/.test(text)) return "youth";
  if (/men|male|\bus\s*m\b/.test(text)) return "men";
  if (/unisex/.test(text)) return "unisex";
  return "unknown";
}
function cacheKey(source: QuoteSource, id: string) {
  return createHash("sha256").update(`size-quotes:v4:${source}:${id}:us`).digest("hex");
}
async function readCachedData(source: QuoteSource, id: string): Promise<CachedDetail | null> {
  const sql = getDb();
  if (!sql) return null;
  const key = cacheKey(source, id);
  const rows = await sql`SELECT results_json FROM retailer_search_cache WHERE cache_key = ${key} AND expires_at > now() LIMIT 1` as Array<{ results_json: unknown }>;
  const raw = rows[0]?.results_json;
  if (!raw) return null;
  const value = typeof raw === "string" ? JSON.parse(raw) : raw;
  if (Array.isArray(value)) return { quotes: value as MarketplaceSizeQuote[] }; // Read older v1 cache entries safely.
  const record = obj(value);
  if (!record) return null;
  return {
    quotes: Array.isArray(record.quotes) ? record.quotes as MarketplaceSizeQuote[] : [],
    imageUrl: typeof record.imageUrl === "string" ? record.imageUrl : undefined,
    colors: Array.isArray(record.colors) ? record.colors.filter((color): color is string => typeof color === "string") : undefined,
    gender: typeof record.gender === "string" ? record.gender : undefined,
  };
}
async function writeCachedData(source: QuoteSource, id: string, detail: CachedDetail) {
  const sql = getDb();
  if (!sql) return;
  const key = cacheKey(source, id);
  await sql`
    INSERT INTO retailer_search_cache (cache_key, query_text, results_json, sources_json, cached_at, expires_at)
    VALUES (${key}, ${`size-quotes:${source}:${id}`}, ${JSON.stringify(detail)}::jsonb, '[]'::jsonb, now(), now() + interval '6 hours')
    ON CONFLICT (cache_key) DO UPDATE SET results_json = EXCLUDED.results_json, cached_at = now(), expires_at = now() + interval '6 hours'
  `;
}
async function readCachedProductImage(source: "stockx" | "goat", id: string): Promise<Record<string, unknown> | null> {
  const sql = getDb();
  if (!sql) return null;
  const key = createHash("sha256").update(`catalog-product-detail:v1:${source}:${id}`).digest("hex");
  const rows = await sql`SELECT results_json FROM retailer_search_cache WHERE cache_key = ${key} AND expires_at > now() LIMIT 1` as Array<{ results_json: unknown }>;
  const raw = rows[0]?.results_json;
  return raw ? obj(typeof raw === "string" ? JSON.parse(raw) : raw) : null;
}
async function saveCachedProductImage(source: "stockx" | "goat", id: string, detail: Record<string, unknown>) {
  const sql = getDb(); if (!sql) return;
  const key = createHash("sha256").update(`catalog-product-detail:v1:${source}:${id}`).digest("hex");
  await sql`
    INSERT INTO retailer_search_cache (cache_key, query_text, results_json, sources_json, cached_at, expires_at)
    VALUES (${key}, ${`product-detail:${source}:${id}`}, ${JSON.stringify(detail)}::jsonb, '[]'::jsonb, now(), now() + interval '30 days')
    ON CONFLICT (cache_key) DO UPDATE SET results_json = EXCLUDED.results_json, cached_at = now(), expires_at = now() + interval '30 days'
  `;
}
async function fetchCachedProviderImage(source: "stockx" | "goat", id: string, apiKey: string): Promise<Record<string, unknown> | null> {
  const cached = await readCachedProductImage(source, id);
  if (cached) return cached;
  if (!(await reservePcktBudget(0.4))) return null;
  await waitForPcktSlot();
  const url = new URL(`https://api.pckt.sh/v1/catalog/${source}/product`);
  url.searchParams.set("id", id);
  url.searchParams.set("market", "US");
  const payload = await fetchJson(url, apiKey);
  let detail: Record<string, unknown> | null = null;
  walkObjects(payload, (record) => {
    if (!detail && str(record.title, record.name, record.model) && (imageUrlFromItem(record) || record.gallery || record.images)) detail = record;
  });
  if (detail) await saveCachedProductImage(source, id, detail);
  return detail;
}
async function reservePcktBudget(units: number) {
  const sql = getDb();
  if (!sql) return false;
  const rows = await sql`
    INSERT INTO retailer_api_usage (provider, usage_month, units_reserved)
    VALUES ('pckt', date_trunc('month', now())::date, ${units})
    ON CONFLICT (provider, usage_month)
    DO UPDATE SET units_reserved = retailer_api_usage.units_reserved + EXCLUDED.units_reserved
    WHERE retailer_api_usage.units_reserved + EXCLUDED.units_reserved <= ${PCKT_MONTHLY_BUDGET}
    RETURNING units_reserved
  `;
  return rows.length > 0;
}
async function waitForPcktSlot() {
  const sql = getDb();
  if (!sql) throw new Error("Neon is required to enforce PCKT's shared rate limit.");
  const rows = await sql`
    INSERT INTO retailer_provider_request_gate (provider, next_allowed_at)
    VALUES ('pckt', now())
    ON CONFLICT (provider) DO UPDATE
      SET next_allowed_at = GREATEST(retailer_provider_request_gate.next_allowed_at, now()) + interval '1100 milliseconds'
    RETURNING next_allowed_at
  ` as Array<{ next_allowed_at: string | Date }>;
  const delay = rows[0]?.next_allowed_at ? new Date(rows[0].next_allowed_at).getTime() - Date.now() : 0;
  if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
}
async function fetchJson(url: URL, apiKey: string) {
  const response = await fetch(url, { headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" }, cache: "no-store", signal: AbortSignal.timeout(12_000) });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = obj(payload);
    throw new Error(str(error?.message, error?.error, error?.detail) || `PCKT returned HTTP ${response.status}`);
  }
  return payload;
}
function makeStockxQuotes(payload: unknown, retailer: string, productId: string): MarketplaceSizeQuote[] {
  const quotes: MarketplaceSizeQuote[] = [];
  walkObjects(payload, (row) => {
    const variant = obj(row.variant);
    if (String(row.stockx_product_id ?? "") !== productId || !variant || (!row.stockx_variant_id && !variant.base_size)) return;
    const baseSize = str(variant.base_size, variant.size);
    if (!baseSize) return;
    const baseType = str(variant.base_type, variant.size_type);
    const askCount = num(row.number_of_asks);
    const lowestAsk = num(row.lowest_ask);
    // An explicit zero ask count takes precedence over a stale lowest_ask value.
    const available = askCount !== undefined ? askCount > 0 : (lowestAsk !== undefined && lowestAsk > 0 ? true : null);
    const system = sizeSystem(baseType);
    const suffix = system === "men" ? " M" : system === "women" ? " W" : system === "youth" ? " Y" : "";
    quotes.push({
      label: `${baseSize}${suffix}`.trim(), available, price: lowestAsk,
      currency: str(row.currency, "USD").toUpperCase(),
      status: available === true ? "StockX has an active ask for this size" : available === false ? "StockX reports no active asks for this size" : "StockX did not provide ask status",
      sizeSystem: system, retailer, source: "stockx",
    });
  });
  return dedupeQuotes(quotes);
}
function makeGoatQuotes(payload: unknown, retailer: string, productId: string, productGender = ""): MarketplaceSizeQuote[] {
  const quotes: MarketplaceSizeQuote[] = [];
  walkObjects(payload, (row) => {
    if (String(row.goat_product_id ?? "") !== productId || row.size === undefined) return;
    const rawLabel = str(String(row.size));
    if (!rawLabel) return;
    const available = typeof row.available === "boolean" ? row.available : null;
    const lowestAsk = num(row.lowest_ask);
    const gender = productGender.toLowerCase();
    const system = /kids|youth|grade|\bgs\b/.test(gender) || /\by\b/i.test(rawLabel) ? "youth" : /women|female/.test(gender) ? "women" : /men|male/.test(gender) ? "men" : /unisex/.test(gender) ? "unisex" : "unknown";
    const suffix = system === "men" ? " M" : system === "women" ? " W" : system === "youth" && !/y$/i.test(rawLabel) ? " Y" : "";
    const label = `${rawLabel}${suffix}`.trim();
    quotes.push({
      label, available, price: lowestAsk, currency: str(row.currency, "USD").toUpperCase(),
      status: available === true ? "GOAT reports this size available" : available === false ? "GOAT reports this size unavailable" : "GOAT did not provide availability status",
      sizeSystem: system, retailer, source: "goat",
    });
  });
  return dedupeQuotes(quotes);
}
function sizeLabel(value: unknown): string {
  if (typeof value === "string" || typeof value === "number") return String(value).trim();
  const record = obj(value);
  return record ? str(record.size, record.label, record.name, record.value, record.sizeLabel, record.size_label, record.displayName, record.display_name) : "";
}
function makeFlightClubDetail(payload: unknown, retailer: string): CachedDetail {
  const product = firstProductRecord(payload);
  if (!product) return { quotes: [] };
  const gender = str(product.sizeCategory, product.singleGender, product.gender);
  const system = sizeSystem(gender);
  const quotes: MarketplaceSizeQuote[] = [];
  // Flight Club explicitly separates sellable new sizes from size-picker options.
  // Only the availableSizesNew feeds are treated as available; generic size options are not stock.
  for (const key of ["availableSizesNewV2", "availableSizesNew"]) {
    const values = product[key];
    if (!Array.isArray(values)) continue;
    for (const entry of values) {
      const label = sizeLabel(entry);
      if (!label) continue;
      const record = obj(entry);
      const cents = record ? num(record.specialDisplayPriceCents, record.priceCents, record.price_cents) : undefined;
      const price = cents !== undefined ? cents / 100 : record ? num(record.price, record.amount) : undefined;
      const suffix = system === "men" ? " M" : system === "women" ? " W" : system === "youth" && !/y$/i.test(label) ? " Y" : "";
      quotes.push({
        label: `${label}${suffix}`.trim(), available: true, price, currency: "USD",
        status: "Flight Club lists this as an available new size",
        sizeSystem: system === "unknown" ? (/\by\b/i.test(label) ? "youth" : "unknown") : system,
        retailer, source: "flightclub",
      });
    }
  }
  const color = str(product.color, product.colorway, product.secondary_title, product.nickname);
  return {
    quotes: dedupeQuotes(quotes), imageUrl: imageUrlFromItem(product),
    colors: color ? [color] : undefined, gender: gender || undefined,
  };
}
function dedupeQuotes(quotes: MarketplaceSizeQuote[]) {
  const map = new Map<string, MarketplaceSizeQuote>();
  for (const quote of quotes) {
    const key = `${quote.source}:${quote.label.toLowerCase()}`;
    const current = map.get(key);
    if (!current || (quote.available === true && current.available !== true) || (quote.price !== undefined && (current.price === undefined || quote.price < current.price))) map.set(key, quote);
  }
  return [...map.values()].sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));
}

export async function POST(request: NextRequest) {
  const sql = getDb();
  if (!sql) return NextResponse.json({ error: "Neon is required for cached size availability." }, { status: 503 });
  const body = obj(await request.json().catch(() => ({})));
  const rawProducts = Array.isArray(body?.products) ? body.products : body ? [body] : [];
  const products: ProductRef[] = rawProducts.slice(0, 20).map(obj).filter((value): value is Record<string, unknown> => !!value).map((item) => {
    const catalogProductId = str(item.catalogProductId);
    const rawListings = Array.isArray(item.listings) ? item.listings : [];
    const listings: ListingRef[] = rawListings.map(obj).filter((value): value is Record<string, unknown> => !!value).map((listing) => ({
      source: str(listing.source) as QuoteSource,
      providerProductId: str(listing.providerProductId),
      retailer: str(listing.retailer, str(listing.source).toUpperCase()),
      catalogProductId,
      gender: (str(listing.gender) && str(listing.gender).toLowerCase() !== "unknown") ? str(listing.gender) : str(item.gender),
    })).filter((listing) => ["stockx", "goat", "flightclub"].includes(listing.source) && listing.providerProductId.length > 0 && listing.providerProductId.length <= 120);
    return { catalogProductId, listings, needsImage: item.needsImage === true };
  }).filter((product) => product.catalogProductId && product.listings.length > 0);

  if (!products.length) return NextResponse.json({ error: "The selected catalog product has no StockX, GOAT or Flight Club product reference for size lookup." }, { status: 400 });
  const apiKey = process.env.PCKT_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "PCKT_API_KEY is not configured; size-level marketplace lookup is unavailable." }, { status: 503 });

  const allListings = products.flatMap((product) => product.listings);
  const uniqueBySource: Record<QuoteSource, ListingRef[]> = { stockx: [], goat: [], flightclub: [] };
  for (const listing of allListings) {
    if (!uniqueBySource[listing.source].some((entry) => entry.providerProductId === listing.providerProductId)) uniqueBySource[listing.source].push(listing);
  }

  const quoteMap = new Map<string, CachedDetail>();
  const sources: Array<{ name: string; status: string; message: string }> = [];
  // StockX and GOAT provide batch price endpoints, so up to 20 product IDs cost one 0.4-credit request each.
  for (const source of ["stockx", "goat"] as const) {
    const selected = uniqueBySource[source].slice(0, 20);
    if (!selected.length) continue;
    const name = source === "stockx" ? "StockX" : "GOAT";
    const uncached: ListingRef[] = [];
    for (const listing of selected) {
      try {
        const cached = await readCachedData(source, listing.providerProductId);
        if (cached) quoteMap.set(`${source}:${listing.providerProductId}`, cached);
        else uncached.push(listing);
      } catch { uncached.push(listing); }
    }
    if (uncached.length) {
      if (!(await reservePcktBudget(0.4))) {
        sources.push({ name, status: "budget_reached", message: "Monthly PCKT safety budget reached; showing cached size data only." });
      } else {
        try {
          await waitForPcktSlot();
          const url = new URL(`https://api.pckt.sh/v1/catalog/${source}/prices`);
          url.searchParams.set("ids", uncached.map((item) => item.providerProductId).join(","));
          url.searchParams.set("market", "US");
          const payload = await fetchJson(url, apiKey);
          for (const listing of uncached) {
            const quotes = source === "stockx"
              ? makeStockxQuotes(payload, listing.retailer, listing.providerProductId)
              : makeGoatQuotes(payload, listing.retailer, listing.providerProductId, listing.gender);
            const detail = { quotes };
            quoteMap.set(`${source}:${listing.providerProductId}`, detail);
            try { await writeCachedData(source, listing.providerProductId, detail); } catch { /* keep live results */ }
          }
          sources.push({ name, status: "success", message: `Loaded size-level marketplace pricing for ${uncached.length} product record(s).` });
        } catch (error) {
          sources.push({ name, status: "error", message: error instanceof Error ? error.message : "Size lookup failed." });
        }
      }
    } else {
      sources.push({ name, status: "cached", message: "Size-level marketplace data reused from Neon." });
    }
  }

  // Flight Club's product detail response exposes availableSizesNew and product images.
  // It is a 1-credit call per selected product, so it is only used for explicit comparisons.
  for (const listing of uniqueBySource.flightclub.slice(0, 3)) {
    const name = "Flight Club";
    try {
      const cached = await readCachedData("flightclub", listing.providerProductId);
      if (cached) {
        quoteMap.set(`flightclub:${listing.providerProductId}`, cached);
        sources.push({ name, status: "cached", message: "Flight Club size options and product image reused from Neon." });
        continue;
      }
      if (!(await reservePcktBudget(1))) {
        sources.push({ name, status: "budget_reached", message: "Monthly PCKT safety budget reached; no Flight Club detail request was sent." });
        continue;
      }
      await waitForPcktSlot();
      const url = new URL("https://api.pckt.sh/v1/flightclub/product");
      url.searchParams.set("id", listing.providerProductId);
      url.searchParams.set("countryCode", "US");
      url.searchParams.set("currencyCode", "USD");
      const payload = await fetchJson(url, apiKey);
      const detail = makeFlightClubDetail(payload, listing.retailer);
      quoteMap.set(`flightclub:${listing.providerProductId}`, detail);
      try { await writeCachedData("flightclub", listing.providerProductId, detail); } catch { /* keep live results */ }
      sources.push({ name, status: "success", message: `Loaded ${detail.quotes.length} explicitly available new size option(s).` });
    } catch (error) {
      sources.push({ name, status: "error", message: error instanceof Error ? error.message : "Flight Club product lookup failed." });
    }
  }

  // If the catalog card lacks artwork, load one cached product-detail image on demand.
  const imageMap = new Map<string, { imageUrl?: string; colors?: string[]; gender?: string }>();
  for (const product of products.filter((item) => item.needsImage)) {
    const cachedDetails = product.listings
      .map((listing) => quoteMap.get(`${listing.source}:${listing.providerProductId}`))
      .filter((value): value is CachedDetail => !!value);
    const detailWithImage = cachedDetails.find((detail) => Boolean(detail.imageUrl));
    if (detailWithImage?.imageUrl) {
      imageMap.set(product.catalogProductId, {
        imageUrl: detailWithImage.imageUrl,
        colors: cachedDetails.flatMap((detail) => detail.colors ?? []),
        gender: cachedDetails.find((detail) => detail.gender)?.gender,
      });
      continue;
    }

    // Search every eligible listing for a cached detail before spending a new credit.
    // StockX/GOAT details are cheaper; Flight Club artwork may already be in its size detail.
    const imageListings = product.listings
      .filter((entry) => entry.source === "stockx" || entry.source === "goat")
      .slice(0, 2);
    for (const listing of imageListings) {
      // Keep the source narrowing explicit for TypeScript before calling the
      // StockX/GOAT-only product-detail endpoint.
      if (listing.source !== "stockx" && listing.source !== "goat") continue;
      try {
        const cached = await fetchCachedProviderImage(listing.source, listing.providerProductId, apiKey);
        if (!cached) continue;
        const imageUrl = imageUrlFromItem(cached);
        const colors = [str(cached.colorway, cached.secondary_title, cached.color)].filter(Boolean);
        if (imageUrl || colors.length || str(cached.gender)) {
          imageMap.set(product.catalogProductId, { imageUrl, colors: colors.length ? colors : undefined, gender: str(cached.gender) || undefined });
        }
        if (imageUrl) break;
      } catch { /* image is optional */ }
    }
    if (!imageMap.has(product.catalogProductId) && cachedDetails.length) {
      imageMap.set(product.catalogProductId, {
        colors: cachedDetails.flatMap((detail) => detail.colors ?? []),
        gender: cachedDetails.find((detail) => detail.gender)?.gender,
      });
    }
  }

  const checks = products.map((product) => {
    const details = product.listings.map((listing) => quoteMap.get(`${listing.source}:${listing.providerProductId}`)).filter((value): value is CachedDetail => !!value);
    const image = imageMap.get(product.catalogProductId);
    return {
      catalogProductId: product.catalogProductId,
      quotes: dedupeQuotes(details.flatMap((detail) => detail.quotes)),
      imageUrl: image?.imageUrl ?? details.find((detail) => detail.imageUrl)?.imageUrl,
      colors: image?.colors ?? details.flatMap((detail) => detail.colors ?? []),
      gender: image?.gender ?? details.find((detail) => detail.gender)?.gender,
    };
  });
  return NextResponse.json({ checks, sources, checkedAt: new Date().toISOString(), cacheHours: 6 });
}
