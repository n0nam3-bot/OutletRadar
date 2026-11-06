import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { filterOfferSizeLabels, inferListingAudience, isOfferAllowedForAudience } from "@/lib/audience";
import { persistCatalogSnapshot } from "@/lib/catalog-store";
import { CHANNEL3_CACHE_HOURS, channel3Candidates, channel3Configured, searchChannel3 } from "@/lib/channel3";
import { getProviderCooldown, recordProviderFailure, recordProviderSuccess } from "@/lib/provider-health";
import { reserveProviderBudget } from "@/lib/provider-budget";
import type { CatalogBrowseProduct, CatalogListing, MarketplaceOffer, MarketplaceProvider, MarketplaceSourceStatus } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

const CACHE_HOURS = 6;
const sources = [
  { key: "stockx", name: "StockX", path: "/v1/catalog/stockx/search", credits: 0.4, params: (q: string) => ({ query: q, page: "1", market: "US" }) },
  { key: "goat", name: "GOAT", path: "/v1/catalog/goat/search", credits: 0.3, params: (q: string) => ({ query: q, page: "0" }) },
  { key: "flightclub", name: "Flight Club", path: "/v1/flightclub/search", credits: 1, params: (q: string) => ({ query: q, pageNumber: "1", countryCode: "US", currencyCode: "USD" }) },
  { key: "kickscrew", name: "Kicks Crew", path: "/v1/kickscrew/search", credits: 0.5, params: (q: string) => ({ query: q }) },
] as const;
type PcktSource = typeof sources[number]["key"];
type OfferSource = MarketplaceProvider;
type ExactTarget = {
  id: string;
  title: string;
  brand: string;
  category: string;
  styleCode?: string;
  color?: string;
  colors?: string[];
  gender?: string;
  requestedAudience: string;
  releaseYear?: number;
  listings: CatalogListing[];
};

