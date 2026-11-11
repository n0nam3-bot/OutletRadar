import { NextRequest, NextResponse } from "next/server";
import { tipUrl } from "@/lib/site-info";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const databaseConfigured = Boolean(process.env.DATABASE_URL);
  // ?light=1 reports configuration only and never touches the database. The web page uses
  // it on every load so a visit does not wake Neon (free compute hours are limited).
  if (request.nextUrl.searchParams.get("light") === "1") {
    return NextResponse.json({
      service: "outlet-radar", databaseConfigured,
      productSearchConfigured: Boolean(process.env.PCKT_API_KEY || process.env.SERPAPI_API_KEY || process.env.API_SH_KEY),
      tipUrl: tipUrl(),
    });
  }
  let database: "connected" | "not_configured" | "unavailable" = databaseConfigured ? "unavailable" : "not_configured";

  if (databaseConfigured) {
    try {
      const sql = getDb();
      if (!sql) throw new Error("Database connection is not configured.");
      await sql`SELECT 1 AS ok`;
      database = "connected";
    } catch {
      database = "unavailable";
    }
  }

  const providers = {
    pckt: Boolean(process.env.PCKT_API_KEY),
    serpapi: Boolean(process.env.SERPAPI_API_KEY),
    legacyNike: Boolean(process.env.API_SH_KEY),
    channel3: Boolean(process.env.CHANNEL3_API_KEY),
    ebay: Boolean(process.env.EBAY_CLIENT_ID && process.env.EBAY_CLIENT_SECRET),
    impact: Boolean(process.env.IMPACT_ACCOUNT_SID && process.env.IMPACT_AUTH_TOKEN),
  };

  return NextResponse.json({
    service: "outlet-radar",
    version: "3.9.0",
    status: database === "unavailable" ? "degraded" : "ok",
    database,
    databaseConfigured,
    productSearchConfigured: Boolean(providers.pckt || providers.serpapi || providers.legacyNike),
    providers: {
      pckt: providers.pckt ? "configured" : "not_configured",
      serpapi: providers.serpapi ? "configured" : "not_configured",
      legacyNike: providers.legacyNike ? "configured" : "not_configured",
      channel3: providers.channel3 ? "configured" : "not_configured",
      ebay: providers.ebay ? "configured" : "not_configured",
      impact: providers.impact ? "configured" : "not_configured",
    },
    checkedAt: new Date().toISOString(),
  }, { status: database === "unavailable" ? 503 : 200 });
}
