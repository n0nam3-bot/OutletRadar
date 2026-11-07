import { createHash } from "node:crypto";
import { getDb } from "@/lib/db";
import type { CatalogBrowseProduct, CatalogListing, MarketplaceOffer, MarketplaceSizeQuote } from "@/lib/types";

// Sources whose offers are saved to the normalized catalog (24 h expiry). "channel3" is
// deliberately absent: Channel3's terms ask that prices, availability and offer URLs are
// not kept for more than a few hours, so its offers live only in short-lived caches.
const SOURCE_KEYS = new Set(["stockx", "goat", "flightclub", "kickscrew", "shopping", "nike", "impact"]);
// Offers expire after 24 hours unless a source refreshes more slowly. Impact feed items are re-read in
// pages over several days, so they stay for 7 days.
const OFFER_TTL_HOURS: Record<string, number> = { impact: 168 };
const offerTtlHours = (source: string) => OFFER_TTL_HOURS[source] ?? 24;

function norm(value: string): string {
  return value.toLowerCase().normalize("NFKD").replace(/[’']/g, "").replace(/[^a-z0-9.]+/g, " ").replace(/\s+/g, " ").trim();
}
function colorKey(product: CatalogBrowseProduct): string {
  return norm(product.color || product.colors?.[0] || "");
}
function audienceClass(value?: string): string {
  const audience = (value || "unknown").toLowerCase();
  // Keep adult audience labels distinct. Collapsing Men, Women and Unisex into
  // one "adult" identity can attach the wrong retailer offers to a product.
  if (["men", "women", "kids", "unisex", "toddler", "infant"].includes(audience)) return audience;
  return "unknown";
}
function modelKey(product: CatalogBrowseProduct): string {
  const brand = norm(product.brand);
  let title = ` ${norm(product.title)} `;
  const brandAliases: Record<string, string[]> = {
    jordan: ["jordan", "air jordan"], nike: ["nike"], adidas: ["adidas"],
    "new balance": ["new balance", "newbalance"], asics: ["asics"], puma: ["puma"],
    converse: ["converse"], reebok: ["reebok"], vans: ["vans"], yeezy: ["yeezy", "adidas"],
    hoka: ["hoka", "hoka one one"], salomon: ["salomon"], crocs: ["crocs"],
  };
  for (const alias of brandAliases[brand] ?? [brand]) title = title.replace(` ${norm(alias)} `, " ");
  const ignored = new Set(["the", "and", "for", "with", "men", "mens", "women", "womens", "unisex", "kids", "kid", "youth", "gs", "ps", "grade", "school", "shoe", "shoes", "sneaker", "sneakers", "footwear", "retro", "edition"]);
  return title.trim().split(" ").filter((token) => token && !ignored.has(token) && !/^(?:19|20)\d{2}$/.test(token)).join(" ");
}
function canonicalIdentity(product: CatalogBrowseProduct): string {
  const brand = norm(product.brand);
  const category = product.category;
  const style = norm(product.styleCode || "");
  const year = product.releaseYear || "unknown-year";
  const color = colorKey(product);
  const model = modelKey(product);
  // Style/SKU is preferred, but still scoped by brand, category, year and known colorway.
  const identity = [brand, category, style ? `style:${style}` : `model:${model}`, year, color || "color-not-supplied", audienceClass(product.gender)].join("|");
  return createHash("sha256").update(identity).digest("hex");
}
function labelSizeSystem(label: string, provided?: string): string {
  const explicit = (provided || "").toLowerCase();
  const text = label.toLowerCase();
  if (/\b(?:infant|toddler)\b/.test(`${explicit} ${text}`)) return /infant/.test(`${explicit} ${text}`) ? "infant" : "toddler";
  if (/\b(?:gs|ps|grade school|preschool|youth|kids?)\b|\d+(?:\.\d+)?\s*y\b/.test(`${explicit} ${text}`)) return "youth";
  if (/\b(?:women|womens|female)\b|(?:^|\s)w\s*\d|\d\s*w(?:\s|$)/.test(`${explicit} ${text}`)) return "women";
  if (/\b(?:men|mens|male)\b|(?:^|\s)m\s*\d|\d\s*m(?:\s|$)/.test(`${explicit} ${text}`)) return "men";
  if (/\bunisex\b/.test(`${explicit} ${text}`)) return "unisex";
  return "unknown";
}
function normalizedSize(label: string): string {
  const value = norm(label).replace(/\b(?:us|men|mens|women|womens|size|gs|ps|grade|school|youth)\b/g, " ").replace(/\s+/g, " ").trim();
  return value;
}
function jsonObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

type CanonicalRow = {
  identity_key: string; brand_name: string; category: string; product_title: string;
  style_code?: string; release_year?: number; colorway?: string; audience: string;
  image_url?: string; metadata: Record<string, unknown>;
};
type OfferRow = {
  identity_key: string; source: string; retailer_name: string; provider_product_id?: string;
  listing_url: string; listing_title: string; image_url?: string; style_code?: string;
  colorway?: string; audience: string; release_year?: number; price?: number;
  original_price?: number; currency: string; condition_label: string; availability_state: string;
  availability_label: string; ttl_hours?: number; sizes: Array<{ label: string; system: string; state: string; price?: number; currency: string; status?: string }>;
  metadata: Record<string, unknown>;
};

function offerRowsForProduct(product: CatalogBrowseProduct, identityKey: string): OfferRow[] {
  return (product.listings ?? []).filter((listing) => SOURCE_KEYS.has(listing.source)).filter((listing) => Boolean(listing.url)).map((listing) => ({
    identity_key: identityKey,
    source: listing.source,
    retailer_name: listing.retailer || listing.source,
    provider_product_id: listing.providerProductId || undefined,
    listing_url: listing.url,
    listing_title: listing.title || product.title,
    image_url: listing.imageUrl || undefined,
    style_code: listing.styleCode || product.styleCode || undefined,
    colorway: listing.color || product.color || product.colors?.[0] || undefined,
    audience: listing.gender || product.gender || "Unknown",
    release_year: listing.releaseYear || product.releaseYear || undefined,
    price: listing.price,
    original_price: listing.originalPrice,
    currency: listing.currency || "USD",
    condition_label: "Unknown",
    availability_state: "unknown",
    availability_label: "Catalog listing only; selected-size availability is not confirmed.",
    ttl_hours: offerTtlHours(listing.source),
    sizes: (listing.sizes ?? []).map((label) => ({ label, system: labelSizeSystem(label, listing.gender), state: "unknown", currency: listing.currency || "USD", status: "Listed by catalog source; stock not confirmed." })),
    metadata: { onSale: listing.onSale ?? null, source: listing.source },
  }));
}

export async function persistCatalogSnapshot(products: CatalogBrowseProduct[], additionalOffers: MarketplaceOffer[] = []): Promise<void> {
  const sql = getDb();
  if (!sql || !products.length) return;

  const canonicalRowsAll: CanonicalRow[] = products.map((product) => ({
    identity_key: canonicalIdentity(product),
    brand_name: product.brand,
    category: product.category,
    product_title: product.title,
    style_code: product.styleCode || undefined,
    release_year: product.releaseYear,
    colorway: product.color || product.colors?.[0] || undefined,
    audience: product.gender || "Unknown",
    image_url: product.imageUrl || undefined,
    metadata: { sourceNames: product.sources ?? [], colorways: product.colors ?? [], modelKey: modelKey(product) },
  }));

  const canonicalRows = [...new Map(canonicalRowsAll.map((row) => [row.identity_key, row])).values()];
  const keyByProductId = new Map(products.map((product) => [product.id, canonicalIdentity(product)]));
  const offerRows = products.flatMap((product) => offerRowsForProduct(product, keyByProductId.get(product.id)!));
  const targetProduct = products[0];
  if (targetProduct && additionalOffers.length) {
    const identityKey = canonicalIdentity(targetProduct);
    for (const offer of additionalOffers) {
      if (!SOURCE_KEYS.has(offer.source) || !offer.url) continue;
      const quotes = offer.sizeQuotes ?? [];
      offerRows.push({
        identity_key: identityKey,
        source: offer.source,
        retailer_name: offer.retailer,
        provider_product_id: offer.providerProductId || undefined,
        listing_url: offer.url,
        listing_title: offer.title,
        image_url: offer.imageUrl || undefined,
        style_code: offer.styleCode || targetProduct.styleCode || undefined,
        colorway: offer.color || targetProduct.color || targetProduct.colors?.[0] || undefined,
        audience: String(offer.gender || targetProduct.gender || "Unknown"),
        release_year: offer.releaseYear || targetProduct.releaseYear || undefined,
        price: offer.price,
        currency: offer.currency || "USD",
        condition_label: offer.condition || "Unknown",
        availability_state: offer.availability || "unknown",
        availability_label: offer.availabilityLabel || "Availability not confirmed.",
        ttl_hours: offerTtlHours(offer.source),
        sizes: quotes.length
          ? quotes.map((quote) => ({ label: quote.label, system: quote.sizeSystem || "unknown", state: quote.available === true ? "available" : quote.available === false ? "unavailable" : "unknown", price: quote.price, currency: quote.currency || offer.currency || "USD", status: quote.status }))
          : (offer.sizes ?? []).map((label) => ({ label, system: labelSizeSystem(label, offer.gender), state: "unknown", currency: offer.currency || "USD", status: "Listed by source; availability not confirmed." })),
        metadata: { priceLabel: offer.priceLabel || null, sourceUpdatedAt: offer.sourceUpdatedAt || null },
      });
    }
  }

  const uniqueOfferRows = [...new Map(offerRows.map((row) => [`${row.source}:${row.listing_url}`, row])).values()];
  if (!canonicalRows.length) return;
  await sql`
    WITH incoming AS (
      SELECT * FROM jsonb_to_recordset(${JSON.stringify(canonicalRows)}::jsonb) AS x(
        identity_key text, brand_name text, category text, product_title text,
        style_code text, release_year integer, colorway text, audience text,
        image_url text, metadata jsonb
      )
    )
    INSERT INTO canonical_products (
      identity_key, brand_name, category, product_title, style_code,
      release_year, colorway, audience, image_url, metadata
    )
    SELECT identity_key, brand_name, category, product_title, style_code,
      release_year, colorway, audience, image_url, COALESCE(metadata, '{}'::jsonb)
    FROM incoming
    ON CONFLICT (identity_key) DO UPDATE SET
      product_title = CASE WHEN length(EXCLUDED.product_title) > length(canonical_products.product_title) THEN EXCLUDED.product_title ELSE canonical_products.product_title END,
      style_code = COALESCE(canonical_products.style_code, EXCLUDED.style_code),
      image_url = COALESCE(canonical_products.image_url, EXCLUDED.image_url),
      colorway = COALESCE(canonical_products.colorway, EXCLUDED.colorway),
      audience = CASE WHEN canonical_products.audience = 'Unknown' THEN EXCLUDED.audience ELSE canonical_products.audience END,
      metadata = canonical_products.metadata || EXCLUDED.metadata,
      last_seen_at = NOW(), updated_at = NOW()
  `;

  if (!uniqueOfferRows.length) return;
  await sql`
    WITH incoming AS (
      SELECT * FROM jsonb_to_recordset(${JSON.stringify(uniqueOfferRows)}::jsonb) AS x(
        identity_key text, source text, retailer_name text, provider_product_id text,
        listing_url text, listing_title text, image_url text, style_code text,
        colorway text, audience text, release_year integer, price numeric,
        original_price numeric, currency text, condition_label text,
        availability_state text, availability_label text, ttl_hours integer, sizes jsonb, metadata jsonb
      )
    ), offer_upsert AS (
      INSERT INTO retailer_offers (
        product_id, source, retailer_name, provider_product_id, listing_url,
        listing_title, image_url, style_code, colorway, audience, release_year,
        price, original_price, currency, condition_label, availability_state,
        availability_label, last_seen_at, expires_at, metadata
      )
      SELECT cp.id, i.source, i.retailer_name, i.provider_product_id, i.listing_url,
        i.listing_title, i.image_url, i.style_code, i.colorway, COALESCE(i.audience, 'Unknown'),
        i.release_year, i.price, i.original_price, COALESCE(i.currency, 'USD'),
        COALESCE(i.condition_label, 'Unknown'), COALESCE(i.availability_state, 'unknown'),
        i.availability_label, NOW(), NOW() + make_interval(hours => COALESCE(i.ttl_hours, 24)), COALESCE(i.metadata, '{}'::jsonb)
      FROM incoming i JOIN canonical_products cp ON cp.identity_key = i.identity_key
      ON CONFLICT (source, listing_url) DO UPDATE SET
        product_id = EXCLUDED.product_id,
        retailer_name = EXCLUDED.retailer_name,
        provider_product_id = COALESCE(EXCLUDED.provider_product_id, retailer_offers.provider_product_id),
        listing_title = EXCLUDED.listing_title,
        image_url = COALESCE(EXCLUDED.image_url, retailer_offers.image_url),
        style_code = COALESCE(EXCLUDED.style_code, retailer_offers.style_code),
        colorway = COALESCE(EXCLUDED.colorway, retailer_offers.colorway),
        audience = CASE WHEN EXCLUDED.audience = 'Unknown' THEN retailer_offers.audience ELSE EXCLUDED.audience END,
        release_year = COALESCE(EXCLUDED.release_year, retailer_offers.release_year),
        price = COALESCE(EXCLUDED.price, retailer_offers.price),
        original_price = COALESCE(EXCLUDED.original_price, retailer_offers.original_price),
        currency = EXCLUDED.currency,
        availability_state = CASE WHEN EXCLUDED.availability_state = 'unknown' AND retailer_offers.availability_state IN ('available','unavailable') AND retailer_offers.expires_at > NOW() THEN retailer_offers.availability_state ELSE EXCLUDED.availability_state END,
        availability_label = CASE WHEN EXCLUDED.availability_state = 'unknown' AND retailer_offers.availability_state IN ('available','unavailable') AND retailer_offers.expires_at > NOW() THEN retailer_offers.availability_label ELSE EXCLUDED.availability_label END,
        last_seen_at = NOW(), expires_at = EXCLUDED.expires_at, metadata = retailer_offers.metadata || EXCLUDED.metadata
      RETURNING id, source, listing_url
    ), size_input AS (
      SELECT o.id AS offer_id, size_row.value->>'label' AS size_label,
        COALESCE(NULLIF(size_row.value->>'system',''), 'unknown') AS size_system,
        COALESCE(NULLIF(size_row.value->>'state',''), 'unknown') AS availability_state,
        NULLIF(size_row.value->>'price','')::numeric AS price,
        COALESCE(NULLIF(size_row.value->>'currency',''), 'USD') AS currency,
        NULLIF(size_row.value->>'status','') AS source_status
      FROM incoming i
      JOIN offer_upsert o ON o.source = i.source AND o.listing_url = i.listing_url
      CROSS JOIN LATERAL jsonb_array_elements(COALESCE(i.sizes, '[]'::jsonb)) AS size_row(value)
      WHERE NULLIF(size_row.value->>'label','') IS NOT NULL
    )
    INSERT INTO retailer_offer_sizes (
      offer_id, size_label, normalized_size, size_system, availability_state,
      price, currency, source_status, last_checked_at, last_seen_at, expires_at
    )
    SELECT offer_id, size_label, regexp_replace(lower(size_label), '[^a-z0-9.]+', '', 'g'),
      size_system, availability_state, price, currency, source_status,
      CASE WHEN availability_state IN ('available','unavailable') THEN NOW() ELSE NULL END,
      NOW(), CASE WHEN availability_state IN ('available','unavailable') THEN NOW() + INTERVAL '6 hours' ELSE NULL END
    FROM size_input
    ON CONFLICT (offer_id, size_label, size_system) DO UPDATE SET
      normalized_size = EXCLUDED.normalized_size,
      availability_state = CASE WHEN EXCLUDED.availability_state = 'unknown' AND retailer_offer_sizes.availability_state IN ('available','unavailable') AND retailer_offer_sizes.expires_at > NOW() THEN retailer_offer_sizes.availability_state ELSE EXCLUDED.availability_state END,
      price = COALESCE(EXCLUDED.price, retailer_offer_sizes.price),
      currency = EXCLUDED.currency,
      source_status = COALESCE(EXCLUDED.source_status, retailer_offer_sizes.source_status),
      last_checked_at = COALESCE(EXCLUDED.last_checked_at, retailer_offer_sizes.last_checked_at),
      last_seen_at = NOW(),
      expires_at = COALESCE(EXCLUDED.expires_at, retailer_offer_sizes.expires_at)
  `;
}

export type SizePersistenceMetric = {
  source: string;
  quoteCount: number;
  matchedOffers: number;
  persistedVariants: number;
};

export async function persistOfferSizeQuotes(
  rows: Array<{
    source: string;
    providerProductId: string;
    listingUrl?: string;
    quotes: MarketplaceSizeQuote[];
    checkedAt?: string;
  }>,
): Promise<SizePersistenceMetric[]> {
  const sql = getDb();
  const grouped = new Map<string, typeof rows>();
  for (const row of rows) {
    if (!SOURCE_KEYS.has(row.source)) continue;
    const current = grouped.get(row.source) ?? [];
    current.push(row);
    grouped.set(row.source, current);
  }

  const metrics: SizePersistenceMetric[] = [];
  for (const [source, sourceRows] of grouped) {
    const deduped = new Map<string, Record<string, unknown>>();
    let quoteCount = 0;
    for (const row of sourceRows) {
      for (const quote of row.quotes) {
        quoteCount++;
        const label = quote.label.trim();
        if (!label) continue;
        const system = quote.sizeSystem || "unknown";
        const key = `${row.listingUrl || row.providerProductId}:${label.toLowerCase()}:${system}`;
        deduped.set(key, {
          source,
          provider_product_id: row.providerProductId || null,
          listing_url: row.listingUrl || null,
          checked_at: row.checkedAt || null,
          size_label: label,
          size_system: system,
          availability_state: quote.available === true ? "available" : quote.available === false ? "unavailable" : "unknown",
          price: quote.price ?? null,
          currency: quote.currency || "USD",
          source_status: quote.status || null,
        });
      }
    }

    if (!sql || deduped.size === 0) {
      metrics.push({ source, quoteCount, matchedOffers: 0, persistedVariants: 0 });
      continue;
    }

    const inputs = [...deduped.values()];
    const result = await sql`
      WITH incoming AS (
        SELECT * FROM jsonb_to_recordset(${JSON.stringify(inputs)}::jsonb) AS x(
          source text, provider_product_id text, listing_url text, checked_at text,
          size_label text, size_system text, availability_state text,
          price numeric, currency text, source_status text
        )
      ), target_offers AS (
        SELECT DISTINCT
          o.id AS offer_id, i.size_label, i.size_system, i.availability_state,
          i.price, i.currency, i.source_status, i.checked_at
        FROM incoming i
        JOIN retailer_offers o ON o.source = i.source AND (
          (i.listing_url IS NOT NULL AND o.listing_url = i.listing_url)
          OR (i.listing_url IS NULL AND i.provider_product_id IS NOT NULL AND o.provider_product_id = i.provider_product_id)
        )
      ), size_upsert AS (
        INSERT INTO retailer_offer_sizes (
          offer_id, size_label, normalized_size, size_system, availability_state,
          price, currency, source_status, last_checked_at, last_seen_at, expires_at
        )
        SELECT
          offer_id, size_label, regexp_replace(lower(size_label), '[^a-z0-9.]+', '', 'g'),
          CASE WHEN size_system IN ('men','women','youth','toddler','infant','unisex') THEN size_system ELSE 'unknown' END,
          CASE WHEN availability_state IN ('available','unavailable') THEN availability_state ELSE 'unknown' END,
          price, currency, source_status,
          COALESCE(NULLIF(checked_at, '')::timestamptz, NOW()), NOW(),
          COALESCE(NULLIF(checked_at, '')::timestamptz, NOW()) + INTERVAL '6 hours'
        FROM target_offers
        ON CONFLICT (offer_id, size_label, size_system) DO UPDATE SET
          normalized_size = EXCLUDED.normalized_size,
          availability_state = CASE
            WHEN EXCLUDED.availability_state = 'unknown'
              AND retailer_offer_sizes.availability_state IN ('available','unavailable')
              AND retailer_offer_sizes.expires_at > NOW()
            THEN retailer_offer_sizes.availability_state
            ELSE EXCLUDED.availability_state
          END,
          price = COALESCE(EXCLUDED.price, retailer_offer_sizes.price),
          currency = EXCLUDED.currency,
          source_status = COALESCE(EXCLUDED.source_status, retailer_offer_sizes.source_status),
          last_checked_at = COALESCE(EXCLUDED.last_checked_at, retailer_offer_sizes.last_checked_at),
          last_seen_at = NOW(),
          expires_at = COALESCE(EXCLUDED.expires_at, NOW() + INTERVAL '6 hours')
        RETURNING offer_id
      )
      SELECT
        (SELECT COUNT(DISTINCT offer_id)::int FROM target_offers) AS matched_offers,
        (SELECT COUNT(*)::int FROM size_upsert) AS persisted_variants
    ` as Array<{ matched_offers: number; persisted_variants: number }>;

    metrics.push({
      source,
      quoteCount,
      matchedOffers: Number(result[0]?.matched_offers || 0),
      persistedVariants: Number(result[0]?.persisted_variants || 0),
    });
  }
  return metrics;
}