type SourceStatus = MarketplaceSourceStatus & { key: OfferSource };
function obj(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function str(...values: unknown[]): string {
  for (const value of values) if (typeof value === "string" && value.trim()) return value.trim();
  return "";
}
function num(...values: unknown[]): number | undefined {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
    if (typeof value === "string") {
      const parsed = Number(value.replace(/[^0-9.]/g, ""));
      if (Number.isFinite(parsed) && parsed > 0) return parsed;
    }
  }
}
function norm(value: string): string {
  return value.toLowerCase().normalize("NFKD").replace(/[’']/g, "").replace(/[^a-z0-9.]+/g, " ").replace(/\s+/g, " ").trim();
}
function httpUrl(raw: string): string {
  try { const url = new URL(raw.startsWith("//") ? `https:${raw}` : raw); return ["http:", "https:"].includes(url.protocol) ? url.toString() : ""; }
  catch { return ""; }
}
function records(payload: unknown): Record<string, unknown>[] {
  const arrays: Record<string, unknown>[][] = [];
  const seen = new Set<object>();
  function walk(value: unknown, depth: number) {
    if (!value || typeof value !== "object" || depth > 7 || seen.has(value as object)) return;
    seen.add(value as object);
    if (Array.isArray(value)) {
      const items = value.map(obj).filter((entry): entry is Record<string, unknown> => !!entry);
      if (items.some((item) => str(item.title, item.name, item.productName, item.product_name, item.display_name, item.product_title, item.model, item.model_name))) arrays.push(items);
      value.slice(0, 100).forEach((entry) => walk(entry, depth + 1));
      return;
    }
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (["response", "data", "results", "products", "items", "hits", "catalog", "searchResults", "shopping_results"].includes(key) || (depth < 3 && child && typeof child === "object")) walk(child, depth + 1);
    }
  }
  walk(payload, 0);
  arrays.sort((a, b) => b.length - a.length);
  return arrays[0] ?? [];
}
function imageUrlFromValue(value: unknown, depth = 0): string | undefined {
  if (depth > 6 || value == null) return undefined;
  if (typeof value === "string") return httpUrl(value) || undefined;
  if (Array.isArray(value)) {
    for (const entry of value.slice(0, 20)) { const image = imageUrlFromValue(entry, depth + 1); if (image) return image; }
    return undefined;
  }
  const record = obj(value);
  if (!record) return undefined;
  for (const key of ["url", "src", "src_url", "image_url", "imageUrl", "imageURL", "image_url_https", "original", "original_url", "originalSrc", "large", "large_url", "thumbnail", "thumbnail_url", "href", "image_src", "imageSrc", "featured_image_url", "product_image_url", "productImageUrl", "picture_url", "original_image", "originalImage", "media_url", "mediaUrl", "secure_url", "main_image_url", "product_thumbnail"]) {
    if (typeof record[key] === "string") { const image = httpUrl(record[key] as string); if (image) return image; }
  }
  for (const [key, child] of Object.entries(record)) if (/image|picture|thumbnail|photo|media/i.test(key)) {
    const image = imageUrlFromValue(child, depth + 1); if (image) return image;
  }
  return undefined;
}
function imageUrlFromItem(item: Record<string, unknown>): string | undefined {
  for (const key of ["image_url", "imageUrl", "imageURL", "mainPictureUrl", "gridPictureUrl", "mainGlowPictureUrl", "gridGlowPictureUrl", "pictureUrl", "imageSrc", "thumbnail", "thumbnailUrl", "thumbnail_url", "main_image_url", "product_image_url", "featured_image_url", "productImageUrl", "primary_image", "primaryImage", "image", "images", "gallery", "media", "photos", "picture", "pictures"]) {
    if (item[key] !== undefined) { const image = imageUrlFromValue(item[key]); if (image) return image; }
  }
  return undefined;
}
function productUrl(source: PcktSource, item: Record<string, unknown>): string {
  const hosts: Record<PcktSource, string> = { stockx: "stockx.com", goat: "goat.com", flightclub: "flightclub.com", kickscrew: "kickscrew.com" };
  const raw = httpUrl(str(item.url, item.link, item.product_url, item.productUrl, item.product_link));
  if (raw) {
    try {
      const parsed = new URL(raw);
      if (parsed.hostname === hosts[source] || parsed.hostname.endsWith(`.${hosts[source]}`)) return raw;
      const unwrapped = httpUrl(parsed.searchParams.get("u") || parsed.searchParams.get("url") || "");
      if (unwrapped) { const hostname = new URL(unwrapped).hostname; if (hostname === hosts[source] || hostname.endsWith(`.${hosts[source]}`)) return unwrapped; }
    } catch { /* use canonical URL below */ }
  }
  const slug = str(item.slug, item.handle, item.url_key);
  if (!slug) return "";
  if (source === "stockx") return `https://stockx.com/${encodeURIComponent(slug)}`;
  if (source === "goat") return `https://www.goat.com/sneakers/${encodeURIComponent(slug)}`;
  if (source === "flightclub") return `https://www.flightclub.com/${encodeURIComponent(slug)}`;
  return `https://www.kickscrew.com/products/${encodeURIComponent(slug)}`;
}
function releaseYear(item: Record<string, unknown>, title: string): number | undefined {
  const explicit = [item.release_year, item.releaseYear, item.year, item.release_date, item.releaseDate, item.launch_date, item.launchDate]
    .map((value) => typeof value === "number" ? value : typeof value === "string" ? Number(value.match(/(?:19|20)\d{2}/)?.[0]) : NaN)
    .find((value) => Number.isInteger(value) && value >= 1980 && value <= 2035);
  if (explicit) return explicit;
  const match = title.match(/\b(?:19|20)\d{2}\b/);
  return match ? Number(match[0]) : undefined;
}
function brandAliases(brand: string): string[] {
  const key = norm(brand);
  const map: Record<string, string[]> = {
    jordan: ["jordan", "air jordan"], nike: ["nike"], adidas: ["adidas", "adidas originals"],
    "new balance": ["new balance", "newbalance"], asics: ["asics", "asicstiger"], puma: ["puma"],
    converse: ["converse"], reebok: ["reebok"], vans: ["vans"], yeezy: ["yeezy"], hoka: ["hoka", "hoka one one"],
    "on running": ["on running", "on"], crocs: ["crocs"], salomon: ["salomon"], timberland: ["timberland"],
    underarmour: ["under armour", "underarmour"],
  };
  return map[key] ?? [key];
}
function productTokens(title: string, brand: string): string[] {
  let value = ` ${norm(title)} `;
  for (const alias of brandAliases(brand)) value = value.replace(` ${norm(alias)} `, " ");
  if (norm(brand) === "jordan") value = value.replace(/\bnike\b/g, " ").replace(/\bair\b/g, " ");
  // Strip audience, product-type and explicit size fragments, but preserve
  // silhouette, model numbers, OG/SE/High/Low/Mid and colorway descriptors.
  value = value.replace(/\b(?:us|size)\s*\d+(?:\.\d+)?\s*[my]?\b/g, " ");
  const ignored = new Set([
    "the", "and", "for", "with", "men", "mens", "women", "womens", "male", "female",
    "kids", "kid", "youth", "unisex", "gs", "ps", "grade", "school", "toddler",
    "shoe", "shoes", "sneaker", "sneakers", "footwear", "apparel", "clothing",
  ]);
  return value.trim().split(" ").filter((token) => token && !ignored.has(token));
}
function tokenEquivalent(targetToken: string, offerTokens: Set<string>): boolean {
  if (offerTokens.has(targetToken)) return true;
  const equivalents: Record<string, string[]> = {
    banned: ["bred"], bred: ["banned"], unc: ["university", "blue"],
  };
  return (equivalents[targetToken] ?? []).some((token) => offerTokens.has(token));
}
function styleCode(item: Record<string, unknown>): string {
  // product_id is a provider's own identifier, not a cross-retailer SKU.
  return str(item.sku, item.style_code, item.styleCode, item.product_code, item.productCode);
}
function sizeLabels(item: Record<string, unknown>): string[] {
  const raw = item.sizes ?? item.available_sizes ?? item.availableSizes ?? item.size_options ?? item.sizeOptions;
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, 100).map((entry) => {
    if (typeof entry === "string" || typeof entry === "number") return String(entry).trim();
    const record = obj(entry);
    return record ? str(record.label, record.name, record.size, record.value, record.display_name) : "";
  }).filter(Boolean);
}
function colorKey(value: string): string {
  const aliases: Record<string, string[]> = {
    black: ["black", "triple black", "blackout"], white: ["white", "off white", "off-white", "sail", "ivory", "cream"],
    red: ["red", "fire red", "university red", "varsity red", "crimson", "scarlet", "cherry", "bred"],
    blue: ["blue", "royal blue", "navy", "university blue", "unc blue", "cobalt"],
    green: ["green", "pine green", "olive", "mint", "malachite"], grey: ["grey", "gray", "cement", "cool grey", "wolf grey"],
    brown: ["brown", "mocha", "chocolate", "cacao", "coffee"], tan: ["tan", "beige", "khaki", "wheat", "sand", "taupe"],
    pink: ["pink", "rose", "blush", "coral"], purple: ["purple", "violet", "lilac", "lavender"],
  };
  const normalized = norm(value);
  const family = Object.entries(aliases).find(([key, values]) => key === normalized || values.includes(normalized));
  return family?.[0] ?? normalized;
}
function exactProductMatch(offer: MarketplaceOffer, target: ExactTarget): boolean {
  if (!offer.title) return false;
  const targetYear = target.releaseYear ?? releaseYear({}, target.title);
  const candidateYear = offer.releaseYear ?? releaseYear({}, offer.title);
  if (targetYear && candidateYear !== targetYear) return false;

  const targetCode = norm(target.styleCode ?? "");
  const candidateCode = norm(offer.styleCode ?? "");
  if (targetCode && candidateCode && targetCode !== candidateCode) return false;

  const targetBrand = norm(target.brand);
  const offerBrand = norm(offer.brand ?? "");
  if (targetBrand && targetBrand !== "various brands" && offerBrand) {
    const targetAliases = brandAliases(target.brand).map(norm);
    const offerAliases = brandAliases(offer.brand ?? "").map(norm);
    const knownCompatible = targetAliases.some((alias) => offerAliases.some((other) => alias === other || alias.includes(other) || other.includes(alias)));
    const targetBrandInTitle = targetAliases.some((alias) => ` ${norm(offer.title)} `.includes(` ${alias} `));
    if (!knownCompatible && targetBrand !== offerBrand && !targetBrandInTitle) return false;
  }

  // A selected release year is a true refinement: do not show a seller's
  // listing as the exact item unless the same year is present in its metadata/title.
  const targetNumbers = productTokens(target.title, target.brand)
    .filter((token) => /^\d+(?:\.\d+)?$/.test(token) && !/^(?:19|20)\d{2}$/.test(token)).sort();
  const offerTokens = productTokens(offer.title, offer.brand || target.brand);
  const offerNumbers = offerTokens.filter((token) => /^\d+(?:\.\d+)?$/.test(token) && !/^(?:19|20)\d{2}$/.test(token)).sort();
  if (targetNumbers.length && (targetNumbers.length !== offerNumbers.length || targetNumbers.some((number, index) => number !== offerNumbers[index]))) return false;

  const targetTokens = productTokens(target.title, target.brand).filter((token) => !/^(?:19|20)\d{2}$/.test(token));
  // Normalize the offer against the selected product's brand taxonomy. Some
  // providers label Jordan products as Nike, but their actual title still says
  // Air Jordan; using that generic provider brand here would leave false tokens.
  const offerTokensForTarget = productTokens(offer.title, target.brand).filter((token) => !/^(?:19|20)\d{2}$/.test(token));
  const targetSet = new Set(targetTokens);
  const offerSet = new Set(offerTokensForTarget);
  const codeExact = Boolean(targetCode && candidateCode && targetCode === candidateCode);
  // Require the same complete set of meaningful model and variant tokens.
  // This rejects adjacent models/colorways and listings with extra model
  // descriptors. A matching manufacturer style code is an independent exact key.
  const strictTitleMatch = targetTokens.length > 0 && targetTokens.length === offerTokensForTarget.length &&
    targetTokens.every((token) => tokenEquivalent(token, offerSet)) &&
    offerTokensForTarget.every((token) => tokenEquivalent(token, targetSet));
  if (!codeExact && !strictTitleMatch) return false;

  const targetColor = target.color || target.colors?.[0] || "";
  if (targetColor && offer.color && colorKey(targetColor) !== colorKey(offer.color)) return false;
  return true;
}
function normalizePckt(source: PcktSource, item: Record<string, unknown>, target: ExactTarget): MarketplaceOffer | null {
  const title = str(item.title, item.name, item.productName, item.product_name, item.display_name, item.product_title, item.model_name, item.model);
  const brand = str(item.brand, item.brandName, item.manufacturer);
  const url = productUrl(source, item);
  if (!title || !url) return null;
  const price = num(item.lowest_ask, item.lowestAsk, item.price, item.specialDisplayPriceCents ? Number(item.specialDisplayPriceCents) / 100 : undefined, item.extracted_price);
  const sizes = sizeLabels(item);
  const listingGender = inferListingAudience(str(item.gender, item.gender_name, item.audience, item.size_category, item.sizeCategory), title, sizes);
  const offer: MarketplaceOffer = {
    id: `${source}:${str(item.id, item.product_id, item.productId, item.slug, url)}`,
    providerProductId: str(item.id, item.product_id, item.productId, item.slug) || undefined,
    condition: str(item.condition, item.product_condition, item.state) || "Unknown",
    source, retailer: source === "stockx" ? "StockX" : source === "goat" ? "GOAT" : source === "flightclub" ? "Flight Club" : "Kicks Crew",
    channel: "online", title, url, imageUrl: imageUrlFromItem(item), styleCode: styleCode(item) || undefined,
    brand: brand || undefined, gender: listingGender === "unknown" ? undefined : listingGender, sizes: sizes.length ? sizes : undefined,
    price, currency: str(item.currency, "USD").toUpperCase(),
    priceLabel: price ? (source === "stockx" || source === "goat" ? "Lowest ask" : "Displayed price") : undefined,
    availability: "unknown", availabilityLabel: "Exact product listing found · verify size and checkout status with seller",
    releaseYear: releaseYear(item, title),
  };
  return exactProductMatch(offer, target) ? offer : null;
}
function normalizeShopping(item: Record<string, unknown>, target: ExactTarget): MarketplaceOffer | null {
  const title = str(item.title, item.product_title);
  const retailer = str(item.source, item.seller, item.merchant, item.store);
  const url = httpUrl(str(item.product_link, item.link, item.url));
  if (!title || !retailer || !url) return null;
  const sizes = sizeLabels(item);
  const listingGender = inferListingAudience(str(item.gender, item.gender_name, item.audience, item.size_category, item.sizeCategory), title, sizes);
  const offer: MarketplaceOffer = {
    id: `shopping:${str(item.product_id, item.position, title)}:${retailer}`, providerProductId: str(item.product_id, item.gtin, item.sku) || undefined,
    condition: str(item.condition, item.product_condition) || "Unknown", source: "shopping", retailer,
    channel: "online", title, url, imageUrl: imageUrlFromItem(item), styleCode: styleCode(item) || undefined,
    brand: str(item.brand, item.manufacturer) || undefined, gender: listingGender === "unknown" ? undefined : listingGender,
    sizes: sizes.length ? sizes : undefined, price: num(item.extracted_price, item.price),
    currency: str(item.currency, "USD").toUpperCase(), priceLabel: "Displayed price", availability: "unknown",
    availabilityLabel: "Retailer listing found · selected-size stock is not confirmed", releaseYear: releaseYear(item, title),
  };
  return exactProductMatch(offer, target) ? offer : null;
}
function seedListingOffer(listing: CatalogListing, target: ExactTarget, index: number): MarketplaceOffer | null {
  const url = httpUrl(listing.url);
  if (!url) return null;
  return {
    id: `catalog:${listing.source}:${createHash("sha1").update(url).digest("hex").slice(0, 12)}:${index}`,
    source: listing.source, providerProductId: listing.providerProductId, condition: "Unknown",
    retailer: listing.retailer, channel: "online", title: listing.title || target.title, url,
    imageUrl: listing.imageUrl, styleCode: target.styleCode, brand: target.brand,
    gender: inferListingAudience(listing.gender, listing.title || target.title, listing.sizes) === "unknown" ? undefined : inferListingAudience(listing.gender, listing.title || target.title, listing.sizes),
    color: listing.color, sizes: listing.sizes,
    price: listing.price,
    priceLabel: listing.source === "stockx" || listing.source === "goat" ? "Catalog marketplace price" : "Listed price",
    currency: listing.currency || "USD", availability: "unknown",
    availabilityLabel: "This listing was grouped with the selected catalog model; confirm the selected variant and size on the seller page.",
    releaseYear: listing.releaseYear,
  };
}

