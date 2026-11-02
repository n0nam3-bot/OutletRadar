import { NextRequest, NextResponse } from "next/server";
import { normalizeNikeProduct, nikeApiRequest, providerMeta } from "@/lib/nike";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const productUrl = request.nextUrl.searchParams.get("url");
  if (!productUrl) return NextResponse.json({ error: "A Nike product URL is required." }, { status: 400 });

  let parsed: URL;
  try { parsed = new URL(productUrl); } catch { return NextResponse.json({ error: "Invalid product URL." }, { status: 400 }); }
  if (parsed.protocol !== "https:" || !(parsed.hostname === "nike.com" || parsed.hostname.endsWith(".nike.com"))) {
    return NextResponse.json({ error: "Only official Nike product links are supported." }, { status: 400 });
  }

  try {
    const payload = await nikeApiRequest<unknown>("/nike/v1/product", { url: parsed.toString() });
    const root = payload as Record<string, unknown>;
    const candidate = root?.product ?? root?.data ?? payload;
    const product = normalizeNikeProduct(candidate) ?? normalizeNikeProduct({ ...(candidate as object), title: (candidate as Record<string, unknown>)?.title ?? "Nike product", url: parsed.toString() });
    if (!product) return NextResponse.json({ error: "Product details were returned in an unsupported format." }, { status: 502 });
    return NextResponse.json({ product, meta: providerMeta(payload), sizeAvailabilityType: "online-shipping" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected product lookup error.";
    return NextResponse.json({ error: message }, { status: /not configured/i.test(message) ? 503 : 502 });
  }
}
