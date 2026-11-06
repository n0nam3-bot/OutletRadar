import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { runProviderSelfTest } from "@/lib/provider-selftest";
import { RETAILER_TARGETS } from "@/lib/retailer-targets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

let lastRunAt = 0;

/** Sends one real request to each configured provider (about one credit each) and reports what
 * came back. Protected by CRON_SECRET and limited to one run per 20 seconds per server instance. */
export async function POST(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "CRON_SECRET is not configured; provider tests are disabled." }, { status: 503 });
  const token = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!token || !safeEqual(token, secret)) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  if (Date.now() - lastRunAt < 20_000) return NextResponse.json({ error: "A test just ran. Wait a few seconds and try again." }, { status: 429 });
  lastRunAt = Date.now();

  const only = request.nextUrl.searchParams.get("only") || undefined;
  const results = await runProviderSelfTest(only && /^[a-z0-9]+$/.test(only) ? only : undefined);
  // Which of the stores you care about came back, and through which provider, for this one search.
  const targets = RETAILER_TARGETS.map((target) => ({
    name: target.name,
    providers: results.filter((result) => result.retailers.some((retailer) => target.patterns.some((pattern) => pattern.test(retailer)))).map((result) => result.label),
  }));
  return NextResponse.json({ ranAt: new Date().toISOString(), query: "Air Jordan 4", results, targets });
}