/** Channel3 titles are normalized by Channel3 and rarely equal a marketplace's title,
 * so an offer matches when it contains every model word of the selected product and the
 * same model numbers. Extra words (gender, "Shoes") are allowed; audience filtering
 * runs afterwards and removes kids/other-audience listings. */
function channel3Match(offer: MarketplaceOffer, target: ExactTarget): boolean {
  const isYear = (token: string) => /^(?:19|20)\d{2}$/.test(token);
  const isNumber = (token: string) => /^\d+(?:\.\d+)?$/.test(token) && !isYear(token);
  const targetTokens = productTokens(target.title, target.brand).filter((token) => !isYear(token));
  if (!targetTokens.length) return false;
  const offerTokens = productTokens(offer.title, target.brand).filter((token) => !isYear(token));
  const offerSet = new Set(offerTokens);
  const targetNumbers = targetTokens.filter(isNumber).sort();
  const offerNumbers = offerTokens.filter(isNumber).sort();
  if (targetNumbers.length && (targetNumbers.length !== offerNumbers.length || targetNumbers.some((number, index) => number !== offerNumbers[index]))) return false;
  return targetTokens.every((token) => tokenEquivalent(token, offerSet));
}
function sourceKeyConfigured(key: string): boolean {
  if (key === "shopping") return Boolean(process.env.SERPAPI_API_KEY);
  if (key === "channel3") return channel3Configured();
  if (key === "nike") return Boolean(process.env.API_SH_KEY);
  return Boolean(process.env.PCKT_API_KEY);
}

