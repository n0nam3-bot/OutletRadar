import { createHash } from "node:crypto";
import { getDb } from "@/lib/db";
const SEARCH_TTL_HOURS = 12;
// One-hour detail cache reduces repeat provider credits. The UI shows the check age and
// availability becomes unverified once this cache expires.
const PRODUCT_TTL_MINUTES = 60;
// One base cache per model query. Gender, size, category and sale are deliberately
// excluded so shoppers can change filters without another provider search call.
export function searchCacheKey(query) {
    const normalized = query.toLowerCase().replace(/\s+/g, " ").trim();
    return createHash("sha256").update(normalized).digest("hex");
}
export async function readSearchCache(key) {
    const sql = getDb();
    if (!sql)
        return null;
    try {
        const rows = await sql `
      SELECT products_json, meta_json, cached_at
      FROM nike_search_cache
      WHERE cache_key = ${key} AND expires_at > now()
      LIMIT 1
    `;
        const row = rows[0];
        if (!row)
            return null;
        const products = typeof row.products_json === "string" ? JSON.parse(row.products_json) : row.products_json;
        const meta = typeof row.meta_json === "string" ? JSON.parse(row.meta_json) : row.meta_json;
        if (!Array.isArray(products))
            return null;
        return { products: products, meta: (meta ?? {}), cachedAt: row.cached_at };
    }
    catch {
        // Search remains available when the optional cache migration has not yet been applied.
        return null;
    }
}
export async function writeSearchCache(key, query, products, meta) {
    const sql = getDb();
    if (!sql)
        return;
    try {
        await sql `
      INSERT INTO nike_search_cache (cache_key, query_text, sale_only, gender_filter, products_json, meta_json, cached_at, expires_at)
      VALUES (${key}, ${query}, false, 'all', ${JSON.stringify(products)}::jsonb,
              ${JSON.stringify(meta)}::jsonb, now(), now() + (${SEARCH_TTL_HOURS} * interval '1 hour'))
      ON CONFLICT (cache_key) DO UPDATE SET
        products_json = EXCLUDED.products_json,
        meta_json = EXCLUDED.meta_json,
        cached_at = now(),
        expires_at = now() + (${SEARCH_TTL_HOURS} * interval '1 hour')
    `;
        if (products.length) {
            const catalogRows = products.map((product) => ({
                product_url: product.url, product_id: product.id, title: product.title,
                subtitle: product.subtitle ?? null, style_code: product.styleCode ?? null,
                image_url: product.imageUrl ?? null, current_price: product.price ?? null,
                full_price: product.fullPrice ?? null, discount_percent: product.discountPercent ?? null,
                currency: product.currency, product_gender: product.gender ?? "Unknown",
                product_category: product.category ?? "Other", product_json: { ...product, catalogVersion: 2 },
            }));
            await sql `
        INSERT INTO nike_product_catalog
          (product_url, product_id, title, subtitle, style_code, image_url, current_price, full_price,
           discount_percent, currency, product_gender, product_category, product_json, updated_at)
        SELECT product_url, product_id, title, subtitle, style_code, image_url, current_price, full_price,
               discount_percent, currency, product_gender, product_category, product_json, now()
        FROM jsonb_to_recordset(${JSON.stringify(catalogRows)}::jsonb) AS p(
          product_url text, product_id text, title varchar(220), subtitle text, style_code varchar(100),
          image_url text, current_price numeric, full_price numeric, discount_percent integer,
          currency varchar(8), product_gender varchar(16), product_category varchar(24), product_json jsonb
        )
        ON CONFLICT (product_url) DO UPDATE SET
          product_id = EXCLUDED.product_id, title = EXCLUDED.title, subtitle = EXCLUDED.subtitle,
          style_code = EXCLUDED.style_code, image_url = EXCLUDED.image_url, current_price = EXCLUDED.current_price,
          full_price = EXCLUDED.full_price, discount_percent = EXCLUDED.discount_percent,
          currency = EXCLUDED.currency, product_gender = EXCLUDED.product_gender,
          product_category = EXCLUDED.product_category, product_json = EXCLUDED.product_json, updated_at = now()
      `;
        }
    }
    catch {
        // The live search result is still returned even if caching cannot be written.
    }
}
export async function readProductCache(productUrl) {
    const sql = getDb();
    if (!sql)
        return null;
    try {
        const rows = await sql `
      SELECT product_json, meta_json, cached_at
      FROM nike_product_detail_cache
      WHERE product_url = ${productUrl}
        AND expires_at > now()
        AND cached_at > now() - interval '60 minutes'
      LIMIT 1
    `;
        const row = rows[0];
        if (!row)
            return null;
        const product = typeof row.product_json === "string" ? JSON.parse(row.product_json) : row.product_json;
        const meta = typeof row.meta_json === "string" ? JSON.parse(row.meta_json) : row.meta_json;
        return product && typeof product === "object" ? { product: product, meta: (meta ?? {}), cachedAt: row.cached_at } : null;
    }
    catch {
        return null;
    }
}
export async function writeProductCache(productUrl, product, meta) {
    const sql = getDb();
    if (!sql)
        return;
    try {
        await sql `
      INSERT INTO nike_product_detail_cache (product_url, product_json, meta_json, cached_at, expires_at)
      VALUES (${productUrl}, ${JSON.stringify(product)}::jsonb, ${JSON.stringify(meta)}::jsonb,
              now(), now() + (${PRODUCT_TTL_MINUTES} * interval '1 minute'))
      ON CONFLICT (product_url) DO UPDATE SET
        product_json = EXCLUDED.product_json, meta_json = EXCLUDED.meta_json,
        cached_at = now(), expires_at = now() + (${PRODUCT_TTL_MINUTES} * interval '1 minute')
    `;
    }
    catch {
        // Product detail requests continue to work when caching is unavailable.
    }
}
/**
 * Reuses recently cached product records for a differently worded query when the
 * model phrase or style code is already in Neon. This is still a DB-only lookup.
 */
export async function readCatalogMatches(query) {
    const sql = getDb();
    if (!sql)
        return [];
    const safeQuery = query.replace(/[%_]/g, " ").trim();
    if (safeQuery.length < 3)
        return [];
    const pattern = `%${safeQuery}%`;
    try {
        const rows = await sql `
      SELECT product_json
      FROM nike_product_catalog
      WHERE updated_at > now() - interval '12 hours'
        AND product_json->>'catalogVersion' = '2'
        AND (title ILIKE ${pattern} OR COALESCE(subtitle, '') ILIKE ${pattern} OR COALESCE(style_code, '') ILIKE ${pattern})
      ORDER BY updated_at DESC
      LIMIT 1000
    `;
        return rows.flatMap((row) => {
            const value = typeof row.product_json === "string" ? JSON.parse(row.product_json) : row.product_json;
            return value && typeof value === "object" ? [value] : [];
        });
    }
    catch {
        return [];
    }
}
