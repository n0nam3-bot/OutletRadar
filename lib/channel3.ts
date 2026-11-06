import type { MarketplaceOffer } from "@/lib/types";

/**
 * Channel3 (https://trychannel3.com) is a product-data API that matches one product
 * to offers from many merchants and brands (adidas, New Balance, Puma, Reebok, Vans,
 * Foot Locker, JD Sports, Champs and others), so it covers brands that publish no
 * public product API of their own. Free tier: 1,000 credits per month, 1 per search.
 *
 * Terms note: Channel3 asks integrators not to keep prices, availability or offer URLs
 * for more than a few hours. Outlet Radar therefore uses it only for live Compare
 * lookups, caches them for CHANNEL3_CACHE_HOURS, and never writes its offers to the
 * normalized catalog tables.
 */
export const CHANNEL3_CACHE_HOURS = 3;
const API_URL = "https://api.trychannel3.com/v1/search";

export function channel3Configured(): boolean {
  return Boolean(process.env.CHANNEL3_API_KEY);
}

function obj(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function text(...values: unknown[]): string {
  for (const value of values) if (typeof value === "string" && value.trim()) return value.trim();
  return "";
}
function number(...values: unknown[]): number | undefined {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
    if (typeof value === "string") {
      const parsed = Number(value.replace(/[^0-9.]/g, ""));
      if (Number.isFinite(parsed) && parsed > 0) return parsed;
    }
  }
}

/** Runs one Channel3 search (1 credit). Throws on HTTP errors; the message is
 * surfaced as the source status, for example when the free credits are used up. */
export async function searchChannel3(query: string, limit = 20): Promise<Record<string, unknown>[]> {
  const key = process.env.CHANNEL3_API_KEY;
  if (!key) throw new Error("CHANNEL3_API_KEY is not configured.");
  const response = await fetch(API_URL, {
    method: "POST",
    headers: { "x-api-key": key, "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ query, limit }),
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const data = obj(payload);
    throw new Error(`HTTP ${response.status}: ${text(data?.detail, data?.message, data?.error) || "Channel3 request failed."}`);
  }
  const products = obj(payload)?.products;
  return Array.isArray(products) ? products.map(obj).filter((item): item is Record<string, unknown> => !!item) : [];
}

const KNOWN_DOMAINS: Record<string, string> = {
  "footlocker.com": "Foot Locker", "jdsports.com": "JD Sports", "champssports.com": "Champs Sports",
  "finishline.com": "Finish Line", "snipesusa.com": "Snipes USA", "jimmyjazz.com": "Jimmy Jazz",
  "macys.com": "Macy's", "bloomingdales.com": "Bloomingdale's", "ebay.com": "eBay", "nike.com": "Nike",
  "adidas.com": "adidas", "newbalance.com": "New Balance", "puma.com": "PUMA", "converse.com": "Converse",
  "reebok.com": "Reebok", "vans.com": "Vans", "stockx.com": "StockX", "goat.com": "GOAT",
  "flightclub.com": "Flight Club", "kickscrew.com": "Kicks Crew", "dickssportinggoods.com": "Dick's Sporting Goods",
  "zappos.com": "Zappos", "nordstrom.com": "Nordstrom", "hibbett.com": "Hibbett", "shoepalace.com": "Shoe Palace",
};

export function retailerNameForDomain(domain: string): string {
  const host = domain.toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0];
  if (KNOWN_DOMAINS[host]) return KNOWN_DOMAINS[host];
  const parent = Object.keys(KNOWN_DOMAINS).find((known) => host.endsWith(`.${known}`));
  return parent ? KNOWN_DOMAINS[parent] : host;
}

export type Channel3Candidate = { offer: MarketplaceOffer; productTitle: string };

/** Flattens Channel3 products into one candidate per merchant offer. Field access is
 * defensive because the response shape has more than one documented form. */
export function channel3Candidates(products: Record<string, unknown>[]): Channel3Candidate[] {
  const out: Channel3Candidate[] = [];
  for (const product of products) {
    const title = text(product.title, product.name);
    if (!title) continue;
    const brandField = product.brand ?? (Array.isArray(product.brands) ? product.brands[0] : undefined);
    const brand = typeof brandField === "string" ? brandField : text(obj(brandField)?.name);
    const images = Array.isArray(product.images) ? product.images.map(obj).filter((image): image is Record<string, unknown> => !!image) : [];
    const image = (images.find((candidate) => candidate.is_main_image === true) ?? images[0]);
    const imageUrl = text(image?.url) || undefined;
    const offers = Array.isArray(product.offers) ? product.offers.map(obj).filter((offer): offer is Record<string, unknown> => !!offer) : [];
    offers.forEach((raw, index) => {
      const url = text(raw.url, raw.link);
      if (!/^https?:\/\//i.test(url)) return;
      const domain = text(raw.domain, raw.merchant_domain);
      const priceObject = obj(raw.price);
      const price = number(priceObject?.price, raw.price, priceObject?.amount);
      const currency = (text(priceObject?.currency, raw.currency, raw.priceCurrency) || "USD").toUpperCase();
      const availability = text(raw.availability).toLowerCase();
      const soldOut = /outofstock|soldout|sold_out|out_of_stock/.test(availability.replace(/[\s-]/g, ""));
      const inStock = /instock|in_stock|limitedavailability/.test(availability.replace(/[\s-]/g, ""));
      const retailer = retailerNameForDomain(domain || new URL(url).hostname);
      out.push({
        productTitle: title,
        offer: {
          id: `channel3:${text(product.id) || title}:${domain || index}`,
          source: "channel3", retailer, condition: text(raw.condition) || "Unknown", channel: "online",
          title, url, imageUrl, brand: brand || undefined, price, currency,
          priceLabel: "Listed price",
          availability: soldOut ? "unavailable" : inStock ? "available" : "unknown",
          availabilityLabel: soldOut
            ? "Merchant reports this listing as out of stock · confirm on the seller page"
            : inStock ? "Merchant reports this listing as in stock · confirm size and checkout on the seller page"
            : "Merchant listing found · selected-size stock is not confirmed",
        },
      });
    });
  }
  return out;
}