async function readCache(key: string) {
  const sql = getDb(); if (!sql) return null;
  const rows = await sql`SELECT results_json, sources_json, cached_at FROM retailer_search_cache WHERE cache_key = ${key} AND expires_at > now() LIMIT 1` as Array<Record<string, unknown>>;
  const row = rows[0]; if (!row) return null;
  const offers = typeof row.results_json === "string" ? JSON.parse(row.results_json) : row.results_json;
  const statuses = typeof row.sources_json === "string" ? JSON.parse(row.sources_json) : row.sources_json;
  if (!Array.isArray(offers)) return null;
  return { offers: offers as MarketplaceOffer[], sources: Array.isArray(statuses) ? statuses as SourceStatus[] : [], cachedAt: row.cached_at };
}
async function writeCache(key: string, query: string, offers: MarketplaceOffer[], statuses: SourceStatus[], ttlHours = CACHE_HOURS) {
  const sql = getDb(); if (!sql) return;
  await sql`
    INSERT INTO retailer_search_cache (cache_key, query_text, results_json, sources_json, cached_at, expires_at)
    VALUES (${key}, ${query}, ${JSON.stringify(offers)}::jsonb, ${JSON.stringify(statuses)}::jsonb, now(), now() + (${ttlHours} * interval '1 hour'))
    ON CONFLICT (cache_key) DO UPDATE SET query_text = EXCLUDED.query_text, results_json = EXCLUDED.results_json,
      sources_json = EXCLUDED.sources_json, cached_at = now(), expires_at = now() + (${ttlHours} * interval '1 hour')
  `;
}
function buildExactQuery(target: ExactTarget): string {
  const audience = target.requestedAudience === "men" ? "Mens" : target.requestedAudience === "women" ? "Womens" : target.requestedAudience === "kids" ? "Kids" : target.requestedAudience === "unisex" ? "Unisex" : "";
  return [target.brand, target.title, target.styleCode, target.color, target.releaseYear, audience].filter(Boolean).join(" ").slice(0, 150);
}

