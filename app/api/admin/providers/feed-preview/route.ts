import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { impactConfigured } from "@/lib/impact";
import { previewFeeds } from "@/lib/feed-ingest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 45;

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}
let lastRunAt = 0;

/** Lists the Impact catalogs available to your account and reads one page of one catalog (2 Impact calls),
 * showing the item fields and what the footwear filter keeps. Writes nothing. Requires CRON_SECRET. */
export async function POST(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "CRON_SECRET is not configured." }, { status: 503 });
  const token = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!token || !safeEqual(token, secret)) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  if (!impactConfigured()) return NextResponse.json({ error: "Add IMPACT_ACCOUNT_SID and IMPACT_AUTH_TOKEN first." }, { status: 400 });
  if (Date.now() - lastRunAt < 15_000) return NextResponse.json({ error: "A preview just ran. Wait a few seconds." }, { status: 429 });
  lastRunAt = Date.now();
  const catalogId = request.nextUrl.searchParams.get("catalog") ?? undefined;
  return NextResponse.json(await previewFeeds(catalogId && /^[A-Za-z0-9_-]{1,40}$/.test(catalogId) ? catalogId : undefined));
}
