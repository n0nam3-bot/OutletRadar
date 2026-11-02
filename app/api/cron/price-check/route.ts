import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { normalizeNikeProduct, nikeApiRequest } from "@/lib/nike";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const authorization = request.headers.get("authorization");
  if (!secret || authorization !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  const sql = getDb();
  if (!sql || !process.env.API_SH_KEY) {
    return NextResponse.json({ error: "Price checks require DATABASE_URL and API_SH_KEY." }, { status: 503 });
  }

  const requestedLimit = Number(process.env.MAX_DAILY_PRICE_CHECKS ?? 10);
  const limit = Number.isFinite(requestedLimit) ? Math.max(1, Math.min(10, Math.floor(requestedLimit))) : 10;
  let rows: Record<string, unknown>[];
  try {
    rows = await sql`
      SELECT id::text, product_url, title
      FROM watched_products
      WHERE last_checked_at IS NULL OR last_checked_at < now() - interval '22 hours'
      ORDER BY last_checked_at NULLS FIRST, created_at ASC
      LIMIT ${limit}
    ` as Record<string, unknown>[];
  } catch {
    return NextResponse.json({ error: "Watchlist database is not initialized." }, { status: 503 });
  }

  let checked = 0;
  let failed = 0;
  for (const row of rows) {
    try {
      const payload = await nikeApiRequest<unknown>("/nike/v1/product", { url: String(row.product_url) });
      const root = payload as Record<string, unknown>;
      const candidate = root?.product ?? root?.data ?? payload;
      const product = normalizeNikeProduct(candidate);
      const update = await sql`
        UPDATE watched_products SET
          current_price = ${product?.price ?? null}, full_price = ${product?.fullPrice ?? null},
          discount_percent = ${product?.discountPercent ?? null},
          title = ${product?.title ?? String(row.title)}, last_checked_at = now()
        WHERE id = ${String(row.id)}::uuid
        RETURNING id::text, current_price, full_price, discount_percent, currency
      `;
      const latest = update[0] as Record<string, unknown> | undefined;
      if (latest) {
        await sql`
          INSERT INTO price_history (watch_id, price, full_price, discount_percent, currency, checked_at)
          SELECT ${String(row.id)}::uuid, ${latest.current_price as number | null},
                 ${latest.full_price as number | null}, ${latest.discount_percent as number | null},
                 ${String(latest.currency ?? "USD")}, now()
          WHERE NOT EXISTS (
            SELECT 1 FROM price_history
            WHERE watch_id = ${String(row.id)}::uuid AND checked_at::date = current_date
          )
        `;
      }
      checked += 1;
    } catch {
      failed += 1;
    }
  }

  return NextResponse.json({ ok: true, checked, failed, dailyLimit: limit, note: "Price and size data are online product data, not physical-store stock." });
}
