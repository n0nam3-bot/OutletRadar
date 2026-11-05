import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { persistCatalogSnapshot } from "@/lib/catalog-store";
import { getProviderCooldown, recordProviderFailure, recordProviderSuccess } from "@/lib/provider-health";
import { reserveProviderBudget } from "@/lib/provider-budget";
import type { CatalogBrowseCategory, CatalogBrowseProduct, CatalogListing, MarketplaceSourceStatus } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

// The catalog is a discovery index, not a live stock feed. PCKT itself may serve
// cached catalog snapshots up to 24 hours old; Neon caches a chosen brand/type
// combination for 12 hours to avoid repeating provider requests.
const CACHE_HOURS = 12;
const pcktSources = [
  { key: "stockx", name: "StockX", path: "/v1/catalog/stockx/search", credits: 0.4, categories: ["sneakers", "apparel", "accessories"] as CatalogBrowseCategory[], params: (q: string) => ({ query: q, page: "1", market: "US" }) },
  { key: "goat", name: "GOAT", path: "/v1/catalog/goat/search", credits: 0.3, categories: ["sneakers", "apparel", "accessories"] as CatalogBrowseCategory[], params: (q: string) => ({ query: q, page: "1" }) },
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
            const label = str(record.size, record.label, record.name, record.value, record.size_label, record.sizeName, record.size_name, record.display_value, record.displayValue, record.color, record.name);
            if (label) found.push(label);
          }
        }
      }
    }
  }
  return [...new Set(found)];
}

function extractSizeLabels(item: Record<string, unknown>): string[] {
  const found = new Set<string>();
  const sizeKeys = new Set(["sizes", "size", "available_sizes", "availablesizes", "size_options", "sizeoptions", "size_variants", "sizevariants", "variants", "size_chart", "sizechart", "size_options_by_region"]);
  const labelKeys = ["size", "label", "size_label", "sizelabel", "size_name", "sizename", "display_value", "displayvalue", "variant_value", "variantvalue", "base_size", "basesize", "us_size", "ussize", "value"];
  const walk = (value: unknown, parentKey = "", depth = 0) => {
    if (depth > 7 || value == null) return;
    if (typeof value === "string" || typeof value === "number") {
      if (sizeKeys.has(parentKey.toLowerCase()) && String(value).trim()) found.add(String(value).trim());
      return;
    }
    if (Array.isArray(value)) {
      value.slice(0, 200).forEach((entry) => walk(entry, parentKey, depth + 1));
      return;
    }
    const record = obj(value);
    if (!record) return;
    const baseSize = str(record.base_size, record.baseSize);
    const baseType = str(record.base_type, record.baseType);
    if (baseSize) {
      const audience = /women|us w/i.test(baseType) ? "W" : /youth|grade|kids|us y/i.test(baseType) ? "Y" : /men|us m/i.test(baseType) ? "M" : "";
      found.add(`${baseSize}${audience ? ` ${audience}` : ""}`.trim());
    }
    for (const key of labelKeys) {
      const candidate = record[key];
      if ((typeof candidate === "string" || typeof candidate === "number") && String(candidate).trim()) {
        const text = String(candidate).trim();
        if (/^(?:us\s*)?(?:men(?:'s)?\s*)?(?:women(?:'s)?\s*)?\d+(?:\.\d+)?(?:\s*[my])?$/i.test(text) || /^\d+(?:\.\d+)?\s*(?:us\s*)?(?:m|w|y)$/i.test(text)) found.add(text);
      }
    }
    for (const [key, child] of Object.entries(record)) {
      if (sizeKeys.has(key.toLowerCase()) || ["base_size", "basesize", "size_label", "size_name", "display_value", "variant_value", "us_size"].includes(key.toLowerCase())) walk(child, key.toLowerCase(), depth + 1);
      else if (obj(child) || Array.isArray(child)) walk(child, key.toLowerCase(), depth + 1);
    }
  };
  for (const key of ["sizes", "available_sizes", "availableSizes", "size_options", "sizeOptions", "size_variants", "sizeVariants", "variants", "variant_sizes", "variantSizes", "size_chart", "sizeChart"]) {
    if (item[key] !== undefined) walk(item[key], key.toLowerCase(), 0);
  }
  return [...found].filter((value) => value.length <= 24);
}

function imageUrlFromValue(value: unknown, depth = 0): string {
  if (depth > 5 || value == null) return "";
  if (typeof value === "string") return httpUrl(value);
  if (Array.isArray(value)) {
    for (const entry of value.slice(0, 12)) {
      const found = imageUrlFromValue(entry, depth + 1);
      if (found) return found;
    }
    return "";
  }
  const record = obj(value);
  if (!record) return "";
  for (const key of ["url", "src", "src_url", "image_url", "imageUrl", "imageURL", "original", "original_url", "originalSrc", "large", "large_url", "thumbnail", "thumbnail_url", "main", "main_url", "secure_url", "href", "image_src", "imageSrc", "featured_image_url", "product_image_url", "productImageUrl", "picture_url", "pictureUrl", "original_image", "originalImage", "media_url", "mediaUrl"]) {
    const candidate = record[key];
    if (typeof candidate === "string") {
      const found = httpUrl(candidate);
      if (found) return found;
    }
  }
  for (const key of ["images", "gallery", "image", "media", "photos", "image_360", "image360", "picture", "pictures", "primary_image", "primaryImage", "featured_image", "featuredImage", "product_image", "productImage", "image_urls", "imageUrls", "product_images", "productImages", "product_thumbnail", "productThumbnail"]) {
    if (record[key] !== undefined) {
      const found = imageUrlFromValue(record[key], depth + 1);
      if (found) return found;
    }
  }
  // Marketplace schemas add new image fields frequently. Inspect any other
  // image-like property rather than dropping valid nested CDN URLs.
  for (const [key, child] of Object.entries(record)) {
    if (/image|picture|thumbnail|photo|media/i.test(key)) {
      const found = imageUrlFromValue(child, depth + 1);
      if (found) return found;
    }
  }
  return "";
}

