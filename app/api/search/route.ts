import { NextRequest, NextResponse } from "next/server";
import { normalizeNikeProduct, nikeApiRequest, productArray, providerMeta } from "@/lib/nike";
import { readCatalogMatches, readSearchCache, searchCacheKey, writeSearchCache } from "@/lib/search-cache";
import { relevantToQuery } from "@/lib/search-match";

export const runtime = "nodejs";

// Search results are discovery data, not an inventory check. Keep size labels for
// filtering, but require a product-detail request before showing a size as available.
function asUnverifiedSearchProduct<T extends { sizes?: Array<{ label: string; localizedLabel?: string; status?: string | null; available?: boolean | null }> }>(product: T): T {
  if (!Array.isArray(product.sizes)) return product;
  return { ...product, sizes: product.sizes.map(({ label, localizedLabel }) => ({ label, localizedLabel, available: null, status: undefined })) } as T;
}

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get("q")?.trim();
  if (!query || query.length < 2) return NextResponse.json({ error: "Enter at least two characters to search." }, { status: 400 });
  if (query.length > 100) return NextResponse.json({ error: "Search text is too long." }, { status: 400 });

  const cacheKey = searchCacheKey(query);
  const cached = await readSearchCache(cacheKey);
  if (cached) {
    const products = cached.products.map((item) => normalizeNikeProduct(item) ?? item).filter((item) => relevantToQuery(item, query)).map(asUnverifiedSearchProduct);
    return NextResponse.json({
      products,
      meta: { ...cached.meta, cached: true, cacheSource: "neon", fetchedAt: cached.cachedAt },
      source: "api.sh",
    });
  }

  // Reuse the shared catalogue before making a provider request. The audience and
  // sale filters are intentionally not applied here; the client applies them locally.
  const catalogueMatches = (await readCatalogMatches(query))
    .map((item) => normalizeNikeProduct(item) ?? item)
    .filter((item) => relevantToQuery(item, query))
    .map(asUnverifiedSearchProduct);
  if (catalogueMatches.length) {
    return NextResponse.json({
      products: catalogueMatches.slice(0, 100),
      meta: { cached: true, cacheSource: "neon", fetchedAt: new Date().toISOString(), note: "Reused the unfiltered product catalogue from Neon." },
      source: "api.sh",
    });
  }


  try {
    // Fetch the broadest product set once. Sale, gender, category and size are all
    // client-side filters so toggling them never consumes another search credit.
    const payload = await nikeApiRequest<unknown>("/nike/v1/search", { q: query, country: "US" });
    const root = payload as Record<string, unknown>;
    if (root && root.success === false) return NextResponse.json({ error: "The product provider could not complete this search." }, { status: 502 });

    const products = productArray(payload)
      .map(normalizeNikeProduct)
      .filter((item): item is NonNullable<typeof item> => Boolean(item))
      .filter((item) => relevantToQuery(item, query))
      .map(asUnverifiedSearchProduct)
      .slice(0, 100);

    const meta = providerMeta(payload);
    await writeSearchCache(cacheKey, query, products, meta);
    return NextResponse.json({ products, meta: { ...meta, cached: false, cacheSource: "provider" }, source: "api.sh" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected product search error.";
    return NextResponse.json({ error: message }, { status: /not configured/i.test(message) ? 503 : 502 });
  }
}
