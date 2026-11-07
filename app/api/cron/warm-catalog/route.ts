import { NextRequest, NextResponse } from "next/server";
import { createHash, timingSafeEqual } from "node:crypto";
import { getDb } from "@/lib/db";
import { catalogCacheKey, discoverCatalog } from "@/lib/catalog-discovery";
import { claimCatalogRefreshes, completeCatalogRefresh, pruneCatalogRefreshQueue } from "@/lib/catalog-queue";
import { canonicalQuery } from "@/lib/query-normalize";
import { pruneSearchDemand, topSearches } from "@/lib/search-demand";
import { WARM_SEEDS } from "@/lib/warm-seeds";
import { feedEnabled, runFeedIngest } from "@/lib/feed-ingest";

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

type JobOrigin = "queue" | "demand" | "seed";
type Job = { cacheKey: string; category: string; brand: string; gender: string; releaseYear: number | null; query: string; fromQueue: boolean; origin: JobOrigin };

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
      gender: "all", releaseYear: null, query: candidate.query, fromQueue: false, origin: "seed" as const,
    }));
}

/** The most-searched filters of the last 7 days whose cached answer is missing or expired. Credits go to
 * what visitors actually look for before the static seed list. */
async function hotSearches(limit: number): Promise<Job[]> {
  const sql = getDb();
  if (!sql || limit <= 0) return [];
  const minimum = Number(process.env.WARM_MIN_SEARCHES ?? 2);
  const demand = await topSearches(60, Number.isFinite(minimum) ? Math.max(1, minimum) : 2);
  if (!demand.length) return [];
  const candidates = demand.map((row) => ({ row, cacheKey: catalogCacheKey(row.category, row.brand, row.gender, row.releaseYear || undefined, row.query) }));
  const fresh = await sql`
    SELECT cache_key FROM retailer_search_cache
    WHERE cache_key IN (SELECT jsonb_array_elements_text(${JSON.stringify(candidates.map((candidate) => candidate.cacheKey))}::jsonb))
      AND expires_at > NOW()
  ` as Array<{ cache_key: string }>;
  const freshKeys = new Set(fresh.map((row) => row.cache_key));
  return candidates.filter((candidate) => !freshKeys.has(candidate.cacheKey)).slice(0, limit).map((candidate) => ({
    cacheKey: candidate.cacheKey, category: candidate.row.category, brand: candidate.row.brand, gender: candidate.row.gender,
    releaseYear: candidate.row.releaseYear || null, query: candidate.row.query, fromQueue: false, origin: "demand" as const,
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
  if (!process.env.PCKT_API_KEY && !process.env.SERPAPI_API_KEY && !process.env.API_SH_KEY && !feedEnabled()) {
    return NextResponse.json({ ok: true, skipped: "No provider keys are configured, so there is nothing to warm." });
  }

  const requested = Number(request.nextUrl.searchParams.get("max") ?? DEFAULT_MAX_SEARCHES);
  const maxSearches = Number.isFinite(requested) ? Math.max(1, Math.min(6, Math.floor(requested))) : DEFAULT_MAX_SEARCHES;
  const started = Date.now();

  await pruneCatalogRefreshQueue();
  const jobs: Job[] = (await claimCatalogRefreshes(maxSearches)).map((row) => ({
    cacheKey: row.cacheKey, category: row.category, brand: row.brand, gender: row.gender,
    releaseYear: row.releaseYear, query: row.query, fromQueue: true, origin: "queue" as const,
  }));
  if (jobs.length < maxSearches) jobs.push(...await hotSearches(maxSearches - jobs.length));
  if (jobs.length < maxSearches) jobs.push(...await dueSeeds(maxSearches - jobs.length));
  await pruneSearchDemand();

  const results: Array<{ query: string; brand: string; source: JobOrigin; outcome: string; products?: number }> = [];
  for (const job of jobs) {
    if (Date.now() - started > TIME_BUDGET_MS) { results.push({ query: job.query, brand: job.brand, source: job.origin, outcome: "deferred_time_limit" }); continue; }
    const params = new URLSearchParams({ category: job.category, brand: job.brand, gender: job.gender, q: job.query });
    if (job.releaseYear) params.set("releaseYear", String(job.releaseYear));
    try {
      const { status, body } = await discoverCatalog(params, { mode: "warm" });
      const products = Array.isArray(body.products) ? body.products.length : 0;
      const complete = status === 200 && body.complete === true;
      if (complete && job.fromQueue) await completeCatalogRefresh(job.cacheKey);
      results.push({ query: job.query, brand: job.brand, source: job.origin, outcome: complete ? "refreshed" : status === 200 ? "incomplete_budget_or_provider" : `http_${status}`, products });
    } catch (error) {
      results.push({ query: job.query, brand: job.brand, source: job.origin, outcome: `error: ${error instanceof Error ? error.message.slice(0, 120) : "unknown"}` });
    }
  }

  // Optional bulk feed ingestion with whatever time is left in this run (off unless FEED_INGEST_ENABLED=true).
  const feed = feedEnabled() ? await runFeedIngest({ deadline: started + 55_000 }) : undefined;

  return NextResponse.json({ ok: true, ran: results.length, elapsedMs: Date.now() - started, results, ...(feed ? { feed } : {}) });
}
