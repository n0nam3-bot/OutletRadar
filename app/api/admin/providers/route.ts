import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

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
    const healthRows = await sql`
      SELECT provider, last_attempt_at, last_success_at, last_error_at,
        last_error_code, last_error_message, last_latency_ms,
        consecutive_failures, disabled_until, updated_at
      FROM provider_health
      ORDER BY provider
    ` as Array<Record<string, unknown>>;
    const catalogRows = await sql`
      SELECT
        (SELECT COUNT(*)::int FROM canonical_products) AS canonical_products,
        (SELECT COUNT(*)::int FROM retailer_offers) AS retailer_offers,
        (SELECT COUNT(*)::int FROM retailer_offer_sizes) AS size_variants
    ` as Array<{ canonical_products: number; retailer_offers: number; size_variants: number }>;

    const usage = new Map(usageRows.map((row) => [row.provider, Number(row.units_reserved)]));
    const counts = catalogRows[0] || { canonical_products: 0, retailer_offers: 0, size_variants: 0 };
    return NextResponse.json({
      service: "outlet-radar",
      version: "2.1.0",
      checkedAt: new Date().toISOString(),
      budgets: [
        { provider: "PCKT", used: usage.get("pckt") || 0, limit: 450, remaining: Math.max(0, 450 - (usage.get("pckt") || 0)) },
        { provider: "SerpApi", used: usage.get("serpapi") || 0, limit: 200, remaining: Math.max(0, 200 - (usage.get("serpapi") || 0)) },
      ],
      providers: healthRows,
      catalog: {
        canonicalProducts: counts.canonical_products,
        retailerOffers: counts.retailer_offers,
        sizeVariants: counts.size_variants,
      },
      notes: [
        "Budget values are application-side reservations, not the provider's authoritative billing ledger.",
        "A size row marked available is a provider-reported offer signal, not a guarantee that checkout will succeed.",
      ],
    }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Provider diagnostics are unavailable. Confirm that db/migrations/002_catalog_inventory.sql has been applied to the Neon branch used by DATABASE_URL." }, { status: 503 });
  }
}
