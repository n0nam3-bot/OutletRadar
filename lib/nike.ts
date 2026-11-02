import type { NikeProduct, ProductCategory, ProductGender, ProductSize } from "@/lib/types";

const API_BASE = "https://api.api.sh";

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return undefined;
}

function numeric(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const cleaned = value.replace(/[^0-9.]/g, "");
    if (!cleaned) return undefined;
    const parsed = Number(cleaned);
    if (Number.isFinite(parsed)) return parsed;
  }
  const obj = record(value);
  if (obj) return numeric(obj.amount ?? obj.value ?? obj.price);
  return undefined;
}


function textValue(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (Array.isArray(value)) return value.map(textValue).filter(Boolean).join(" ") || undefined;
  const obj = record(value);
  if (obj) return firstString(obj.name, obj.label, obj.value, obj.localized_label, obj.title);
  return undefined;
}

function normalizeGender(item: Record<string, unknown>): ProductGender {
  const raw = [item.gender, item.genders, item.gender_name, item.genderName, item.target_gender,
    item.targetGender, item.audience, item.product_gender, item.gender_label, item.genderLabel]
    .map(textValue).filter(Boolean).join(" ").toLowerCase();
  if (/unisex|all gender|all-gender/.test(raw) || (/women|woman|female/.test(raw) && /men|man|male/.test(raw))) return "Unisex";
  if (/kid|child|youth|toddler|infant|baby|grade school|preschool/.test(raw)) return "Kids";
  if (/women|woman|female|girl/.test(raw)) return "Women";
  if (/men|man|male|boy/.test(raw)) return "Men";
  return "Unknown";
}

function normalizeCategory(item: Record<string, unknown>, title: string, subtitle?: string): ProductCategory {
  const raw = [item.category, item.categories, item.product_type, item.productType, item.product_category,
    item.productCategory, item.classification, subtitle, title].map(textValue).filter(Boolean).join(" ").toLowerCase();
  if (/shoe|sneaker|running|basketball|football boot|cleat|sandals|slide/.test(raw)) return "Shoes";
  if (/shirt|hoodie|jacket|fleece|pants|shorts|leggings|bra|jersey|sweatshirt|tee|apparel|clothing/.test(raw)) return "Apparel";
  if (/bag|backpack|cap|hat|socks|glove|bottle|accessor|equipment/.test(raw)) return "Accessories";
  return "Other";
}

function imageFrom(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = imageFrom(item);
      if (found) return found;
    }
  }
  const obj = record(value);
  if (obj) return firstString(obj.url, obj.src, obj.href, obj.image_url, obj.imageUrl);
  return undefined;
}

export function productArray(payload: unknown): unknown[] {
  const root = record(payload);
  if (!root) return Array.isArray(payload) ? payload : [];
  const candidates = [
    root.products,
    root.items,
    root.results,
    root.data,
    record(root.data)?.products,
    record(root.data)?.items,
    record(root.data)?.results,
    record(root.raw)?.products,
  ];
  for (const candidate of candidates) if (Array.isArray(candidate)) return candidate;

  // Provider responses can evolve. Find a shallow array of product-like objects without
  // accepting arbitrary nested arrays such as review images or size rows.
  for (const value of Object.values(root)) {
    if (!Array.isArray(value) || value.length === 0) continue;
    const sample = record(value[0]);
    if (sample && (sample.title || sample.name || sample.product_name || sample.url || sample.product_url)) return value;
  }
  return [];
}

function safeNikeUrl(value: unknown): string | undefined {
  const raw = firstString(value);
  if (!raw) return undefined;
  try {
    const url = new URL(raw, "https://www.nike.com");
    if (url.protocol !== "https:" || !(url.hostname === "nike.com" || url.hostname.endsWith(".nike.com"))) return undefined;
    return url.toString();
  } catch {
    return undefined;
  }
}

function normalizeSizeList(value: unknown): ProductSize[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const sizes = value.flatMap((entry) => {
    const item = record(entry);
    if (!item) {
      const label = firstString(entry);
      return label ? [{ label }] : [];
    }
    const label = firstString(item.label, item.localized_label, item.size, item.name, item.value);
    if (!label) return [];
    const status = firstString(item.status, item.ship, item.availability);
    const available = typeof item.available === "boolean"
      ? item.available
      : status
        ? !/out|oos|unavailable|sold/i.test(status)
        : null;
    return [{ label, status, available }];
  });
  return sizes.length ? sizes : undefined;
}

export function normalizeNikeProduct(value: unknown): NikeProduct | null {
  const item = record(value);
  if (!item) return null;
  const title = firstString(item.title, item.name, item.product_name, item.productName, item.subtitle);
  const url = safeNikeUrl(item.url ?? item.product_url ?? item.productUrl ?? item.pdp_url ?? item.href ?? item.link ?? item.product_link ?? record(item.links)?.product);
  if (!title || !url) return null;

  const pricing = record(item.pricing) ?? record(item.price_data);
  const price = numeric(item.price ?? item.current_price ?? item.sale_price ?? item.currentPrice ?? item.salePrice ?? pricing?.current);
  const fullPrice = numeric(item.full_price ?? item.original_price ?? item.list_price ?? item.fullPrice ?? item.originalPrice ?? pricing?.full ?? pricing?.original);
  const directDiscount = numeric(item.discount_percent ?? item.discountPercentage ?? item.discount);
  const discountPercent = directDiscount !== undefined && directDiscount <= 100
    ? Math.round(directDiscount)
    : price !== undefined && fullPrice !== undefined && fullPrice > price
      ? Math.round(((fullPrice - price) / fullPrice) * 100)
      : undefined;
  const images = item.images ?? item.image_urls;
  const subtitle = firstString(item.subtitle, item.description, item.category, item.product_type);

  return {
    id: firstString(item.id, item.product_id, item.productId, item.style_code, item.sku) ?? url,
    title,
    subtitle,
    styleCode: firstString(item.style_code, item.styleColor, item.sku, item.product_code),
    url,
    imageUrl: imageFrom(item.image ?? item.image_url ?? item.imageUrl ?? item.hero_image ?? images),
    price,
    fullPrice,
    currency: firstString(item.currency, record(item.price)?.currency, record(pricing?.current)?.currency) ?? "USD",
    discountPercent,
    sizes: normalizeSizeList(item.sizes ?? item.size_availability ?? item.available_sizes),
    gender: normalizeGender(item),
    category: normalizeCategory(item, title, subtitle),
  };
}

export async function nikeApiRequest<T>(path: string, params: Record<string, string | undefined>): Promise<T> {
  const key = process.env.API_SH_KEY;
  if (!key) throw new Error("Nike product search is not configured. Add API_SH_KEY in Vercel environment variables.");

  const url = new URL(`${API_BASE}${path}`);
  for (const [name, value] of Object.entries(params)) if (value) url.searchParams.set(name, value);

  const response = await fetch(url, {
    headers: { "x-api-key": key, accept: "application/json" },
    // Search results are cached briefly by Next; provider cache metadata is still shown.
    cache: "no-store",
    signal: AbortSignal.timeout(25_000),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = firstString(record(payload)?.error, record(payload)?.message) ?? `Product data provider returned HTTP ${response.status}.`;
    throw new Error(message);
  }
  return payload as T;
}

export function providerMeta(payload: unknown) {
  const root = record(payload);
  return {
    cached: typeof root?.cached === "boolean" ? root.cached : undefined,
    fetchedAt: firstString(root?.fetched_at, root?.fetchedAt),
    creditsUsed: numeric(root?.credits_used),
  };
}
