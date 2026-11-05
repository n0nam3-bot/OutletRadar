import { NextRequest, NextResponse } from "next/server";
import { createHash, timingSafeEqual } from "node:crypto";
import { getDb } from "@/lib/db";
import { catalogCacheKey, discoverCatalog } from "@/lib/catalog-discovery";
import { claimCatalogRefreshes, completeCatalogRefresh, pruneCatalogRefreshQueue } from "@/lib/catalog-queue";
import { canonicalQuery } from "@/lib/query-normalize";
import { WARM_SEEDS } from "@/lib/warm-seeds";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

// Stop starting new searches once this much of the 60-second function window is gone.
const TIME_BUDGET_MS = 40_000;
const DEFAULT_MAX_SEARCHES = 3;

function authorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  const header = request.headers.get("authorization") ?? "";
  if (!secret || !header) return false;
  const a = createHash("sha256").update(header).digest();
  const b = createHash("sha256").update(`Bearer ${secret}`).digest();
  return timingSafeEqual(a, b);
}

type Job = { cacheKey: string; category: string; brand: string; gender: string; releaseYear: number | null; query: string; fromQueue: boolean };

/** Seeds whose exact-query cache entry is missing or expired, oldest first. */
async function dueSeeds(limit: number): Promise<Job[]> {
  const sql = getDb();
  if (!sql) return [];
  const candidates = WARM_SEEDS.map((seed) => {
    const query = canonicalQuery(seed.query);
    return { seed, query, cacheKey: catalogCacheKey(seed.category, seed.brand, "all", undefined, query) };
  });
  const fresh = await sql`
    SELECT cache_key FROM retailer_search_cache
    WHERE cache_key IN (SELECT jsonb_array_elements_text(${JSON.stringify(candidates.map((candidate) => candidate.cacheKey))}::jsonb))
      AND expires_at > NOW()
  ` as Array<{ cache_key: string }>;
  const freshKeys = new Set(fresh.map((row) => row.cache_key));
  return candidates
    .filter((candidate) => !freshKeys.has(candidate.cacheKey))
    .slice(0, limit)
    .map((candidate) => ({
      cacheKey: candidate.cacheKey, category: candidate.seed.category, brand: candidate.seed.brand,
      gender: "all", releaseYear: null, query: candidate.query, fromQueue: false,
    }));
}

/**
 * Scheduled warm-up. Completes searches that visitors could only be served
 * partially (the refresh queue), then refreshes popular seed searches, using at
 * most WARM_DAILY_SHARE of the day's provider budget. Protected by CRON_SECRET.
 * Vercel Cron sends the secret automatically; any other scheduler must send
 * "Authorization: Bearer <CRON_SECRET>".
 */
export async function GET(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  if (!getDb()) return NextResponse.json({ error: "Warm-up requires DATABASE_URL." }, { status: 503 });
  if (!process.env.PCKT_API_KEY && !process.env.SERPAPI_API_KEY) {
    return NextResponse.json({ ok: true, skipped: "No provider keys are configured, so there is nothing to warm." });
  }

  const requested = Number(request.nextUrl.searchParams.get("max") ?? DEFAULT_MAX_SEARCHES);
  const maxSearches = Number.isFinite(requested) ? Math.max(1, Math.min(6, Math.floor(requested))) : DEFAULT_MAX_SEARCHES;
  const started = Date.now();

  await pruneCatalogRefreshQueue();
  const jobs: Job[] = (await claimCatalogRefreshes(maxSearches)).map((row) => ({
    cacheKey: row.cacheKey, category: row.category, brand: row.brand, gender: row.gender,
    releaseYear: row.releaseYear, query: row.query, fromQueue: true,
  }));
  if (jobs.length < maxSearches) jobs.push(...await dueSeeds(maxSearches - jobs.length));

  const results: Array<{ query: string; brand: string; source: "queue" | "seed"; outcome: string; products?: number }> = [];
  for (const job of jobs) {
    if (Date.now() - started > TIME_BUDGET_MS) { results.push({ query: job.query, brand: job.brand, source: job.fromQueue ? "queue" : "seed", outcome: "deferred_time_limit" }); continue; }
    const params = new URLSearchParams({ category: job.category, brand: job.brand, gender: job.gender, q: job.query });
    if (job.releaseYear) params.set("releaseYear", String(job.releaseYear));
    try {
      const { status, body } = await discoverCatalog(params, { mode: "warm" });
      const products = Array.isArray(body.products) ? body.products.length : 0;
      const complete = status === 200 && body.complete === true;
      if (complete && job.fromQueue) await completeCatalogRefresh(job.cacheKey);
      results.push({ query: job.query, brand: job.brand, source: job.fromQueue ? "queue" : "seed", outcome: complete ? "refreshed" : status === 200 ? "incomplete_budget_or_provider" : `http_${status}`, products });
    } catch (error) {
      results.push({ query: job.query, brand: job.brand, source: job.fromQueue ? "queue" : "seed", outcome: `error: ${error instanceof Error ? error.message.slice(0, 120) : "unknown"}` });
    }
  }

  return NextResponse.json({ ok: true, ran: results.length, elapsedMs: Date.now() - started, results });
}