export async function POST(request: NextRequest) {
  const sql = getDb();
  const persistenceAvailable = Boolean(sql);
  const body = obj(await request.json().catch(() => ({})));
  const raw = obj(body?.product);
  const title = str(raw?.title);
  const brand = str(raw?.brand);
  if (!raw || title.length < 2 || title.length > 180 || !brand) return NextResponse.json({ error: "A selected catalog product with a title and brand is required." }, { status: 400 });
  const target: ExactTarget = {
    id: str(raw.id), title, brand, category: str(raw.category), styleCode: str(raw.styleCode) || undefined,
    color: str(raw.color) || undefined,
    colors: Array.isArray(raw.colors) ? raw.colors.filter((value): value is string => typeof value === "string").slice(0, 10) : [],
    gender: str(raw.gender) || undefined,
    requestedAudience: ["men", "women", "kids", "unisex"].includes(str(body?.audience, raw.requestedAudience, "all").toLowerCase())
      ? str(body?.audience, raw.requestedAudience, "all").toLowerCase()
      : "all",
    releaseYear: Number.isInteger(Number(raw.releaseYear)) && Number(raw.releaseYear) >= 1980 && Number(raw.releaseYear) <= 2035 ? Number(raw.releaseYear) : undefined,
    listings: Array.isArray(raw.listings) ? raw.listings.slice(0, 20).map(obj).filter((value): value is Record<string, unknown> => !!value).map((item) => ({
      source: str(item.source) as OfferSource,
      retailer: str(item.retailer, item.source), title: str(item.title) || undefined,
      url: str(item.url), providerProductId: str(item.providerProductId) || undefined,
      styleCode: str(item.styleCode) || undefined,
      imageUrl: str(item.imageUrl) || undefined,
      price: num(item.price), originalPrice: num(item.originalPrice), currency: str(item.currency, "USD"),
      color: str(item.color) || undefined,
      sizes: Array.isArray(item.sizes) ? item.sizes.filter((value): value is string => typeof value === "string").slice(0, 100) : undefined,
      gender: str(item.gender) as CatalogListing["gender"],
      releaseYear: Number.isInteger(Number(item.releaseYear)) ? Number(item.releaseYear) : undefined,
      onSale: typeof item.onSale === "boolean" ? item.onSale : undefined,
    })).filter((item) => ["stockx", "goat", "flightclub", "kickscrew", "shopping", "nike"].includes(item.source)) : [],
  };
  const query = buildExactQuery(target);
  const listingSignature = target.listings.map((listing) => `${listing.source}:${listing.url.toLowerCase()}`).sort().join("|");
  const cacheIdentity = ["exact-offers:v10", target.brand, target.title, target.styleCode || "", target.color || "", target.releaseYear || "", target.gender || "", target.requestedAudience, listingSignature].map(String).join(":");
  const cacheKey = createHash("sha256").update(norm(cacheIdentity)).digest("hex");
  try {
    const cached = await readCache(cacheKey);
    const newlyConfigured = cached?.sources.some((source) => source.status === "not_configured" && sourceKeyConfigured(source.key));
    if (cached && !newlyConfigured) {
      const cachedProduct: CatalogBrowseProduct = {
        id: target.id || cacheKey.slice(0, 20), title: target.title, brand: target.brand,
        category: (["sneakers", "apparel", "accessories", "all"].includes(target.category) ? target.category : "all") as CatalogBrowseProduct["category"],
        styleCode: target.styleCode, imageUrl: target.listings.find((listing) => listing.imageUrl)?.imageUrl,
        sources: [...new Set(target.listings.map((listing) => listing.retailer))], listings: target.listings,
        color: target.color, colors: target.colors, gender: (target.gender as CatalogBrowseProduct["gender"]) || "Unknown",
        releaseYear: target.releaseYear,
      };
      try { await persistCatalogSnapshot([cachedProduct], cached.offers); } catch { /* backfill is best-effort */ }
      return NextResponse.json({ productId: target.id, offers: cached.offers, sources: cached.sources, cached: true, cachedAt: cached.cachedAt, cacheHours: CACHE_HOURS, note: "Comparison reuses the selected product’s grouped retailer listings; opening this panel does not trigger broad catalog searches." });
    }
  } catch {
    return NextResponse.json({ error: "Could not read the exact-product comparison cache. Confirm retailer_search_cache exists in the Neon branch used by DATABASE_URL." }, { status: 503 });
  }

  // Compare offers must not trigger another broad provider search. The catalog
  // request has already discovered and grouped these exact retailer URLs; search
  // again here was duplicating PCKT + SerpApi usage and occasionally reintroducing
  // neighboring models. Reuse the product's own grouped listings only.
  const offers: MarketplaceOffer[] = target.listings
    .map((listing, index) => seedListingOffer(listing, target, index))
    .filter((offer): offer is MarketplaceOffer => !!offer);

  const sourceNames: Record<OfferSource, string> = {
    stockx: "StockX", goat: "GOAT", flightclub: "Flight Club",
    kickscrew: "Kicks Crew", shopping: "Google Shopping merchants",
    nike: "Nike.com", channel3: "Channel3 merchants",
  };
  const statuses: SourceStatus[] = (Object.keys(sourceNames) as OfferSource[]).map((source) => {
    const count = offers.filter((offer) => offer.source === source).length;
    return {
      key: source,
      name: sourceNames[source],
      status: "cached",
      results: count,
      message: count
        ? `${count} exact retailer listing(s) reused from the selected catalog product. No new provider search request or credit was used.`
        : "No listing from this retailer was present in the selected product's catalog group. Compare offers will not insert a similar product from a new broad search.",
    };
  });

  // Live cross-merchant lookup. Channel3 matches this product to offers at many stores
  // (Foot Locker, JD Sports, Champs, adidas.com, newbalance.com, puma.com, ...). One credit,
  // cached for CHANNEL3_CACHE_HOURS, and never saved to the normalized catalog (see lib/channel3.ts).
  const channel3Status: SourceStatus = { key: "channel3", name: sourceNames.channel3, status: "not_configured", results: 0, message: "Add CHANNEL3_API_KEY in Vercel to also compare offers from many other stores." };
  if (channel3Configured()) {
    const cooldown = await getProviderCooldown("channel3");
    if (cooldown.paused) {
      Object.assign(channel3Status, { status: "cooldown", message: `Temporarily paused after repeated provider errors${cooldown.disabledUntil ? ` until ${cooldown.disabledUntil}` : ""}.` });
    } else if (!(await reserveProviderBudget("channel3", 1))) {
      Object.assign(channel3Status, { status: "budget_reached", message: "Daily or monthly Channel3 safety budget reached. Other retailers are still shown." });
    } else {
      const startedAt = Date.now();
      try {
        const channel3Query = [target.title, target.styleCode, norm(target.title).includes(norm(target.brand)) ? "" : target.brand].filter(Boolean).join(" ").slice(0, 150);
        const candidates = channel3Candidates(await searchChannel3(channel3Query, 20));
        const known = new Set(offers.map((offer) => norm(offer.retailer)));
        const cheapestPerRetailer = new Map<string, MarketplaceOffer>();
        for (const { offer } of candidates) {
          if (!channel3Match(offer, target)) continue;
          const retailerKey = norm(offer.retailer);
          if (known.has(retailerKey)) continue; // already listed from the catalog group
          const current = cheapestPerRetailer.get(retailerKey);
          if (!current || (offer.price ?? Infinity) < (current.price ?? Infinity)) cheapestPerRetailer.set(retailerKey, offer);
        }
        const found = [...cheapestPerRetailer.values()];
        offers.push(...found);
        await recordProviderSuccess("channel3", Date.now() - startedAt, found.length);
        Object.assign(channel3Status, { status: "success", results: found.length, message: found.length ? `${found.length} additional store offer(s) matched this exact product. Prices change quickly; confirm size and stock on the seller page.` : "No additional store offers matched this exact product." });
      } catch (error) {
        await recordProviderFailure("channel3", Date.now() - startedAt, error);
        Object.assign(channel3Status, { status: "error", message: error instanceof Error ? error.message : "Channel3 request failed." });
      }
    }
  }
  const statusIndex = statuses.findIndex((status) => status.key === "channel3");
  if (statusIndex >= 0) statuses[statusIndex] = channel3Status; else statuses.push(channel3Status);

  // Apply the audience selected by the shopper to each retailer listing, not
  // merely to the grouped catalog card. GS/PS/youth variants are excluded from
  // adult comparisons even when a marketplace grouped them under one silhouette.
  const audienceFilteredOffers = offers
    .filter((offer) => isOfferAllowedForAudience(
      target.requestedAudience,
      offer.gender,
      offer.title,
      offer.sizes ?? [],
    ))
    .map((offer) => ({
      ...offer,
      // Do not let the UI fall back to child-size labels after adult size
      // quotes have been filtered out. Unknown numeric sizing stays unverified.
      sizes: filterOfferSizeLabels(offer.sizes, target.requestedAudience, offer.gender),
    }));
  const unique = new Map<string, MarketplaceOffer>();
  for (const offer of audienceFilteredOffers) {
    const key = `${offer.source}:${offer.url.toLowerCase()}`;
    if (!unique.has(key)) unique.set(key, offer);
  }
  const results = [...unique.values()].sort((a, b) => (a.price ?? Number.MAX_SAFE_INTEGER) - (b.price ?? Number.MAX_SAFE_INTEGER)).slice(0, 40);
  const canonicalProduct: CatalogBrowseProduct = {
    id: target.id || cacheKey.slice(0, 20), title: target.title, brand: target.brand,
    category: (["sneakers", "apparel", "accessories", "all"].includes(target.category) ? target.category : "all") as CatalogBrowseProduct["category"],
    styleCode: target.styleCode, imageUrl: target.listings.find((listing) => listing.imageUrl)?.imageUrl,
    sources: [...new Set(target.listings.map((listing) => listing.retailer))], listings: target.listings,
    color: target.color, colors: target.colors, gender: (target.gender as CatalogBrowseProduct["gender"]) || "Unknown",
    releaseYear: target.releaseYear,
  };
  try { await persistCatalogSnapshot([canonicalProduct], results); } catch { /* normalized inventory is an additive index; offers remain visible */ }
  // Channel3 data is cached for hours, not days. A Channel3 failure or exhausted budget
  // is not cached so the next Compare can retry once it recovers.
  const channel3Incomplete = ["budget_reached", "cooldown", "error"].includes(channel3Status.status);
  const ttlHours = channel3Status.status === "success" ? CHANNEL3_CACHE_HOURS : CACHE_HOURS;
  if (!channel3Incomplete) {
    try { await writeCache(cacheKey, query, results, statuses, ttlHours); } catch { /* keep live offers visible if caching fails */ }
  }
  return NextResponse.json({ productId: target.id, offers: results, sources: statuses, cached: false, persistenceAvailable, cacheHours: CACHE_HOURS, note: "Only direct retailer listings already grouped with this exact catalog product are shown. Compare offers does not run new broad product searches or spend catalog-search credits. The seller page remains the final source for variant and checkout confirmation." });
}