function imageUrlFromItem(item: Record<string, unknown>): string | undefined {
  for (const key of ["image_url", "imageUrl", "imageURL", "mainPictureUrl", "gridPictureUrl", "mainGlowPictureUrl", "gridGlowPictureUrl", "pictureUrl", "imageSrc", "main_image", "mainImage", "featured_image", "featuredImage", "product_image", "productImage", "small_image", "smallImage", "thumbnail", "thumbnailUrl", "thumbnail_url", "primary_image", "primaryImage", "image", "images", "image_urls", "imageUrls", "gallery", "image_360", "image360", "media", "photos", "picture", "pictures", "featured_image_url", "product_image_url", "productImageUrl", "picture_url", "original_image", "originalImage", "product_thumbnail", "productThumbnail"]) {
    if (item[key] === undefined) continue;
    const found = imageUrlFromValue(item[key]);
    if (found) return found;
  }
  return undefined;
}

function providerProductId(source: PcktKey, item: Record<string, unknown>): string | undefined {
  const value = source === "goat"
    ? str(item.goat_id, item.goatId, item.product_id, item.productId, item.id, item.slug)
    : source === "flightclub"
      ? str(item.slug, item.product_slug, item.productSlug, item.id, item.product_id)
      : str(item.id, item.product_id, item.productId, item.productID, item.slug);
  return value || undefined;
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
function extractReleaseYear(item: Record<string, unknown>, title: string): number | undefined {
  const explicit = [item.release_year, item.releaseYear, item.year, item.release_date, item.releaseDate, item.launch_date, item.launchDate]
    .map((value) => typeof value === "number" ? value : typeof value === "string" ? Number(value.match(/(?:19|20)\d{2}/)?.[0]) : NaN)
    .find((value) => Number.isInteger(value) && value >= 1980 && value <= 2035);
  if (explicit) return explicit;
  const fromTitle = title.match(/\b(19|20)\d{2}\b/);
  return fromTitle ? Number(fromTitle[0]) : undefined;
}
function catalogFields(item: Record<string, unknown>, title: string) {
  const price = num(item.extracted_price, item.price, item.lowest_price, item.current_price, item.sale_price, item.amount);
  const originalPrice = num(item.old_price, item.original_price, item.retail_price, item.full_price, item.compare_at_price, item.msrp);
  const explicitSale = bool(item.on_sale, item.onSale, item.is_sale, item.isSale, item.sale, item.clearance);
  const sizes = extractSizeLabels(item);
  const colors = textValues(item.color, item.colour, item.colorway, item.color_name, item.colorName, item.colors, item.color_options, item.colorOptions, item.secondary_title, item.secondaryTitle);
  return {
    price,
    originalPrice,
    currency: str(item.currency, item.currency_code, item.price_currency, "USD").toUpperCase(),
    gender: inferGender(item, title),
    releaseYear: extractReleaseYear(item, title),
    sizes: sizes.length ? sizes : undefined,
    color: colors[0],
    onSale: explicitSale ?? (price !== undefined && originalPrice !== undefined ? originalPrice > price : undefined),
  };
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
  if (selectedBrand !== "all") return BRAND_QUERY_TERMS[selectedBrand] ?? selectedBrand;
  const titleNorm = ` ${norm(title)} `;
  // Prefer sneaker-specific sub-brands from the title (Air Jordan/Yeezy) over
  // parent-company metadata (Nike/Adidas) so cross-marketplace records group.
  const priority = ["jordan", "yeezy", "new balance", "asics", "on running", "underarmour", "timberland", "salomon", "hoka", "crocs", "converse", "reebok", "vans", "puma", "adidas", "nike"];
  for (const key of priority) {
    const aliases = BRAND_ALIASES[key] ?? [key];
    if (aliases.some((alias) => titleNorm.includes(` ${norm(alias)} `))) return BRAND_QUERY_TERMS[key] ?? key;
  }
  if (itemBrand.trim()) return itemBrand.trim();
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
  // Model numbers must be present in the product title, never a provider ID/SKU.
  // A requested four-digit release year may instead be carried in structured data.
  const requested: string[] = query.match(/\d+(?:\.\d+)?/g) ?? [];
  if (!requested.length) return true;
  const returned: string[] = title.match(/\d+(?:\.\d+)?/g) ?? [];
  const knownYear = extractReleaseYear(item, title);
  return requested.every((number) => returned.includes(number) || (/^(?:19|20)\d{2}$/.test(number) && knownYear === Number(number)));
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
  const providedBrand = str(item.brand, item.brandName, item.manufacturer);
  const brand = brandFilter !== "all" && matchesBrand(providedBrand, title, brandFilter)
    ? (BRAND_QUERY_TERMS[brandFilter] ?? brandFilter)
    : inferBrand(providedBrand, title, "all");
  if (!matchesBrand(providedBrand || brand, title, brandFilter) || !matchesCategory(item, title, category, source) || !matchesModelNumbers(title, item, searchQuery)) return null;
  const url = sourceProductUrl(source, item);
  if (!url) return null;
  const name = pcktSources.find((entry) => entry.key === source)?.name ?? source;
  return {
    source, retailer: name, url,
    title: str(item.title, item.display_name, item.product_title, item.name, item.model_name, item.model),
    brand, category: category === "all" ? inferCatalogCategory(item, title) : category,
    imageUrl: imageUrlFromItem(item),
    styleCode: str(item.sku, item.style_code, item.styleCode, item.product_code, item.productCode) || undefined,
    providerProductId: providerProductId(source, item),
    ...catalogFields(item, title),
  };
}
function normalizeShopping(item: Record<string, unknown>, brandFilter: string, category: CatalogBrowseCategory, searchQuery: string): InternalListing | null {
  const title = str(item.title, item.product_title);
  const providedBrand = str(item.brand, item.manufacturer);
  const brand = brandFilter !== "all" && matchesBrand(providedBrand, title, brandFilter)
    ? (BRAND_QUERY_TERMS[brandFilter] ?? brandFilter)
    : inferBrand(providedBrand, title, "all");
  const retailer = str(item.source, item.seller, item.merchant, item.store);
  const url = httpUrl(str(item.product_link, item.link, item.url));
  if (!title || !retailer || !url || !matchesBrand(providedBrand || brand, title, brandFilter) || !matchesCategory(item, title, category, "shopping") || !matchesModelNumbers(title, item, searchQuery)) return null;
  return {
    source: "shopping", retailer, url, title, brand, category: category === "all" ? inferCatalogCategory(item, title) : category,
    imageUrl: imageUrlFromItem(item),
    styleCode: str(item.sku, item.style_code, item.styleCode, item.product_code) || undefined,
    ...catalogFields(item, title),
  };
}
function modelTitleTokens(brand: string, title: string): string[] {
  let value = ` ${norm(title)} `;
  const brandKey = norm(brand);
  const aliases = BRAND_ALIASES[brandKey] ?? [brandKey];
  for (const alias of aliases) value = value.replace(` ${norm(alias)} `, " ");
  // Jordan models are often prefixed with the parent company on one marketplace.
  if (brandKey === "jordan") value = value.replace(/\bnike\b/g, " ").replace(/\bair\b/g, " ");
  if (brandKey === "yeezy") value = value.replace(/\badidas\b/g, " ");
  // Remove audience and product-type words, but preserve silhouette, model
  // numbers, OG/SE/High/Low/Mid descriptors and colorway names.
  const generic = new Set([
    "the", "and", "for", "with", "mens", "men", "womens", "women", "male", "female",
    "unisex", "kids", "kid", "youth", "gs", "ps", "grade", "school", "toddler",
    "size", "us", "shoe", "shoes", "sneaker", "sneakers", "footwear", "new",
    "retro", "edition", "basketball", "running",
  ]);
  return value.trim().split(" ").filter((token) => token && !generic.has(token) && !/^(?:19|20)\d{2}$/.test(token))
    .map((token) => token === "banned" ? "bred" : token);
}
function normalizedColorKey(value?: string): string {
  const valueNorm = norm(value ?? "");
  if (!valueNorm) return "";
  const aliases: Record<string, string[]> = {
    black: ["black", "triple black", "blackout", "bred", "banned"],
    white: ["white", "off white", "offwhite", "sail", "ivory", "cream"],
    red: ["red", "fire red", "university red", "varsity red", "crimson", "scarlet", "cherry", "bred", "banned"],
    blue: ["blue", "royal blue", "navy", "university blue", "unc blue", "cobalt"],
    green: ["green", "pine green", "olive", "mint", "malachite"],
    grey: ["grey", "gray", "cement", "cool grey", "wolf grey"],
    brown: ["brown", "mocha", "chocolate", "cacao", "coffee"],
  };
  for (const [family, words] of Object.entries(aliases)) if (words.includes(valueNorm) || valueNorm === family) return family;
  return valueNorm.split(" ").filter(Boolean).sort().join(" ");
}
function productIdentity(listing: InternalListing): string {
  const tokens = modelTitleTokens(listing.brand, listing.title).sort();
  // This is the model-level key only. Unknown audience/year/color metadata must
  // not split the same model into multiple cards; conflicts are handled below.
  return [norm(listing.brand), listing.category, tokens.join(" ")].join(":");
}
function knownGenderConflict(existing: CatalogBrowseProduct, incoming: InternalListing): boolean {
  const known = new Set((existing.listings ?? []).map((listing) => listing.gender).filter((value): value is NonNullable<CatalogBrowseProduct["gender"]> => Boolean(value && value !== "Unknown")));
  const next = incoming.gender;
  if (!next || next === "Unknown") return false;
  if (known.has("Kids") && next !== "Kids") return true;
  if (next === "Kids" && [...known].some((value) => value !== "Kids")) return true;
  if (next === "Men" && known.has("Women")) return true;
  if (next === "Women" && known.has("Men")) return true;
  return false;
}
function compatibleProductGroup(existing: CatalogBrowseProduct, incoming: InternalListing): boolean {
  const years = new Set((existing.listings ?? []).map((listing) => listing.releaseYear).filter((value): value is number => typeof value === "number"));
  if (incoming.releaseYear && years.size && !years.has(incoming.releaseYear)) return false;

  const colors = new Set((existing.listings ?? []).map((listing) => normalizedColorKey(listing.color)).filter(Boolean));
  const nextColor = normalizedColorKey(incoming.color);
  if (nextColor && colors.size && !colors.has(nextColor)) return false;

  if (knownGenderConflict(existing, incoming)) return false;
  return true;
}
function mergeCatalogGender(current: CatalogBrowseProduct["gender"], incoming: InternalListing["gender"]): CatalogBrowseProduct["gender"] {
  if (!incoming || incoming === "Unknown") return current;
  if (!current || current === "Unknown" || current === "Unisex") return incoming;
  return current;
}
function groupListings(listings: InternalListing[]): CatalogBrowseProduct[] {
  const grouped: CatalogBrowseProduct[] = [];
  const groupKeys: string[] = [];
  const seenListings = new Set<string>();

  for (const listing of listings) {
    const baseKey = productIdentity(listing);
    const code = norm(listing.styleCode ?? "");
    // Exact model-token equality is preferred. A shared manufacturer style code
    // can bridge retailer title differences, but never overrides audience/year/color conflicts.
    let index = grouped.findIndex((candidate, candidateIndex) => {
      const sameBase = groupKeys[candidateIndex] === baseKey;
      const sameStyle = Boolean(code && candidate.styleCode && norm(candidate.styleCode) === code && norm(candidate.brand) === norm(listing.brand) && candidate.category === listing.category);
      return (sameBase || sameStyle) && compatibleProductGroup(candidate, listing);
    });

    const listingRecord: CatalogListing = {
      source: listing.source, retailer: listing.retailer, title: listing.title, url: listing.url,
      providerProductId: listing.providerProductId, imageUrl: listing.imageUrl,
      price: listing.price, originalPrice: listing.originalPrice, currency: listing.currency,
      color: listing.color, sizes: listing.sizes, gender: listing.gender,
      releaseYear: listing.releaseYear, onSale: listing.onSale,
    };
    const urlKey = `${listing.source}:${listing.url.toLowerCase()}`;
    if (seenListings.has(urlKey)) continue;
    seenListings.add(urlKey);

    if (index < 0) {
      const identity = `${baseKey}:${listing.releaseYear ?? "year-unknown"}:${normalizedColorKey(listing.color) || "color-unknown"}:${listing.gender ?? "gender-unknown"}`;
      const product: CatalogBrowseProduct = {
        id: createHash("sha1").update(identity).digest("hex").slice(0, 20),
        title: listing.title, brand: listing.brand, category: listing.category,
        styleCode: listing.styleCode, imageUrl: listing.imageUrl,
        sources: [listing.retailer], listings: [listingRecord],
        price: listing.price, originalPrice: listing.originalPrice, currency: listing.currency,
        color: listing.color, colors: listing.color ? [listing.color] : [],
        sizes: listing.sizes ?? [], gender: listing.gender ?? "Unknown",
        releaseYear: listing.releaseYear, onSale: listing.onSale,
      };
      grouped.push(product);
      groupKeys.push(baseKey);
      continue;
    }

    const current = grouped[index];
    if (!current.imageUrl && listing.imageUrl) current.imageUrl = listing.imageUrl;
    if (!current.styleCode && listing.styleCode) current.styleCode = listing.styleCode;
    // Prefer the more descriptive title when the model identity is the same.
    if (listing.title.length > current.title.length) current.title = listing.title;
    if (!current.sources.includes(listing.retailer)) current.sources.push(listing.retailer);
    current.listings.push(listingRecord);
    if (listing.price !== undefined && (current.price === undefined || listing.price < current.price)) {
      current.price = listing.price;
      current.originalPrice = listing.originalPrice;
      current.currency = listing.currency || current.currency || "USD";
    }
    if ((!current.color || current.color === "") && listing.color) current.color = listing.color;
    if (listing.color && !current.colors?.some((value) => normalizedColorKey(value) === normalizedColorKey(listing.color))) current.colors = [...(current.colors ?? []), listing.color];
    if (listing.sizes?.length) current.sizes = [...new Set([...(current.sizes ?? []), ...listing.sizes])];
    current.gender = mergeCatalogGender(current.gender, listing.gender);
    if (!current.releaseYear && listing.releaseYear) current.releaseYear = listing.releaseYear;
    if (listing.onSale !== undefined) current.onSale = current.onSale === true || listing.onSale;
  }
  return grouped.sort((a, b) => a.title.localeCompare(b.title)).slice(0, 72);
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
async function readProviderSnapshot(key: string): Promise<InternalListing[] | null> {
  const sql = getDb();
  if (!sql) return null;
  const rows = await sql`SELECT results_json FROM retailer_search_cache WHERE cache_key = ${key} AND expires_at > NOW() LIMIT 1` as Array<{ results_json: unknown }>;
  const raw = rows[0]?.results_json;
  if (!raw) return null;
  const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
  return Array.isArray(parsed) ? parsed as InternalListing[] : null;
}

async function writeProviderSnapshot(key: string, query: string, listings: InternalListing[], ttlHours: number): Promise<void> {
  const sql = getDb();
  if (!sql) return;
  await sql`
    INSERT INTO retailer_search_cache (cache_key, query_text, results_json, sources_json, cached_at, expires_at)
    VALUES (${key}, ${`provider-catalog: ${query}`}, ${JSON.stringify(listings)}::jsonb, '[]'::jsonb, NOW(), NOW() + (${ttlHours} * INTERVAL '1 hour'))
    ON CONFLICT (cache_key) DO UPDATE SET
      query_text = EXCLUDED.query_text, results_json = EXCLUDED.results_json,
      sources_json = '[]'::jsonb, cached_at = NOW(), expires_at = EXCLUDED.expires_at
  `;
}

function catalogAudienceFilter(items: InternalListing[], gender: string, year?: number): InternalListing[] {
  return items.filter((item) => (!year || !item.releaseYear || item.releaseYear === year))
    .filter((item) => gender === "all" || item.gender === "Unknown" || item.gender?.toLowerCase() === gender || ((gender === "men" || gender === "women") && item.gender === "Unisex"));
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

type StoredCatalogRow = {
  id: string; brand_name: string; category: string; product_title: string;
  style_code: string | null; release_year: number | null; colorway: string | null;
  audience: string; image_url: string | null; lowest_price: string | number | null;
  last_seen_at: string | Date; listings: unknown;
};

/**
 * Search the normalized Outlet Radar catalog before asking any external provider.
 * This is the shared product index: once a model has been discovered, alternate
 * text queries and future visitors can find it without another catalog API pull.
 */
async function searchStoredCatalog(input: {
  category: CatalogBrowseCategory; brand: string; gender: string;
  releaseYear?: number; query: string;
}): Promise<{ products: CatalogBrowseProduct[]; cachedAt: string } | null> {
  const sql = getDb();
  if (!sql) return null;
  const ignored = new Set(["air", "the", "and", "for", "with", "men", "mens", "women", "womens", "kids", "kid", "youth", "unisex", "shoe", "shoes", "sneaker", "sneakers", "footwear"]);
  const tokens = [...new Set(norm(input.query).split(" ").filter((token) => token && !ignored.has(token)))];
  const styleQuery = /[a-z]{2,}[^a-z0-9]*\d{2,}/i.test(input.query);
  const brandTerm = input.brand === "all" ? "" : norm(BRAND_QUERY_TERMS[input.brand] ?? input.brand);
  const rows = await sql`
    SELECT
      cp.id::text AS id, cp.brand_name, cp.category, cp.product_title,
      cp.style_code, cp.release_year, cp.colorway, cp.audience, cp.image_url,
      MIN(ro.price) AS lowest_price, cp.last_seen_at,
      COALESCE(
        jsonb_agg(
          jsonb_build_object(
            'source', ro.source,
            'retailer', ro.retailer_name,
            'title', ro.listing_title,
            'url', ro.listing_url,
            'providerProductId', ro.provider_product_id,
            'styleCode', ro.style_code,
            'imageUrl', ro.image_url,
            'price', ro.price,
            'originalPrice', ro.original_price,
            'currency', ro.currency,
            'color', ro.colorway,
            'sizes', COALESCE((SELECT jsonb_agg(DISTINCT size_row.size_label) FROM retailer_offer_sizes size_row WHERE size_row.offer_id = ro.id), '[]'::jsonb),
            'gender', ro.audience,
            'releaseYear', ro.release_year,
            'onSale', CASE WHEN ro.metadata ? 'onSale' THEN (ro.metadata->>'onSale')::boolean ELSE false END,
            'lastCheckedAt', ro.last_checked_at
          )
        ) FILTER (WHERE ro.id IS NOT NULL),
        '[]'::jsonb
      ) AS listings
    FROM canonical_products cp
    LEFT JOIN retailer_offers ro ON ro.product_id = cp.id AND (ro.expires_at IS NULL OR ro.expires_at > NOW())
    WHERE (${input.category} = 'all' OR cp.category = ${input.category})
      AND (${input.brand} = 'all' OR lower(cp.brand_name) = ${brandTerm})
      AND (${input.gender} = 'all' OR lower(cp.audience) = ${input.gender} OR lower(cp.audience) = 'unknown' OR (${input.gender} IN ('men','women') AND lower(cp.audience) = 'unisex'))
      AND (${input.releaseYear ?? null}::integer IS NULL OR cp.release_year = ${input.releaseYear ?? null} OR cp.release_year IS NULL)
      AND (
        jsonb_array_length(${JSON.stringify(tokens)}::jsonb) = 0
        OR (${styleQuery} AND lower(regexp_replace(COALESCE(cp.style_code,''), '[^a-z0-9]+', '', 'g')) LIKE '%' || regexp_replace(lower(${input.query}), '[^a-z0-9]+', '', 'g') || '%')
        OR (
          NOT EXISTS (
            SELECT 1
            FROM jsonb_array_elements_text(${JSON.stringify(tokens)}::jsonb) AS query_token(value)
            WHERE NOT (
              CASE
                WHEN query_token.value ~ '^\d+(\.\d+)?[a-z]?$' THEN
                  (' ' || regexp_replace(lower(cp.product_title), '[^a-z0-9.]+', ' ', 'g') || ' ') LIKE '% ' || query_token.value || ' %'
                  OR (' ' || regexp_replace(lower(COALESCE(cp.metadata->>'modelKey','')), '[^a-z0-9.]+', ' ', 'g') || ' ') LIKE '% ' || query_token.value || ' %'
                  OR (query_token.value ~ '^(19|20)\d{2}$' AND cp.release_year = query_token.value::integer)
                ELSE lower(cp.product_title) LIKE '%' || query_token.value || '%'
                  OR lower(COALESCE(cp.metadata->>'modelKey','')) LIKE '%' || query_token.value || '%'
                  OR (${styleQuery} AND lower(COALESCE(cp.style_code,'')) LIKE '%' || query_token.value || '%')
              END
            )
          )
        )
      )
    GROUP BY cp.id
    ORDER BY cp.last_seen_at DESC
    LIMIT 72
  ` as StoredCatalogRow[];

  if (!rows.length) return null;
  const products: CatalogBrowseProduct[] = rows.map((row) => {
    const rawListings = typeof row.listings === "string" ? JSON.parse(row.listings) : row.listings;
    const listings: CatalogListing[] = [];
    for (const value of (Array.isArray(rawListings) ? rawListings : [])) {
      const item = obj(value);
      if (!item) continue;
      const sourceValue = str(item.source);
      if (!["stockx", "goat", "flightclub", "kickscrew", "shopping"].includes(sourceValue)) continue;
      const url = str(item.url);
      if (!url) continue;
      const sizesRaw = Array.isArray(item.sizes) ? item.sizes : [];
      const yearCandidate = item.releaseYear ?? row.release_year;
      const year = yearCandidate == null ? undefined : Number(yearCandidate);
      listings.push({
        source: sourceValue as CatalogListing["source"],
        retailer: str(item.retailer, sourceValue),
        title: str(item.title, row.product_title),
        url,
        providerProductId: str(item.providerProductId) || undefined,
        styleCode: str(item.styleCode, row.style_code || "") || undefined,
        imageUrl: str(item.imageUrl) || undefined,
        price: num(item.price),
        originalPrice: num(item.originalPrice),
        currency: str(item.currency, "USD"),
        color: str(item.color, row.colorway || "") || undefined,
        sizes: sizesRaw.filter((size): size is string => typeof size === "string"),
        gender: str(item.gender, row.audience) as CatalogListing["gender"],
        releaseYear: year !== undefined && Number.isInteger(year) && year >= 1980 && year <= 2035 ? year : undefined,
        onSale: typeof item.onSale === "boolean" ? item.onSale : undefined,
      });
    }
    const sizeLabels = [...new Set(listings.flatMap((listing) => listing.sizes ?? []))];
    const sourceNames = [...new Set(listings.map((listing) => listing.retailer))];
    const knownGender = (["Men", "Women", "Kids", "Unisex"] as const).find((value) => value.toLowerCase() === String(row.audience || "").toLowerCase());
    const category = ["sneakers", "apparel", "accessories", "all"].includes(row.category) ? row.category as CatalogBrowseCategory : input.category;
    return {
      id: row.id,
      title: row.product_title,
      brand: row.brand_name,
      category,
      styleCode: row.style_code || undefined,
      imageUrl: row.image_url || listings.find((listing) => listing.imageUrl)?.imageUrl,
      sources: sourceNames,
      listings,
      price: row.lowest_price == null ? undefined : Number(row.lowest_price),
      currency: listings.find((listing) => listing.currency)?.currency || "USD",
      color: row.colorway || undefined,
      colors: row.colorway ? [row.colorway] : [],
      sizes: sizeLabels,
      gender: knownGender || "Unknown",
      releaseYear: row.release_year || undefined,
      onSale: listings.some((listing) => listing.onSale === true),
    };
  });
  return { products, cachedAt: new Date(rows[0].last_seen_at).toISOString() };
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

function productDetailRecord(payload: unknown): Record<string, unknown> | null {
  const root = obj(payload);
  if (!root) return null;
  const stack: Array<{ value: unknown; depth: number }> = [{ value: root, depth: 0 }];
  const seen = new Set<object>();
  while (stack.length) {
    const current = stack.shift()!;
    if (!current.value || typeof current.value !== "object" || current.depth > 7 || seen.has(current.value as object)) continue;
    seen.add(current.value as object);
    if (!Array.isArray(current.value)) {
      const record = current.value as Record<string, unknown>;
      if (str(record.title, record.name, record.model, record.product_name) && (imageUrlFromItem(record) || Array.isArray(record.variants) || Array.isArray(record.gallery))) return record;
      for (const child of Object.values(record)) if (child && typeof child === "object") stack.push({ value: child, depth: current.depth + 1 });
    } else {
      for (const child of current.value) if (child && typeof child === "object") stack.push({ value: child, depth: current.depth + 1 });
    }
  }
  return null;
}

async function cachedProviderDetail(source: "stockx" | "goat" | "flightclub", id: string): Promise<Record<string, unknown> | null> {
  const sql = getDb();
  if (!sql) return null;
  const key = createHash("sha256").update(`catalog-product-detail:v1:${source}:${id}`).digest("hex");
  const rows = await sql`SELECT results_json FROM retailer_search_cache WHERE cache_key = ${key} AND expires_at > now() LIMIT 1` as Array<{ results_json: unknown }>;
  const raw = rows[0]?.results_json;
  if (!raw) return null;
  const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
  return obj(parsed);
}

async function saveProviderDetail(source: "stockx" | "goat" | "flightclub", id: string, detail: Record<string, unknown>) {
  const sql = getDb();
  if (!sql) return;
  const key = createHash("sha256").update(`catalog-product-detail:v1:${source}:${id}`).digest("hex");
  await sql`
    INSERT INTO retailer_search_cache (cache_key, query_text, results_json, sources_json, cached_at, expires_at)
    VALUES (${key}, ${`product-detail:${source}:${id}`}, ${JSON.stringify(detail)}::jsonb, '[]'::jsonb, now(), now() + interval '30 days')
    ON CONFLICT (cache_key) DO UPDATE SET results_json = EXCLUDED.results_json, cached_at = now(), expires_at = now() + interval '30 days'
  `;
}

// Search endpoints frequently omit artwork. Hydrate a bounded number of image-less
// catalog cards from the provider detail endpoints, then retain those details in Neon.
// StockX/GOAT detail calls cost 0.4 credits; Flight Club detail costs 1 credit.
async function enrichMissingCatalogImages(products: CatalogBrowseProduct[]) {
  const missing = products.filter((product) => !product.imageUrl && (product.listings ?? []).some((listing) =>
    ["stockx", "goat", "flightclub"].includes(listing.source) && listing.providerProductId,
  )).slice(0, 1);

  for (const product of missing) {
    const candidates = (product.listings ?? [])
      .filter((listing) => (listing.source === "stockx" || listing.source === "goat") && listing.providerProductId);
    // One image lookup per product keeps latency and the free-credit budget bounded.
    const listing = candidates[0];
    if (!listing || (listing.source !== "stockx" && listing.source !== "goat") || !listing.providerProductId) continue;
    const source = listing.source;
    let providerStartedAt: number | null = null;
    try {
      let detail = await cachedProviderDetail(source, listing.providerProductId);
      if (!detail) {
        const cooldown = await getProviderCooldown(source);
        if (cooldown.paused) continue;
        const apiKey = process.env.PCKT_API_KEY;
        if (!apiKey) continue;
        if (!(await reserveProviderBudget("pckt", 0.4))) continue;
        providerStartedAt = Date.now();
        await waitForPcktSlot();
        const url = new URL(`https://api.pckt.sh/v1/catalog/${source}/product`);
        url.searchParams.set("id", listing.providerProductId);
        url.searchParams.set("market", "US");
        const payload = await fetchJson(url, { Authorization: `Bearer ${apiKey}`, Accept: "application/json" });
        await recordProviderSuccess(source, Date.now() - providerStartedAt);
        detail = productDetailRecord(payload);
        // Cache a sentinel too, so products without upstream artwork don't consume
        // another request every time the same 12-hour catalog is rediscovered.
        await saveProviderDetail(source, listing.providerProductId, detail ?? { _imageLookupAttempted: true });
      }
      if (!detail || detail._imageLookupAttempted === true) continue;
      const image = imageUrlFromItem(detail);
      if (image && !product.imageUrl) product.imageUrl = image;
      const colorInfo = catalogFields(detail, str(detail.title, product.title));
      if (colorInfo.color) {
        product.color = product.color || colorInfo.color;
        product.colors = [...new Set([...(product.colors ?? []), colorInfo.color])];
      }
      if ((product.gender === "Unknown" || !product.gender) && colorInfo.gender !== "Unknown") product.gender = colorInfo.gender;
      if (!product.sizes?.length && colorInfo.sizes?.length) product.sizes = colorInfo.sizes;
    } catch (error) {
      if (providerStartedAt !== null) await recordProviderFailure(source, Date.now() - providerStartedAt, error);
      // A missing image is cosmetic; never fail product discovery when detail enrichment fails.
    }
  }
  return products;
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
  if (userQuery.length < 2) return NextResponse.json({ error: "Describe the product you are looking for using at least two characters." }, { status: 400 });
  const genderValue = (request.nextUrl.searchParams.get("gender") ?? "all").trim().toLowerCase();
  const allowedGenders = new Set(["all", "men", "women", "kids", "unisex"]);
  if (!allowedGenders.has(genderValue)) return NextResponse.json({ error: "Choose a supported audience filter." }, { status: 400 });
  const releaseYearValue = (request.nextUrl.searchParams.get("releaseYear") ?? "").trim();
  const releaseYear = releaseYearValue && /^(19|20)\d{2}$/.test(releaseYearValue) ? Number(releaseYearValue) : undefined;
  if (releaseYearValue && !releaseYear) return NextResponse.json({ error: "Release year must be a four-digit year." }, { status: 400 });
  const brandSearchTerm = brandValue === "all" ? "" : (BRAND_QUERY_TERMS[brandValue] ?? brandValue);
  const queryContainsBrand = Boolean(brandSearchTerm && norm(userQuery).includes(norm(brandSearchTerm)));
  const queryParts = userQuery
    ? (brandSearchTerm && !queryContainsBrand ? [brandSearchTerm, userQuery] : [userQuery])
    : [brandSearchTerm].filter(Boolean);
  // Audience and release year are structured refinements, not search keywords.
  // Keep the provider query broad enough to discover the full model catalog, then
  // apply known attribute filters to returned records.
  const searchTerm = category === "sneakers" || category === "all"
    ? (queryParts.join(" ") || "sneakers")
    : [...queryParts, typeLabel(category)].filter(Boolean).join(" ") || typeLabel(category);
  const cacheIdentity = `catalog:v7:${category}:${brandValue}:${genderValue}:${releaseYear ?? "any"}:${norm(userQuery)}`;
  const cacheKey = createHash("sha256").update(cacheIdentity).digest("hex");
  try {
    const cached = await readCache(cacheKey);
    const newlyConfiguredSource = cached?.sources.some((source) => source.status === "not_configured" && ((source.key !== "shopping" && Boolean(pcktKey)) || (source.key === "shopping" && Boolean(serpKey))));
    if (cached && !newlyConfiguredSource) {
      try { await persistCatalogSnapshot(cached.products); } catch { /* normalized store is an additive index; cache results remain usable */ }
      return NextResponse.json({ category, brand: brandValue, gender: genderValue, releaseYear: releaseYear ?? null, products: cached.products, sources: cached.sources, cached: true, cachedAt: cached.cachedAt, cacheHours: CACHE_HOURS, note: "Catalog names are discovery records, not proof of current stock." });
    }
  } catch {
    return NextResponse.json({ error: "Could not read the retailer catalog cache in Neon. Confirm that retailer_search_cache exists and that DATABASE_URL points to the intended Neon branch." }, { status: 503 });
  }

  // After an exact-query cache miss, search Outlet Radar's normalized catalog.
  // A product already discovered by any visitor is reusable by every visitor;
  // only genuinely new catalog discovery proceeds to external providers.
  try {
    const stored = await searchStoredCatalog({ category, brand: brandValue, gender: genderValue, releaseYear, query: userQuery });
    if (stored?.products.length) {
      const storedSources = [{ key: "catalog", name: "Outlet Radar catalog", status: "success" as const, results: stored.products.length, message: "Loaded from Outlet Radar's shared catalog. Retailer offer details are refreshed when compared." }];
      // Read-through cache the database result for this exact filter combination.
      try { await writeCache(cacheKey, `catalog-db: ${category} / ${brandValue} / ${userQuery}`, stored.products, storedSources); } catch { /* database catalog results remain usable */ }
      return NextResponse.json({
        category, brand: brandValue, gender: genderValue, releaseYear: releaseYear ?? null,
        query: userQuery, products: stored.products,
        sources: storedSources,
        cached: true, cacheSource: "normalized_catalog", cachedAt: stored.cachedAt,
        note: "These are saved product records. They do not establish current retailer stock or selected-size checkout availability.",
      });
    }
  } catch {
    // A normalized-catalog read failure must not prevent fallback to provider discovery.
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
    const sourceCacheKey = createHash("sha256").update(`provider-catalog:v1:${source.key}:${category}:${brandValue}:${norm(searchTerm || "sneakers")}`).digest("hex");
    try {
      const cachedSnapshot = await readProviderSnapshot(sourceCacheKey);
      if (cachedSnapshot) {
        const found = catalogAudienceFilter(cachedSnapshot, genderValue, releaseYear);
        listings.push(...found);
        sources.push({ key: source.key, name: source.name, status: "cached", results: found.length, message: `Reused the shared ${source.name} catalog snapshot. Gender and release-year refinements were applied locally; no provider credits used.` });
        continue;
      }
    } catch { /* Treat unreadable provider cache as a miss; the shared budget still gates the request. */ }
    if (!pcktKey) {
      sources.push({ key: source.key, name: source.name, status: "not_configured", results: 0, message: "Add PCKT_API_KEY in Vercel to enable uncached marketplace catalog discovery." });
      continue;
    }
    const cooldown = await getProviderCooldown(source.key);
    if (cooldown.paused) {
      sources.push({ key: source.key, name: source.name, status: "cooldown", results: 0, message: `Temporarily paused after repeated provider errors until ${cooldown.disabledUntil}. Cached catalog records remain available.` });
      continue;
    }
    if (!(await reserveProviderBudget("pckt", source.credits))) {
      sources.push({ key: source.key, name: source.name, status: "budget_reached", results: 0, message: "Daily or monthly PCKT safety budget reached. Cached catalog records remain available." });
      continue;
    }
    const providerStartedAt = Date.now();
    try {
      await waitForPcktSlot();
      const url = new URL(`https://api.pckt.sh${source.path}`);
      Object.entries(source.params(searchTerm || "sneakers")).forEach(([key, value]) => url.searchParams.set(key, value));
      const payload = await fetchJson(url, { Authorization: `Bearer ${pcktKey}`, Accept: "application/json" });
      const snapshot = records(payload).map((item) => normalizePckt(source.key, item, brandValue, category, userQuery)).filter((item): item is InternalListing => !!item);
      await recordProviderSuccess(source.key, Date.now() - providerStartedAt, snapshot.length);
      try { await writeProviderSnapshot(sourceCacheKey, searchTerm, snapshot, 24); } catch { /* still use live response */ }
      const found = catalogAudienceFilter(snapshot, genderValue, releaseYear);
      listings.push(...found);
      sources.push({ key: source.key, name: source.name, status: "success", results: found.length, message: found.length ? `${found.length} catalog record(s) discovered. Current size-level availability is not implied.` : "The provider returned no catalog records matching the selected audience/year refinements." });
    } catch (error) {
      await recordProviderFailure(source.key, Date.now() - providerStartedAt, error);
      sources.push({ key: source.key, name: source.name, status: "error", results: 0, message: error instanceof Error ? error.message : "Catalog provider request failed." });
    }
  }

  const shoppingQuery = category === "sneakers" || category === "all" ? (searchTerm || "sneakers") : searchTerm;
  const shoppingCacheKey = createHash("sha256").update(`provider-catalog:v1:shopping:${category}:${brandValue}:${norm(shoppingQuery)}`).digest("hex");
  let shoppingSnapshot: InternalListing[] | null = null;
  try { shoppingSnapshot = await readProviderSnapshot(shoppingCacheKey); } catch { shoppingSnapshot = null; }
  if (shoppingSnapshot) {
    const found = catalogAudienceFilter(shoppingSnapshot, genderValue, releaseYear);
    listings.push(...found);
    sources.push({ key: "shopping", name: "Google Shopping merchants", status: "cached", results: found.length, message: "Reused shared Google Shopping merchant data; no SerpApi search credit used." });
  } else if (!serpKey) {
    sources.push({ key: "shopping", name: "Google Shopping merchants", status: "not_configured", results: 0, message: "Add SERPAPI_API_KEY to discover uncached online retailer listings, including Foot Locker when returned." });
  } else if ((await getProviderCooldown("shopping")).paused) {
    const cooldown = await getProviderCooldown("shopping");
    sources.push({ key: "shopping", name: "Google Shopping merchants", status: "cooldown", results: 0, message: `Temporarily paused after repeated provider errors${cooldown.disabledUntil ? ` until ${cooldown.disabledUntil}` : ""}.` });
  } else if (!(await reserveProviderBudget("serpapi", 1))) {
    sources.push({ key: "shopping", name: "Google Shopping merchants", status: "budget_reached", results: 0, message: "Daily or monthly SerpApi safety budget reached. Cached catalog entries remain available." });
  } else {
    const providerStartedAt = Date.now();
    try {
      const url = new URL("https://serpapi.com/search.json");
      url.searchParams.set("engine", "google_shopping");
      url.searchParams.set("q", shoppingQuery);
      url.searchParams.set("gl", "us");
      url.searchParams.set("hl", "en");
      url.searchParams.set("api_key", serpKey);
      const payload = obj(await fetchJson(url)) ?? {};
      const shopping = Array.isArray(payload.shopping_results) ? payload.shopping_results : [];
      const snapshot = shopping.map(obj).filter((item): item is Record<string, unknown> => !!item)
        .map((item) => normalizeShopping(item, brandValue, category, userQuery)).filter((item): item is InternalListing => !!item);
      await recordProviderSuccess("shopping", Date.now() - providerStartedAt, snapshot.length);
      try { await writeProviderSnapshot(shoppingCacheKey, shoppingQuery, snapshot, 6); } catch { /* keep live results */ }
      const found = catalogAudienceFilter(snapshot, genderValue, releaseYear);
      listings.push(...found);
      sources.push({ key: "shopping", name: "Google Shopping merchants", status: "success", results: found.length, message: found.length ? `${found.length} merchant listing(s) discovered. Exact size and stock must be checked with the seller.` : "No matching merchant catalog entries were returned." });
    } catch (error) {
      await recordProviderFailure("shopping", Date.now() - providerStartedAt, error);
      sources.push({ key: "shopping", name: "Google Shopping merchants", status: "error", results: 0, message: error instanceof Error ? error.message : "Google Shopping catalog request failed." });
    }
  }

  const products = await enrichMissingCatalogImages(groupListings(listings));
  try { await persistCatalogSnapshot(products); } catch { /* provider cache remains usable if the normalized inventory index is unavailable */ }
  const cacheQuery = `catalog: ${category} / ${brandValue} / ${userQuery || "all models"}`;
  try { await writeCache(cacheKey, cacheQuery, products, sources); }
  catch { /* keep discovery results visible if a nonessential cache write fails */ }
  return NextResponse.json({ category, brand: brandValue, gender: genderValue, releaseYear: releaseYear ?? null, query: userQuery, products, sources, cached: false, cacheHours: CACHE_HOURS, note: "Catalog records include historical/discontinued product models where indexed by providers. A catalog record does not establish a current retailer offer or size availability." });
}
