import { NextRequest, NextResponse } from "next/server";
import { createHash, timingSafeEqual } from "node:crypto";
import { runFeedIngest } from "@/lib/feed-ingest";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

function authorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  const header = request.headers.get("authorization") ?? "";
  if (!secret || !header) return false;
  return timingSafeEqual(createHash("sha256").update(header).digest(), createHash("sha256").update(`Bearer ${secret}`).digest());
}

/** Manual or externally scheduled feed ingestion (the daily warm-up job also runs a small batch).
 * `?pages=N` reads up to N pages (1-6). Requires FEED_INGEST_ENABLED=true. */
export async function GET(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  const pages = Number(request.nextUrl.searchParams.get("pages") ?? 3);
  const started = Date.now();
  const result = await runFeedIngest({ maxPages: Number.isFinite(pages) ? pages : 3, deadline: started + 55_000 });
  return NextResponse.json({ ok: true, elapsedMs: Date.now() - started, ...result });
}
