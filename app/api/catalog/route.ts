import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import type { CatalogBrowseCategory, CatalogBrowseProduct, CatalogListing, MarketplaceSourceStatus } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

// The catalog is a discovery index, not a live stock feed. PCKT itself may serve
// cached catalog snapshots up to 24 hours old; Neon caches a chosen brand/type
// combination for 12 hours to avoid repeating provider requests.
const CACHE_HOURS = 12;
const PCKT_MONTHLY_BUDGET = 450;
const SERPAPI_MONTHLY_BUDGET = 200;
const pcktSources = [
  { key: "stockx", name: "StockX", path: "/v1/catalog/stockx/search", credits: 0.4, categories: ["sneakers", "apparel", "accessories"] as CatalogBrowseCategory[], params: (q: string) => ({ query: q, page: "1", market: "US" }) },
  { key: "goat", name: "GOAT", path: "/v1/catalog/goat/search", credits: 0.3, categories: ["sneakers", "apparel", "accessories"] as CatalogBrowseCategory[], params: (q: string) => ({ query: q, page: "0" }) },
  { key: "flightclub", name: "Flight Club", path: "/v1/flightclub/search", credits: 1, categories: ["sneakers"] as CatalogBrowseCategory[], params: (q: string) => ({ query: q, pageNumber: "1", countryCode: "US", currencyCode: "USD" }) },
  { key: "kickscrew", name: "Kicks Crew", path: "/v1/kickscrew/search", credits: 0.5, categories: ["sneakers"] as CatalogBrowseCategory[], params: (q: string) => ({ query: q }) },
] as const;
type PcktKey = typeof pcktSources[number]["key"];

type InternalListing = CatalogListing & {
  brand: string; title: string; category: CatalogBrowseCategory;
  imageUrl?: string; styleCode?: string;
};

const BRAND_QUERY_TERMS: Record<string, string> = {
  nike: "Nike", jordan: "Jordan", adidas: "Adidas", "new balance": "New Balance", asics: "ASICS",
  puma: "Puma", converse: "Converse", reebok: "Reebok", vans: "Vans", yeezy: "Yeezy",
  hoka: "HOKA", "on running": "On Running", crocs: "Crocs", salomon: "Salomon",
  timberland: "Timberland", underarmour: "Under Armour",
};

