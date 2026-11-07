import { NextRequest, NextResponse } from "next/server";
import { normalizeLoggedSearch, recordSearch } from "@/lib/search-demand";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The browser reports each search it runs (the search itself may be answered by the CDN without ever
 * reaching the server, so this is how demand is counted). Anonymous: only the filters and lowercase
 * search words are kept. Always answers 204.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as Record<string, unknown>;
    const search = normalizeLoggedSearch(body);
    const results = Number(body.results);
    if (search && Number.isFinite(results)) await recordSearch(search, Math.max(0, Math.floor(results)));
  } catch { /* analytics must never affect shoppers */ }
  return new NextResponse(null, { status: 204 });
}
