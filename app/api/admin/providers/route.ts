import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { PROVIDER_BUDGETS } from "@/lib/provider-budget";
import { getCatalogQueueStats } from "@/lib/catalog-queue";

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

    const usage = new Map(usageRows.map((row) => [row.provider, Number(row.units_reserved)]));
    const dailyUsage = new Map(dailyRows.map((row) => [row.provider, Number(row.units_reserved)]));
    const counts = catalogRows[0] || { canonical_products: 0, retailer_offers: 0, size_variants: 0 };
    return NextResponse.json({
      service: "outlet-radar",
      version: "2.3.0",
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
