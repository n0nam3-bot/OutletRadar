import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { PROVIDER_BUDGETS } from "@/lib/provider-budget";
import { getCatalogQueueStats } from "@/lib/catalog-queue";
import { feedCatalogIds, feedEnabled } from "@/lib/feed-ingest";
import { demandTableAvailable, emptySearches, topSearches } from "@/lib/search-demand";
import { summarizeCoverage, type RetailerCoverageRow } from "@/lib/retailer-targets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "CRON_SECRET is not configured; provider diagnostics are disabled." }, { status: 503 });
  const authorization = request.headers.get("authorization") || "";
  const token = authorization.replace(/^Bearer\s+/i, "").trim();
  if (!token || !safeEqual(token, secret)) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  const sql = getDb();
  if (!sql) return NextResponse.json({ error: "DATABASE_URL is not configured." }, { status: 503 });

  try {
    const usageRows = await sql`
      SELECT provider, units_reserved, usage_month
      FROM retailer_api_usage
      WHERE usage_month = date_trunc('month', NOW())::date
      ORDER BY provider
    ` as Array<{ provider: string; units_reserved: string | number; usage_month: string | Date }>;
    const dailyRows = await sql`
      SELECT provider, units_reserved
      FROM retailer_api_usage_daily
      WHERE usage_day = CURRENT_DATE
      ORDER BY provider
    ` as Array<{ provider: string; units_reserved: string | number }>;
    const healthRows = await sql`
      SELECT provider, last_attempt_at, last_success_at, last_error_at,
        last_error_code, last_error_message, last_latency_ms, last_result_count,
        last_size_quote_count, last_size_matched_offers, last_size_persisted_variants,
        last_size_checked_at, consecutive_failures, disabled_until, updated_at
      FROM provider_health
      ORDER BY provider
    ` as Array<Record<string, unknown>>;
    const catalogRows = await sql`
      SELECT
        (SELECT COUNT(*)::int FROM canonical_products) AS canonical_products,
        (SELECT COUNT(*)::int FROM retailer_offers) AS retailer_offers,
        (SELECT COUNT(*)::int FROM retailer_offer_sizes) AS size_variants,
        (SELECT COUNT(*)::int FROM retailer_offer_sizes WHERE availability_state IN ('available','unavailable') AND (expires_at IS NULL OR expires_at > NOW())) AS verified_size_signals,
        (SELECT COUNT(*)::int FROM retailer_offer_sizes WHERE availability_state = 'available' AND (expires_at IS NULL OR expires_at > NOW())) AS available_size_signals,
        (SELECT COUNT(*)::int FROM retailer_offer_sizes WHERE availability_state = 'unknown') AS unknown_size_labels
    ` as Array<{
      canonical_products: number; retailer_offers: number; size_variants: number;
      verified_size_signals: number; available_size_signals: number; unknown_size_labels: number;
    }>;

    let coverageRows: RetailerCoverageRow[] = [];
    try {
      const rows = await sql`
        SELECT retailer_name, source, COUNT(*)::int AS offers,
               COUNT(DISTINCT product_id)::int AS products, MAX(last_seen_at) AS last_seen_at
        FROM retailer_offers
        GROUP BY retailer_name, source
        ORDER BY COUNT(*) DESC
        LIMIT 300
      ` as Array<{ retailer_name: string; source: string; offers: number; products: number; last_seen_at: string | Date | null }>;
      coverageRows = rows.map((row) => ({
        retailer: row.retailer_name, source: row.source, offers: Number(row.offers),
        products: Number(row.products), lastSeenAt: row.last_seen_at ? new Date(row.last_seen_at).toISOString() : null,
      }));
    } catch { /* coverage is informational */ }
    let clicks: { available: boolean; byStore: Array<{ retailer: string; source: string; clicks: number }>; byProduct: Array<{ title: string; clicks: number }>; total: number } = { available: false, byStore: [], byProduct: [], total: 0 };
    try {
      const byStore = await sql`
        SELECT retailer, source, SUM(clicks)::int AS clicks FROM offer_click_daily
        WHERE click_day >= CURRENT_DATE - 6 GROUP BY retailer, source ORDER BY SUM(clicks) DESC LIMIT 15
      ` as Array<{ retailer: string; source: string; clicks: number }>;
      const byProduct = await sql`
        SELECT product_title AS title, SUM(clicks)::int AS clicks FROM offer_click_daily
        WHERE click_day >= CURRENT_DATE - 6 GROUP BY product_title ORDER BY SUM(clicks) DESC LIMIT 15
      ` as Array<{ title: string; clicks: number }>;
      clicks = { available: true, byStore: byStore.map((row) => ({ ...row, clicks: Number(row.clicks) })), byProduct: byProduct.map((row) => ({ ...row, clicks: Number(row.clicks) })), total: byStore.reduce((sum, row) => sum + Number(row.clicks), 0) };
    } catch { /* table not created yet */ }
    let feedIngest: { enabled: boolean; configuredCatalogs: number; tableAvailable: boolean; rows: Array<{ catalogId: string; name: string; nextPage: number; numPages: number | null; itemsSeen: number; productsSaved: number; cycles: number; lastRunAt: string | null; lastError: string | null }>; impactOffers: number } = { enabled: feedEnabled(), configuredCatalogs: feedCatalogIds().length, tableAvailable: false, rows: [], impactOffers: 0 };
    try {
      const rows = await sql`SELECT catalog_id, advertiser_name, next_page, num_pages, items_seen, products_saved, cycles, last_run_at, last_error FROM feed_ingest_state ORDER BY catalog_id` as Array<Record<string, unknown>>;
      const offerCount = await sql`SELECT COUNT(*)::int AS n FROM retailer_offers WHERE source = 'impact' AND (expires_at IS NULL OR expires_at > NOW())` as Array<{ n: number }>;
      feedIngest = { ...feedIngest, tableAvailable: true, impactOffers: Number(offerCount[0]?.n ?? 0), rows: rows.map((row) => ({
        catalogId: String(row.catalog_id), name: String(row.advertiser_name ?? ""), nextPage: Number(row.next_page), numPages: row.num_pages === null ? null : Number(row.num_pages),
        itemsSeen: Number(row.items_seen), productsSaved: Number(row.products_saved), cycles: Number(row.cycles),
        lastRunAt: row.last_run_at ? new Date(String(row.last_run_at)).toISOString() : null, lastError: row.last_error ? String(row.last_error) : null,
      })) };
    } catch { /* migration 006 not applied */ }
    const demandState = await demandTableAvailable();
    const demand = { ...demandState, top: demandState.available ? await topSearches(12) : [], empty: demandState.available ? await emptySearches(12) : [] };
    const usage = new Map(usageRows.map((row) => [row.provider, Number(row.units_reserved)]));
    const dailyUsage = new Map(dailyRows.map((row) => [row.provider, Number(row.units_reserved)]));
    const counts = catalogRows[0] || { canonical_products: 0, retailer_offers: 0, size_variants: 0 };
    return NextResponse.json({
      service: "outlet-radar",
      version: "3.4.0",
      checkedAt: new Date().toISOString(),
      budgets: (Object.keys(PROVIDER_BUDGETS) as Array<keyof typeof PROVIDER_BUDGETS>).map((provider) => {
        const monthlyLimit = PROVIDER_BUDGETS[provider].monthly;
        const dailyLimit = PROVIDER_BUDGETS[provider].daily;
        const monthlyUsed = usage.get(provider) || 0;
        const dailyUsed = dailyUsage.get(provider) || 0;
        return {
          provider: provider === "pckt" ? "PCKT" : provider === "serpapi" ? "SerpApi" : "API.SH",
          used: monthlyUsed, limit: monthlyLimit, remaining: Math.max(0, monthlyLimit - monthlyUsed),
          dailyUsed, dailyLimit, dailyRemaining: Math.max(0, dailyLimit - dailyUsed),
        };
      }),
      providers: healthRows,
      refreshQueue: await getCatalogQueueStats(),
      retailerCoverage: summarizeCoverage(coverageRows),
      clicks,
      feedIngest,
      demand,
      catalog: {
        canonicalProducts: counts.canonical_products,
        retailerOffers: counts.retailer_offers,
        sizeVariants: counts.size_variants,
        verifiedSizeSignals: counts.verified_size_signals,
        availableSizeSignals: counts.available_size_signals,
        unknownSizeLabels: counts.unknown_size_labels,
      },
      notes: [
        "Budget values are application-side reservations, not the provider's authoritative billing ledger.",
        "Daily and monthly ceilings are safety guardrails shared by catalog, comparison and size-lookup requests.",
        "A size row marked available is a provider-reported offer signal, not a guarantee that checkout will succeed.",
        "Provider connectivity and size coverage are separate: a successful HTTP response may still return no usable size rows. The size sync timestamp, extracted quote count, matched offers and stored variants are shown separately.",
        "Total size variants include unverified labels; verified size signals are counted separately from labels whose availability is unknown.",
      ],
    }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Provider diagnostics are unavailable. Confirm that db/migrations/002_catalog_inventory.sql and 003_provider_budget_and_size_diagnostics.sql (and 004_catalog_refresh_queue.sql for the refresh queue) have been applied to the Neon branch used by DATABASE_URL." }, { status: 503 });
  }
}
