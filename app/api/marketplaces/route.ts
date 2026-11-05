import { NextResponse } from "next/server";

export const runtime = "nodejs";

/**
 * Deprecated in v2.2. The customer-facing flow now discovers products through
 * /api/catalog and compares the exact selected product through
 * /api/catalog/offers. Keeping this old broad-search route live would bypass
 * the source-level catalog snapshots and waste provider credits.
 */
export async function GET() {
  return NextResponse.json({
    error: "This broad marketplace search endpoint has been retired. Use /api/catalog to discover products and /api/catalog/offers to compare the exact selected product.",
    replacement: { catalog: "/api/catalog", exactOffers: "/api/catalog/offers" },
  }, { status: 410, headers: { "Cache-Control": "no-store" } });
}
