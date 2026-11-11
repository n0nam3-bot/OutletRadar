import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SOURCES = new Set(["stockx", "goat", "flightclub", "kickscrew", "shopping", "nike", "channel3", "ebay", "impact", "tip"]);
// Anonymous endpoint: cap how many distinct rows can be created per day so it cannot be used to fill the database.
const MAX_ROWS_PER_DAY = 5000;

const clean = (value: unknown, max: number) => (typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "");

/**
 * Records that a visitor opened an outbound offer link. The link itself is a normal direct
 * link (nothing is redirected through this site); the browser reports the click in the
 * background. Only a daily counter per store and product is kept: no IP address, cookie,
 * user agent or full URL. Always answers 204 so it can never block or reveal anything.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as Record<string, unknown>;
    const source = clean(body.source, 24).toLowerCase();
    const retailer = clean(body.retailer, 80);
    const title = clean(body.title, 160);
    const brand = clean(body.brand, 40);
    let host = "";
    try {
      const url = new URL(clean(body.url, 2000));
      if (url.protocol === "http:" || url.protocol === "https:") host = url.hostname.replace(/^www\./, "").slice(0, 120);
    } catch { /* invalid URL: ignored below */ }
    if (!SOURCES.has(source) || !retailer || !title || !host) return new NextResponse(null, { status: 204 });

    const sql = getDb();
    if (!sql) return new NextResponse(null, { status: 204 });
    const today = await sql`SELECT COUNT(*)::int AS n FROM offer_click_daily WHERE click_day = CURRENT_DATE` as Array<{ n: number }>;
    const existing = await sql`
      SELECT 1 FROM offer_click_daily
      WHERE click_day = CURRENT_DATE AND source = ${source} AND retailer = ${retailer} AND host = ${host} AND product_title = ${title}
      LIMIT 1
    ` as Array<unknown>;
    if (!existing.length && Number(today[0]?.n ?? 0) >= MAX_ROWS_PER_DAY) return new NextResponse(null, { status: 204 });
    await sql`
      INSERT INTO offer_click_daily (source, retailer, host, product_title, brand)
      VALUES (${source}, ${retailer}, ${host}, ${title}, ${brand})
      ON CONFLICT (click_day, source, retailer, host, product_title)
      DO UPDATE SET clicks = offer_click_daily.clicks + 1
    `;
  } catch { /* analytics must never affect shoppers */ }
  return new NextResponse(null, { status: 204 });
}
