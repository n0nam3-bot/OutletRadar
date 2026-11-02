import { NextRequest, NextResponse } from "next/server";
import { normalizeNikeProduct, nikeApiRequest, productArray, providerMeta } from "@/lib/nike";
import { allowSearch } from "@/lib/rate-limit";
import { readCatalogMatches, readSearchCache, searchCacheKey, writeSearchCache } from "@/lib/search-cache";

export const runtime = "nodejs";

const VALID_GENDERS = new Set(["all", "men", "women", "kids", "unisex"]);

function relevantToQuery(product: { title: string; subtitle?: string; styleCode?: string }, query: string) {
  const tokens = query.toLowerCase().match(/[a-z0-9]+/g)?.filter((token) => !["nike", "the", "and", "for", "with", "men", "mens", "women", "womens", "kids", "unisex", "size", "shoe", "shoes", "sneaker", "sneakers"].includes(token)) ?? [];
  if (!tokens.length) return true;
  const source = `${product.title} ${product.subtitle ?? ""} ${product.styleCode ?? ""}`.toLowerCase();
  const compactQuery = query.toLowerCase().replace(/[^a-z0-9]+/g, "");
  const compactSource = source.replace(/[^a-z0-9]+/g, "");
  if (compactQuery.length >= 6 && compactSource.includes(compactQuery)) return true;
  const text = source.replace(/[^a-z0-9]+/g, " ");
  const uniqueTokens = [...new Set(tokens)];
  const matched = uniqueTokens.filter((token) => (` ${text} `).includes(` ${token} `)).length;
  // Long model names are treated as an exact phrase search: every meaningful token
  // must occur, so Nike's broad fallback recommendations do not pollute the results.
  return matched === uniqueTokens.length;
}

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get("q")?.trim();
  const saleOnly = request.nextUrl.searchParams.get("sale") === "1";
  const requestedGender = (request.nextUrl.searchParams.get("gender") ?? "all").toLowerCase();
  const gender = VALID_GENDERS.has(requestedGender) ? requestedGender : "all";

  if (!query || query.length < 2) return NextResponse.json({ error: "Enter at least two characters to search." }, { status: 400 });
  if (query.length > 100) return NextResponse.json({ error: "Search text is too long." }, { status: 400 });

  const cacheKey = searchCacheKey(query, saleOnly, gender);
  const cached = await readSearchCache(cacheKey);
  if (cached) {
    return NextResponse.json({
      products: cached.products,
      meta: { ...cached.meta, cached: true, cacheSource: "neon", fetchedAt: cached.cachedAt },
      source: "api.sh",
    });
  }

  const catalogueMatches = (await readCatalogMatches(query, saleOnly, gender)).filter((item) => relevantToQuery(item, query));
  if (catalogueMatches.length) {
    return NextResponse.json({
      products: catalogueMatches,
      meta: { cached: true, cacheSource: "neon", fetchedAt: new Date().toISOString(), note: "Reused matching product records from the Neon catalogue." },
      source: "api.sh",
    });
  }

  if (!(await allowSearch(request))) {
    return NextResponse.json({ error: "Daily live-search limit reached for this connection. Previously cached searches remain available." }, { status: 429 });
  }

  try {
    const payload = await nikeApiRequest<unknown>("/nike/v1/search", {
      q: query,
      country: "US",
      sale: saleOnly ? "1" : undefined,
      // API.SH documents a gender filter for Nike search. Unisex is filtered locally
      // because Nike may classify unisex styles across more than one audience.
      gender: gender !== "all" && gender !== "unisex" ? gender[0].toUpperCase() + gender.slice(1) : undefined,
    });
    const root = payload as Record<string, unknown>;
    if (root && root.success === false) return NextResponse.json({ error: "The product provider could not complete this search." }, { status: 502 });

    const normalized = productArray(payload)
      .map(normalizeNikeProduct)
      .filter((item): item is NonNullable<typeof item> => Boolean(item));
    const products = normalized
      .filter((item) => relevantToQuery(item, query))
      .map((item) => {
        // For the provider's documented Men/Women/Kids filter, fill an omitted audience
        // label from the selected source filter rather than dropping valid results.
        if (["men", "women", "kids"].includes(gender) && item.gender === "Unknown") {
          return { ...item, gender: (gender[0].toUpperCase() + gender.slice(1)) as typeof item.gender };
        }
        return item;
      })
      .filter((item) => gender === "all" || item.gender?.toLowerCase() === gender)
      .slice(0, 48);

    const meta = providerMeta(payload);
    await writeSearchCache(cacheKey, query, saleOnly, gender, products, meta);
    return NextResponse.json({ products, meta: { ...meta, cached: false, cacheSource: "provider" }, source: "api.sh" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected product search error.";
    return NextResponse.json({ error: message }, { status: /not configured/i.test(message) ? 503 : 502 });
  }
}
