import { NextRequest, NextResponse } from "next/server";
import { normalizeNikeProduct, nikeApiRequest, providerMeta } from "@/lib/nike";
import { readProductCache, writeProductCache } from "@/lib/search-cache";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const productUrl = request.nextUrl.searchParams.get("url");
  if (!productUrl) return NextResponse.json({ error: "A Nike product URL is required." }, { status: 400 });

  let parsed: URL;
  try { parsed = new URL(productUrl); } catch { return NextResponse.json({ error: "Invalid product URL." }, { status: 400 }); }
  if (parsed.protocol !== "https:" || !(parsed.hostname === "nike.com" || parsed.hostname.endsWith(".nike.com"))) {
    return NextResponse.json({ error: "Only official Nike product links are supported." }, { status: 400 });
  }

  const cached = await readProductCache(parsed.toString());
  if (cached) {
    const normalized = normalizeNikeProduct(cached.product) ?? cached.product;
    return NextResponse.json({ product: normalized, meta: { ...cached.meta, cached: true, cacheSource: "neon" }, sizeAvailabilityType: "online-shipping" });
  }

  try {
    const payload = await nikeApiRequest<unknown>("/nike/v1/product", { url: parsed.toString() });
    const root = payload as Record<string, unknown>;
    const data = root?.data && typeof root.data === "object" ? root.data as Record<string, unknown> : null;
    const candidate = root?.product ?? data?.product ?? data?.item ?? root?.data ?? payload;
    const product = normalizeNikeProduct(candidate) ?? normalizeNikeProduct({ ...(candidate as object), title: (candidate as Record<string, unknown>)?.title ?? (candidate as Record<string, unknown>)?.name ?? "Nike product", url: parsed.toString() });
    if (!product) return NextResponse.json({ error: "Product details were returned in an unsupported format." }, { status: 502 });
    const meta = providerMeta(payload);
    await writeProductCache(parsed.toString(), product, meta);
    return NextResponse.json({ product, meta: { ...meta, cached: false, cacheSource: "provider" }, sizeAvailabilityType: "online-shipping" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected product lookup error.";
    return NextResponse.json({ error: message }, { status: /not configured/i.test(message) ? 503 : 502 });
  }
}
