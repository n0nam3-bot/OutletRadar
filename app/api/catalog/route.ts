import { NextRequest, NextResponse } from "next/server";
import { discoverCatalog } from "@/lib/catalog-discovery";

export const runtime = "nodejs";
export const maxDuration = 60;

// All discovery logic lives in lib/catalog-discovery.ts so the scheduled warm-up
// job (app/api/cron/warm-catalog) runs exactly the same code path.
export async function GET(request: NextRequest) {
  const { status, body } = await discoverCatalog(request.nextUrl.searchParams, { mode: "user" });
  return NextResponse.json(body, { status });
}
