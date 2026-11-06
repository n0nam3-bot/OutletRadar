import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const databaseConfigured = Boolean(process.env.DATABASE_URL);
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
  };

  return NextResponse.json({
    service: "outlet-radar",
    version: "2.4.0",
    status: database === "unavailable" ? "degraded" : "ok",
    database,
    providers: {
      pckt: providers.pckt ? "configured" : "not_configured",
      serpapi: providers.serpapi ? "configured" : "not_configured",
      legacyNike: providers.legacyNike ? "configured" : "not_configured",
    },
    checkedAt: new Date().toISOString(),
  }, { status: database === "unavailable" ? 503 : 200 });
}
