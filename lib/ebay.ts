import type { MarketplaceOffer } from "@/lib/types";

/**
 * eBay Browse API (https://developer.ebay.com/api-docs/buy/browse). Free for registered
 * developers; the default allowance is 5,000 calls per day per application. It adds new,
 * fixed-price eBay listings of the exact product to Compare offers.
 *
 * Like Channel3, eBay data is used live: cached for EBAY_CACHE_HOURS and never written to
 * the normalized catalog tables. Review eBay's API License Agreement before monetizing.
 *
 * Environment: EBAY_CLIENT_ID and EBAY_CLIENT_SECRET (production keyset, "App ID" and
 * "Cert ID"); optional EBAY_CAMPAIGN_ID (eBay Partner Network) to receive affiliate links.
 */
export const EBAY_CACHE_HOURS = 3;
const TOKEN_URL = "https://api.ebay.com/identity/v1/oauth2/token";
const SEARCH_URL = "https://api.ebay.com/buy/browse/v1/item_summary/search";

export function ebayConfigured(): boolean {
  return Boolean(process.env.EBAY_CLIENT_ID && process.env.EBAY_CLIENT_SECRET);
}

let cachedToken: { value: string; expiresAt: number } | null = null;

async function accessToken(forceRefresh = false): Promise<string> {
  if (!forceRefresh && cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.value;
  const id = process.env.EBAY_CLIENT_ID;
  const secret = process.env.EBAY_CLIENT_SECRET;
  if (!id || !secret) throw new Error("EBAY_CLIENT_ID and EBAY_CLIENT_SECRET are not configured.");
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`,
    },
    body: new URLSearchParams({ grant_type: "client_credentials", scope: "https://api.ebay.com/oauth/api_scope" }),
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok || typeof payload.access_token !== "string") {
    throw new Error(`eBay sign-in failed (HTTP ${response.status}). Check EBAY_CLIENT_ID and EBAY_CLIENT_SECRET are the production keyset.`);
  }
  const seconds = typeof payload.expires_in === "number" ? payload.expires_in : 7200;
  cachedToken = { value: payload.access_token, expiresAt: Date.now() + seconds * 1000 };
  return cachedToken.value;
}

function obj(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function text(value: unknown): string { return typeof value === "string" ? value.trim() : ""; }

/** One Browse API call: new condition, fixed price (no auctions). */
export async function searchEbay(query: string, limit = 30): Promise<Record<string, unknown>[]> {
  const url = new URL(SEARCH_URL);
  url.searchParams.set("q", query);
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("filter", "conditions:{NEW},buyingOptions:{FIXED_PRICE}");
  const run = async (token: string) => fetch(url, {
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/json",
      "x-ebay-c-marketplace-id": "EBAY_US",
      ...(process.env.EBAY_CAMPAIGN_ID ? { "x-ebay-c-enduserctx": `affiliateCampaignId=${process.env.EBAY_CAMPAIGN_ID},affiliateReferenceId=outletradar` } : {}),
    },
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  let response = await run(await accessToken());
  if (response.status === 401) response = await run(await accessToken(true));
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) {
    const first = Array.isArray(payload.errors) ? obj(payload.errors[0]) : null;
    throw new Error(`HTTP ${response.status}: ${text(first?.message) || "eBay request failed."}`);
  }
  const items = payload.itemSummaries;
  return Array.isArray(items) ? items.map(obj).filter((item): item is Record<string, unknown> => !!item) : [];
}

export function ebayOffers(items: Record<string, unknown>[]): MarketplaceOffer[] {
  const out: MarketplaceOffer[] = [];
  for (const item of items) {
    const title = text(item.title);
    const url = text(item.itemAffiliateWebUrl) || text(item.itemWebUrl);
    if (!title || !/^https?:\/\//i.test(url)) continue;
    const priceObject = obj(item.price);
    const price = Number(priceObject?.value);
    const seller = obj(item.seller);
    const sellerName = text(seller?.username);
    const feedback = text(seller?.feedbackPercentage);
    out.push({
      id: `ebay:${text(item.itemId) || url}`,
      providerProductId: text(item.itemId) || undefined,
      source: "ebay", retailer: "eBay", condition: text(item.condition) || "New", channel: "online",
      title, url, imageUrl: text(obj(item.image)?.imageUrl) || undefined,
      price: Number.isFinite(price) && price > 0 ? price : undefined,
      currency: (text(priceObject?.currency) || "USD").toUpperCase(),
      priceLabel: "Buy It Now price",
      availability: "unknown",
      availabilityLabel: `eBay listing${sellerName ? ` from ${sellerName}${feedback ? ` (${feedback}% positive)` : ""}` : ""} · independent seller: confirm size, condition and authenticity before buying`,
    });
  }
  return out;
}
