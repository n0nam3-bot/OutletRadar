import { NextRequest, NextResponse } from "next/server";
import { discoverCatalog } from "@/lib/catalog-discovery";

export const runtime = "nodejs";
export const maxDuration = 60;

function cdnSeconds(): number {
  const value = Number(process.env.CATALOG_CDN_SECONDS ?? 600);
  return Number.isFinite(value) ? Math.max(0, Math.min(3600, Math.floor(value))) : 600;
}

// All discovery logic lives in lib/catalog-discovery.ts so the scheduled warm-up job
// (app/api/cron/warm-catalog) runs exactly the same code path.
//
// Complete answers are cacheable by the CDN, so when many visitors search the same thing only the
// first reaches the server and database. Incomplete answers (a provider was out of budget, only saved
// data was shown) are cached for seconds only, so they are replaced as soon as fresh data exists.
// The full URL (including every filter) is the cache key. CATALOG_CDN_SECONDS=0 turns this off.
export async function GET(request: NextRequest) {
  const { status, body } = await discoverCatalog(request.nextUrl.searchParams, { mode: "user" });
  const ttl = cdnSeconds();
  const headers: Record<string, string> = {};
  if (status === 200 && ttl > 0) {
    headers["Cache-Control"] = body.incomplete === true
      ? "public, max-age=0, s-maxage=30, stale-while-revalidate=60"
      : `public, max-age=0, s-maxage=${ttl}, stale-while-revalidate=${ttl * 6}`;
  } else {
    headers["Cache-Control"] = "no-store";
  }
  return NextResponse.json(body, { status, headers });
}
