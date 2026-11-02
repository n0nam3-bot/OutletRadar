import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";

function validVisitorId(value: unknown): value is string {
  return typeof value === "string" && /^[a-zA-Z0-9_-]{16,80}$/.test(value);
}

function safeProductUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && (url.hostname === "nike.com" || url.hostname.endsWith(".nike.com"));
  } catch { return false; }
}

export async function GET(request: NextRequest) {
  const visitorId = request.nextUrl.searchParams.get("visitorId");
  if (!validVisitorId(visitorId)) return NextResponse.json({ error: "Invalid visitor ID." }, { status: 400 });
  const sql = getDb();
  if (!sql) return NextResponse.json({ error: "Database is not configured." }, { status: 503 });
  try {
    const rows = await sql`
      SELECT id::text, product_url, title, image_url, style_code, current_price,
             full_price, discount_percent, currency, last_checked_at
      FROM watched_products
      WHERE visitor_id = ${visitorId}
      ORDER BY created_at DESC
      LIMIT 100
    `;
    return NextResponse.json({ items: rows });
  } catch {
    return NextResponse.json({ error: "Watchlist database is not initialized. Run db/schema.sql in Neon." }, { status: 503 });
  }
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || !validVisitorId(body.visitorId) || !safeProductUrl(body.productUrl) || typeof body.title !== "string" || body.title.length > 180) {
    return NextResponse.json({ error: "Invalid watchlist item." }, { status: 400 });
  }
  const sql = getDb();
  if (!sql) return NextResponse.json({ error: "Database is not configured." }, { status: 503 });
  try {
    const rows = await sql`
      INSERT INTO watched_products
        (visitor_id, product_url, title, image_url, style_code, current_price, full_price, discount_percent, currency)
      VALUES
        (${body.visitorId}, ${body.productUrl}, ${body.title}, ${typeof body.imageUrl === "string" ? body.imageUrl : null},
         ${typeof body.styleCode === "string" ? body.styleCode : null},
         ${typeof body.price === "number" ? body.price : null}, ${typeof body.fullPrice === "number" ? body.fullPrice : null},
         ${typeof body.discountPercent === "number" ? body.discountPercent : null}, ${typeof body.currency === "string" ? body.currency : "USD"})
      ON CONFLICT (visitor_id, product_url) DO UPDATE SET
        title = EXCLUDED.title, image_url = EXCLUDED.image_url, style_code = EXCLUDED.style_code,
        current_price = EXCLUDED.current_price, full_price = EXCLUDED.full_price,
        discount_percent = EXCLUDED.discount_percent, currency = EXCLUDED.currency
      RETURNING id::text, product_url, title, image_url, style_code, current_price, full_price,
                discount_percent, currency, last_checked_at
    `;
    return NextResponse.json({ item: rows[0] });
  } catch {
    return NextResponse.json({ error: "Could not save this item. Check that db/schema.sql has been run." }, { status: 503 });
  }
}

export async function DELETE(request: NextRequest) {
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || !validVisitorId(body.visitorId) || typeof body.productUrl !== "string") {
    return NextResponse.json({ error: "Invalid delete request." }, { status: 400 });
  }
  const sql = getDb();
  if (!sql) return NextResponse.json({ error: "Database is not configured." }, { status: 503 });
  try {
    await sql`DELETE FROM watched_products WHERE visitor_id = ${body.visitorId} AND product_url = ${body.productUrl}`;
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Could not update the watchlist." }, { status: 503 });
  }
}