const BRAND_ALIASES: Record<string, string[]> = {
  nike: ["nike"], jordan: ["jordan", "air jordan"], adidas: ["adidas", "adidas originals"],
  "new balance": ["new balance", "newbalance"], asics: ["asics", "asicstiger"], puma: ["puma"],
  converse: ["converse"], reebok: ["reebok"], vans: ["vans"], yeezy: ["yeezy"],
  hoka: ["hoka", "hoka one one"], "on running": ["on running", "on"], crocs: ["crocs"],
  salomon: ["salomon"], timberland: ["timberland"], underarmour: ["under armour", "underarmour"],
};

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
  return value.toLowerCase().normalize("NFKD").replace(/[’']/g, "").replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function bool(...values: unknown[]): boolean | undefined {
  for (const value of values) {
    if (typeof value === "boolean") return value;
    if (typeof value === "number" && (value === 0 || value === 1)) return value === 1;
    if (typeof value === "string") {
      const normalized = value.trim().toLowerCase();
      if (["true", "yes", "on", "sale", "clearance"].includes(normalized)) return true;
      if (["false", "no", "off", "regular"].includes(normalized)) return false;
    }
  }
  return undefined;
}
function textValues(...values: unknown[]): string[] {
  const found: string[] = [];
  for (const value of values) {
    if (typeof value === "string" && value.trim()) found.push(value.trim());
    else if (Array.isArray(value)) {
      for (const item of value) {
        if (typeof item === "string" && item.trim()) found.push(item.trim());
        else {
          const record = obj(item);
          if (record) {
            const label = str(record.size, record.label, record.name, record.value, record.size_label, record.sizeName, record.size_name, record.display_value, record.displayValue);
            if (label) found.push(label);
          }
        }
      }
    }
  }
  return [...new Set(found)];
}
function inferGender(item: Record<string, unknown>, title: string): NonNullable<CatalogBrowseProduct["gender"]> {
  const raw = norm(str(item.gender, item.audience, item.department, item.target_gender, item.product_gender));
  const descriptor = `${norm(title)} ${norm(str(item.description, item.product_type, item.category))} ${raw}`;
  if (/\b(big kids?|grade school|gs|little kids?|preschool|ps|toddler|infant|youth|kids?|boys?|girls?)\b/.test(descriptor)) return "Kids";
  const hasMen = /\b(men|mens|male)\b/.test(descriptor);
  const hasWomen = /\b(women|womens|female)\b/.test(descriptor);
  if (hasMen && hasWomen) return "Unisex";
  if (hasMen) return "Men";
  if (hasWomen) return "Women";
  if (/\b(unisex|all gender|adult)\b/.test(descriptor) || raw === "unisex") return "Unisex";
  return "Unknown";
}
function catalogFields(item: Record<string, unknown>, title: string) {
  const price = num(item.extracted_price, item.price, item.lowest_price, item.current_price, item.sale_price, item.amount);
  const originalPrice = num(item.old_price, item.original_price, item.retail_price, item.full_price, item.compare_at_price, item.msrp);
  const explicitSale = bool(item.on_sale, item.onSale, item.is_sale, item.isSale, item.sale, item.clearance);
  const sizes = textValues(item.sizes, item.available_sizes, item.availableSizes, item.size_options, item.sizeOptions, item.size_variants, item.sizeVariants, item.variants);
  const colors = textValues(item.color, item.colour, item.colorway, item.color_name, item.colorName, item.colors, item.color_options, item.colorOptions);
  return {
    price,
    originalPrice,
    currency: str(item.currency, item.currency_code, item.price_currency, "USD").toUpperCase(),
    gender: inferGender(item, title),
    sizes: sizes.length ? sizes : undefined,
    color: colors[0],
    onSale: explicitSale ?? (price !== undefined && originalPrice !== undefined ? originalPrice > price : undefined),
  };
}

function httpUrl(raw: string): string {
  try { const url = new URL(raw); return ["http:", "https:"].includes(url.protocol) ? url.toString() : ""; }
  catch { return ""; }
}
function records(payload: unknown): Record<string, unknown>[] {
  const arrays: Record<string, unknown>[][] = [];
  const seen = new Set<object>();
  function walk(value: unknown, depth: number) {
    if (!value || typeof value !== "object" || depth > 7 || seen.has(value as object)) return;
    seen.add(value as object);
    if (Array.isArray(value)) {
      const items = value.map(obj).filter((item): item is Record<string, unknown> => !!item);
      if (items.some((item) => str(item.title, item.name, item.productName, item.product_name, item.display_name, item.product_title, item.model, item.model_name))) arrays.push(items);
      value.slice(0, 100).forEach((item) => walk(item, depth + 1));
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
function categoryText(item: Record<string, unknown>): string {
  const values: string[] = [];
  for (const key of ["product_type", "productType", "category", "categories", "brand_categories", "type", "department"]) {
    const value = item[key];
    if (typeof value === "string") values.push(value);
    else if (Array.isArray(value)) {
      for (const entry of value) {
        if (typeof entry === "string") values.push(entry);
        else { const record = obj(entry); if (record) values.push(str(record.name, record.title, record.label, record.value)); }
      }
    } else if (obj(value)) {
      const record = obj(value)!;
      values.push(str(record.name, record.title, record.label, record.value));
    }
  }
  return norm(values.join(" "));
}
function inferBrand(itemBrand: string, title: string, selectedBrand: string): string {
  if (itemBrand.trim()) return itemBrand.trim();
  if (selectedBrand !== "all") return BRAND_QUERY_TERMS[selectedBrand] ?? selectedBrand;
  const titleNorm = ` ${norm(title)} `;
  // Prefer the sneaker-specific Jordan/Yeezy brands before parent companies such as Nike or Adidas.
  const priority = ["jordan", "yeezy", "new balance", "asics", "on running", "underarmour", "timberland", "salomon", "hoka", "crocs", "converse", "reebok", "vans", "puma", "adidas", "nike"];
  for (const key of priority) {
    const aliases = BRAND_ALIASES[key] ?? [key];
    if (aliases.some((alias) => titleNorm.includes(` ${norm(alias)} `))) return BRAND_QUERY_TERMS[key] ?? key;
  }
  return "Various brands";
}
function matchesBrand(itemBrand: string, title: string, selectedBrand: string): boolean {
  if (selectedBrand === "all") return true;
  const aliases = BRAND_ALIASES[selectedBrand] ?? [selectedBrand];
  const actual = norm(itemBrand);
  const titleNorm = ` ${norm(title)} `;
  if (actual && aliases.some((alias) => actual === norm(alias) || actual.includes(norm(alias)))) return true;
  return aliases.some((alias) => titleNorm.includes(` ${norm(alias)} `));
}
function matchesCategory(item: Record<string, unknown>, title: string, selected: CatalogBrowseCategory, source: PcktKey | "shopping"): boolean {
  if (selected === "all") return true;
  const meta = categoryText(item);
  const text = `${meta} ${norm(title)} ${norm(str(item.description, item.model, item.name))}`;
  const apparel = /\b(apparel|clothing|streetwear|outerwear|shirt|hoodie|sweatshirt|sweater|jacket|pants|shorts|jersey|tee|leggings|fleece)\b/;
  const accessories = /\b(accessor|bag|backpack|cap|hat|sock|wallet|belt|bottle|glove|beanie)\b/;
  const shoes = /\b(sneaker|shoe|footwear|cleat|boot|runner)\b/;
  if (selected === "sneakers") {
    if (apparel.test(text) || accessories.test(text)) return false;
    if (meta && (apparel.test(meta) || accessories.test(meta))) return false;
    return source !== "shopping" || shoes.test(text) || !meta;
  }
  if (selected === "apparel") {
    if (shoes.test(meta) || accessories.test(meta)) return false;
    return apparel.test(text);
  }
  if (selected === "accessories") {
    if (shoes.test(meta) || apparel.test(meta)) return false;
    return accessories.test(text);
  }
  return true;
}
function matchesModelNumbers(title: string, item: Record<string, unknown>, query: string): boolean {
  const requested: string[] = query.match(/\d+(?:\.\d+)?/g) ?? [];
  if (!requested.length) return true;
  const searchable = [title, str(item.style_code, item.styleCode, item.sku, item.product_code, item.description)].join(" ");
  const returned: string[] = searchable.match(/\d+(?:\.\d+)?/g) ?? [];
  return requested.every((number) => returned.includes(number));
}
function inferCatalogCategory(item: Record<string, unknown>, title: string): CatalogBrowseCategory {
  const text = `${categoryText(item)} ${norm(title)} ${norm(str(item.description, item.model, item.name))}`;
  if (/\b(apparel|clothing|streetwear|outerwear|shirt|hoodie|sweatshirt|sweater|jacket|pants|shorts|jersey|tee|leggings|fleece)\b/.test(text)) return "apparel";
  if (/\b(accessor|bag|backpack|cap|hat|sock|wallet|belt|bottle|glove|beanie)\b/.test(text)) return "accessories";
  if (/\b(sneaker|shoe|footwear|cleat|boot|runner|jordan|dunk|air max|samba|gazelle|990|9060)\b/.test(text)) return "sneakers";
  return "all";
}
function sourceProductUrl(source: PcktKey, item: Record<string, unknown>): string {
  const hosts: Record<PcktKey, string> = { stockx: "stockx.com", goat: "goat.com", flightclub: "flightclub.com", kickscrew: "kickscrew.com" };
  const raw = httpUrl(str(item.url, item.link, item.product_url, item.productUrl, item.product_link));
  if (raw) {
    try {
      const parsed = new URL(raw);
      if (parsed.hostname === hosts[source] || parsed.hostname.endsWith(`.${hosts[source]}`)) return raw;
      const unwrapped = httpUrl(parsed.searchParams.get("u") || parsed.searchParams.get("url") || "");
      if (unwrapped) {
        const hostname = new URL(unwrapped).hostname;
        if (hostname === hosts[source] || hostname.endsWith(`.${hosts[source]}`)) return unwrapped;
      }
    } catch { /* fall back to source-specific canonical URL */ }
  }
  const slug = str(item.slug, item.handle, item.url_key);
  if (!slug) return "";
  if (source === "stockx") return `https://stockx.com/${encodeURIComponent(slug)}`;
  if (source === "goat") return `https://www.goat.com/sneakers/${encodeURIComponent(slug)}`;
  if (source === "flightclub") return `https://www.flightclub.com/${encodeURIComponent(slug)}`;
  return `https://www.kickscrew.com/products/${encodeURIComponent(slug)}`;
}
function typeLabel(category: CatalogBrowseCategory) {
  return category === "sneakers" ? "sneakers" : category === "apparel" ? "apparel" : category === "accessories" ? "accessories" : "products";
}
function normalizePckt(source: PcktKey, item: Record<string, unknown>, brandFilter: string, category: CatalogBrowseCategory, searchQuery: string): InternalListing | null {
  const title = str(item.title, item.name, item.productName, item.product_name, item.display_name, item.product_title, item.model_name, item.model);
  if (!title) return null;
  const brand = inferBrand(str(item.brand, item.brandName, item.manufacturer), title, brandFilter);
  if (!matchesBrand(brand, title, brandFilter) || !matchesCategory(item, title, category, source) || !matchesModelNumbers(title, item, searchQuery)) return null;
  const url = sourceProductUrl(source, item);
  if (!url) return null;
  const name = pcktSources.find((entry) => entry.key === source)?.name ?? source;
  return {
    source, retailer: name, url,
    title: str(item.title, item.display_name, item.product_title, item.name, item.model_name, item.model),
    brand, category: category === "all" ? inferCatalogCategory(item, title) : category,
    imageUrl: httpUrl(str(item.image_url, item.imageUrl, item.mainPictureUrl, item.gridPictureUrl, item.thumbnail, item.image)) || undefined,
    styleCode: str(item.sku, item.style_code, item.styleCode, item.product_code, item.product_id) || undefined,
    ...catalogFields(item, title),
  };
}
function normalizeShopping(item: Record<string, unknown>, brandFilter: string, category: CatalogBrowseCategory, searchQuery: string): InternalListing | null {
  const title = str(item.title, item.product_title);
  const brand = inferBrand(str(item.brand, item.manufacturer), title, brandFilter);
  const retailer = str(item.source, item.seller, item.merchant, item.store);
  const url = httpUrl(str(item.product_link, item.link, item.url));
  if (!title || !retailer || !url || !matchesBrand(brand, title, brandFilter) || !matchesCategory(item, title, category, "shopping") || !matchesModelNumbers(title, item, searchQuery)) return null;
  return {
    source: "shopping", retailer, url, title, brand, category: category === "all" ? inferCatalogCategory(item, title) : category,
    imageUrl: httpUrl(str(item.thumbnail, item.image, item.image_url)) || undefined,
    styleCode: str(item.product_id, item.sku, item.gtin) || undefined,
    ...catalogFields(item, title),
  };
}
function groupListings(listings: InternalListing[]): CatalogBrowseProduct[] {
  const grouped = new Map<string, CatalogBrowseProduct>();
  for (const listing of listings) {
    const identity = listing.styleCode ? `${norm(listing.brand)}:sku:${norm(listing.styleCode)}` : `${norm(listing.brand)}:title:${norm(listing.title)}`;
    const current = grouped.get(identity);
    if (!current) {
      grouped.set(identity, {
        id: createHash("sha1").update(identity).digest("hex").slice(0, 20),
        title: listing.title,
        brand: listing.brand,
        category: listing.category,
        styleCode: listing.styleCode,
        imageUrl: listing.imageUrl,
        sources: [listing.retailer],
        listings: [{ source: listing.source, retailer: listing.retailer, url: listing.url, price: listing.price, originalPrice: listing.originalPrice, currency: listing.currency, color: listing.color, sizes: listing.sizes, gender: listing.gender, onSale: listing.onSale }],
        price: listing.price,
        originalPrice: listing.originalPrice,
        currency: listing.currency,
        color: listing.color,
        colors: listing.color ? [listing.color] : [],
        sizes: listing.sizes ?? [],
        gender: listing.gender ?? "Unknown",
        onSale: listing.onSale,
      });
    } else {
      if (!current.imageUrl && listing.imageUrl) current.imageUrl = listing.imageUrl;
      if (!current.styleCode && listing.styleCode) current.styleCode = listing.styleCode;
      if (!current.sources.includes(listing.retailer)) current.sources.push(listing.retailer);
      current.listings.push({ source: listing.source, retailer: listing.retailer, url: listing.url, price: listing.price, originalPrice: listing.originalPrice, currency: listing.currency, color: listing.color, sizes: listing.sizes, gender: listing.gender, onSale: listing.onSale });
      if (listing.price !== undefined && (current.price === undefined || listing.price < current.price)) {
        current.price = listing.price;
        current.originalPrice = listing.originalPrice;
        current.currency = listing.currency || current.currency || "USD";
      }
      if ((!current.color || current.color === "") && listing.color) current.color = listing.color;
      if (listing.color && !current.colors?.some((value) => norm(value) === norm(listing.color!))) current.colors = [...(current.colors ?? []), listing.color];
      if (listing.sizes?.length) current.sizes = [...new Set([...(current.sizes ?? []), ...listing.sizes])];
      if ((!current.gender || current.gender === "Unknown") && listing.gender && listing.gender !== "Unknown") current.gender = listing.gender;
      if (listing.onSale !== undefined) current.onSale = current.onSale === true || listing.onSale;
    }
  }
  return [...grouped.values()].sort((a, b) => a.title.localeCompare(b.title)).slice(0, 72);
}
async function fetchJson(url: URL, headers?: HeadersInit) {
  const response = await fetch(url, { headers, cache: "no-store", signal: AbortSignal.timeout(10_000) });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const data = obj(payload);
    throw new Error(str(data?.message, data?.error, data?.detail) || `HTTP ${response.status}`);
  }
  return payload;
}
async function reserveBudget(provider: "pckt" | "serpapi", units: number, ceiling: number) {
  const sql = getDb();
  if (!sql) return false;
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
async function waitForPcktSlot() {
  const sql = getDb();
  if (!sql) throw new Error("Neon is required to enforce the shared PCKT rate limit.");
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
async function readCache(key: string) {
  const sql = getDb();
  if (!sql) return null;
  const rows = await sql`SELECT results_json, sources_json, cached_at FROM retailer_search_cache WHERE cache_key = ${key} AND expires_at > now() LIMIT 1` as Array<Record<string, unknown>>;
  const row = rows[0];
  if (!row) return null;
  const products = typeof row.results_json === "string" ? JSON.parse(row.results_json) : row.results_json;
  const sources = typeof row.sources_json === "string" ? JSON.parse(row.sources_json) : row.sources_json;
  if (!Array.isArray(products)) return null;
  return { products: products as CatalogBrowseProduct[], sources: Array.isArray(sources) ? sources as Array<MarketplaceSourceStatus & { key?: string }> : [], cachedAt: row.cached_at };
}
async function writeCache(key: string, query: string, products: CatalogBrowseProduct[], sources: Array<MarketplaceSourceStatus & { key?: string }>) {
  const sql = getDb();
  if (!sql) return;
  await sql`
    INSERT INTO retailer_search_cache (cache_key, query_text, results_json, sources_json, cached_at, expires_at)
    VALUES (${key}, ${query}, ${JSON.stringify(products)}::jsonb, ${JSON.stringify(sources)}::jsonb, now(), now() + (${CACHE_HOURS} * interval '1 hour'))
    ON CONFLICT (cache_key) DO UPDATE SET query_text = EXCLUDED.query_text, results_json = EXCLUDED.results_json,
      sources_json = EXCLUDED.sources_json, cached_at = now(), expires_at = now() + (${CACHE_HOURS} * interval '1 hour')
  `;
}

export async function GET(request: NextRequest) {
  const categoryValue = (request.nextUrl.searchParams.get("category") || "sneakers").toLowerCase();
  const category = (["sneakers", "apparel", "accessories", "all"] as string[]).includes(categoryValue) ? categoryValue as CatalogBrowseCategory : null;
  const brandValue = (request.nextUrl.searchParams.get("brand") || "all").trim().toLowerCase();
  const brands = new Set(["all", ...Object.keys(BRAND_ALIASES)]);
  if (!category || !brands.has(brandValue)) return NextResponse.json({ error: "Choose a supported product type and brand." }, { status: 400 });
  if (!getDb()) return NextResponse.json({ error: "Connect Neon before browsing the persistent product catalog." }, { status: 503 });

  const pcktKey = process.env.PCKT_API_KEY;
  const serpKey = process.env.SERPAPI_API_KEY;
  const userQuery = (request.nextUrl.searchParams.get("q") ?? "").trim().slice(0, 100);
  const brandSearchTerm = brandValue === "all" ? "" : (BRAND_QUERY_TERMS[brandValue] ?? brandValue);
  const queryContainsBrand = Boolean(brandSearchTerm && norm(userQuery).includes(norm(brandSearchTerm)));
  const queryParts = userQuery
    ? (brandSearchTerm && !queryContainsBrand ? [brandSearchTerm, userQuery] : [userQuery])
    : [brandSearchTerm].filter(Boolean);
  const searchTerm = category === "sneakers" || category === "all"
    ? (queryParts.join(" ") || "sneakers")
    : [...queryParts, typeLabel(category)].filter(Boolean).join(" ") || typeLabel(category);
  const cacheIdentity = `catalog:${category}:${brandValue}:${norm(userQuery)}`;
  const cacheKey = createHash("sha256").update(cacheIdentity).digest("hex");
  try {
    const cached = await readCache(cacheKey);
    const newlyConfiguredSource = cached?.sources.some((source) => source.status === "not_configured" && ((source.key !== "shopping" && Boolean(pcktKey)) || (source.key === "shopping" && Boolean(serpKey))));
    if (cached && !newlyConfiguredSource) {
      return NextResponse.json({ category, brand: brandValue, products: cached.products, sources: cached.sources, cached: true, cachedAt: cached.cachedAt, cacheHours: CACHE_HOURS, note: "Catalog names are discovery records, not proof of current stock." });
    }
  } catch {
    return NextResponse.json({ error: "Could not read the retailer catalog cache in Neon. Confirm that retailer_search_cache exists and that DATABASE_URL points to the intended Neon branch." }, { status: 503 });
  }

  // Search terms are provider discovery inputs. Gender, size, color, price and
  // sale refinements stay client-side, so changing them never spends another credit.
  const listings: InternalListing[] = [];
  const sources: Array<MarketplaceSourceStatus & { key?: string }> = [];

  for (const source of pcktSources) {
    if (category !== "all" && !source.categories.includes(category)) {
      sources.push({ key: source.key, name: source.name, status: "success", results: 0, message: "Not queried for this product type; this provider is configured here as a footwear catalog source." });
      continue;
    }
    if (!pcktKey) {
      sources.push({ key: source.key, name: source.name, status: "not_configured", results: 0, message: "Add PCKT_API_KEY in Vercel to enable marketplace catalog discovery." });
      continue;
    }
    if (!(await reserveBudget("pckt", source.credits, PCKT_MONTHLY_BUDGET))) {
      sources.push({ key: source.key, name: source.name, status: "budget_reached", results: 0, message: "Monthly PCKT safety budget reached. Existing Neon catalog results remain available." });
      continue;
    }
    try {
      await waitForPcktSlot();
      const url = new URL(`https://api.pckt.sh${source.path}`);
      Object.entries(source.params(searchTerm || "sneakers")).forEach(([key, value]) => url.searchParams.set(key, value));
      const payload = await fetchJson(url, { Authorization: `Bearer ${pcktKey}`, Accept: "application/json" });
      const found = records(payload).map((item) => normalizePckt(source.key, item, brandValue, category, userQuery)).filter((item): item is InternalListing => !!item);
      listings.push(...found);
      sources.push({ key: source.key, name: source.name, status: "success", results: found.length, message: found.length ? `${found.length} catalog record(s) discovered. Current size-level availability is not implied.` : "No matching catalog entries were returned for this brand/type combination." });
    } catch (error) {
      sources.push({ key: source.key, name: source.name, status: "error", results: 0, message: error instanceof Error ? error.message : "Catalog provider request failed." });
    }
  }

  if (!serpKey) {
    sources.push({ key: "shopping", name: "Google Shopping merchants", status: "not_configured", results: 0, message: "Add SERPAPI_API_KEY to discover online retailer listings, including Foot Locker when returned." });
  } else if (!(await reserveBudget("serpapi", 1, SERPAPI_MONTHLY_BUDGET))) {
    sources.push({ key: "shopping", name: "Google Shopping merchants", status: "budget_reached", results: 0, message: "Monthly SerpApi safety budget reached. Cached catalog entries remain available." });
  } else {
    try {
      const url = new URL("https://serpapi.com/search.json");
      const shoppingQuery = category === "sneakers" || category === "all" ? (searchTerm || "sneakers") : searchTerm;
      url.searchParams.set("engine", "google_shopping");
      url.searchParams.set("q", shoppingQuery);
      url.searchParams.set("gl", "us");
      url.searchParams.set("hl", "en");
      url.searchParams.set("api_key", serpKey);
      const payload = obj(await fetchJson(url)) ?? {};
      const shopping = Array.isArray(payload.shopping_results) ? payload.shopping_results : [];
      const found = shopping.map(obj).filter((item): item is Record<string, unknown> => !!item)
        .map((item) => normalizeShopping(item, brandValue, category, userQuery)).filter((item): item is InternalListing => !!item);
      listings.push(...found);
      sources.push({ key: "shopping", name: "Google Shopping merchants", status: "success", results: found.length, message: found.length ? `${found.length} merchant listing(s) discovered. Exact size and stock must be checked with the seller.` : "No matching merchant catalog entries were returned." });
    } catch (error) {
      sources.push({ key: "shopping", name: "Google Shopping merchants", status: "error", results: 0, message: error instanceof Error ? error.message : "Google Shopping catalog request failed." });
    }
  }

  const products = groupListings(listings);
  const cacheQuery = `catalog: ${category} / ${brandValue} / ${userQuery || "all models"}`;
  try { await writeCache(cacheKey, cacheQuery, products, sources); }
  catch { /* keep discovery results visible if a nonessential cache write fails */ }
  return NextResponse.json({ category, brand: brandValue, query: userQuery, products, sources, cached: false, cacheHours: CACHE_HOURS, note: "Catalog records include historical/discontinued product models where indexed by providers. A catalog record does not establish a current retailer offer or size availability." });
}
