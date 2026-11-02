import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import type { NikeProduct } from "@/lib/types";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get("q")?.trim().replace(/[%_]/g, " ");
  if (!query || query.length < 3) return NextResponse.json({ suggestions: [], source: "neon-cache" });
  const sql = getDb();
  if (!sql) return NextResponse.json({ suggestions: [], source: "neon-cache", cacheConfigured: false });

  try {
    const pattern = `%${query}%`;
    const rows = await sql`
      SELECT product_json
      FROM nike_product_catalog
      WHERE title ILIKE ${pattern}
         OR COALESCE(subtitle, '') ILIKE ${pattern}
         OR COALESCE(style_code, '') ILIKE ${pattern}
      ORDER BY CASE WHEN lower(title) = lower(${query}) THEN 0
                    WHEN lower(title) LIKE lower(${pattern}) THEN 1 ELSE 2 END,
               updated_at DESC
      LIMIT 8
    ` as Array<{ product_json: unknown }>;
    const suggestions = rows.flatMap((row) => {
      const value = typeof row.product_json === "string" ? JSON.parse(row.product_json) : row.product_json;
      return value && typeof value === "object" ? [value as NikeProduct] : [];
    });
    return NextResponse.json({ suggestions, source: "neon-cache", cacheConfigured: true });
  } catch {
    // The typeahead is a cache-only lookup; never make a paid API call while typing.
    return NextResponse.json({ suggestions: [], source: "neon-cache", cacheConfigured: false });
  }
}
