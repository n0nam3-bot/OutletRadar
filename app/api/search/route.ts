import { NextRequest, NextResponse } from "next/server";
import { normalizeNikeProduct, nikeApiRequest, productArray, providerMeta } from "@/lib/nike";
import { allowSearch } from "@/lib/rate-limit";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get("q")?.trim();
  const saleOnly = request.nextUrl.searchParams.get("sale") === "1";
  if (!query || query.length < 2) {
    return NextResponse.json({ error: "Enter at least two characters to search." }, { status: 400 });
  }
  if (query.length > 100) {
    return NextResponse.json({ error: "Search text is too long." }, { status: 400 });
  }
  if (!(await allowSearch(request))) {
    return NextResponse.json({ error: "Daily search limit reached for this connection. Try again tomorrow." }, { status: 429 });
  }

  try {
    const payload = await nikeApiRequest<unknown>("/nike/v1/search", {
      q: query,
      country: "US",
      sale: saleOnly ? "1" : undefined,
    });
    const root = payload as Record<string, unknown>;
    if (root && root.success === false) {
      return NextResponse.json({ error: "The product provider could not complete this search." }, { status: 502 });
    }

    const rawItems = productArray(payload);
    const products = rawItems
      .map(normalizeNikeProduct)
      .filter((item): item is NonNullable<typeof item> => Boolean(item))
      .slice(0, 48);

    return NextResponse.json({ products, meta: providerMeta(payload), source: "api.sh" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected product search error.";
    const status = /not configured/i.test(message) ? 503 : 502;
    return NextResponse.json({ error: message }, { status });
  }
}
