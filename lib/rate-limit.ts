import { createHash } from "node:crypto";
import type { NextRequest } from "next/server";
import { getDb } from "@/lib/db";

const DAILY_SEARCH_LIMIT = 20;
const localHits = new Map<string, { day: string; count: number }>();

/**
 * Daily per-IP limit. Neon provides a shared limit across Vercel instances;
 * a process-local fallback is used when the database has not been configured.
 * The raw client IP is never stored (only a keyed SHA-256 digest is saved).
 */
export async function allowSearch(request: NextRequest): Promise<boolean> {
  const rawIp = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || request.headers.get("x-real-ip")
    || "unknown-client";
  const secretSalt = process.env.RATE_LIMIT_SALT || process.env.API_SH_KEY || "local-nike-finder";
  const key = createHash("sha256").update(`${secretSalt}:${rawIp}`).digest("hex");
  const today = new Date().toISOString().slice(0, 10);
  const sql = getDb();

  if (sql) {
    try {
      const rows = await sql`
        INSERT INTO search_rate_limits (ip_hash, usage_day, request_count)
        VALUES (${key}, CURRENT_DATE, 1)
        ON CONFLICT (ip_hash, usage_day)
        DO UPDATE SET request_count = search_rate_limits.request_count + 1
        RETURNING request_count
      `;
      return Number(rows[0]?.request_count ?? DAILY_SEARCH_LIMIT + 1) <= DAILY_SEARCH_LIMIT;
    } catch {
      // Missing migration or a temporary database outage: fall through to a local guard.
    }
  }

  const bucket = localHits.get(key);
  const count = bucket?.day === today ? bucket.count + 1 : 1;
  localHits.set(key, { day: today, count });
  // Bound memory use on long-lived development processes.
  if (localHits.size > 5_000) {
    for (const [storedKey, storedValue] of localHits) {
      if (storedValue.day !== today) localHits.delete(storedKey);
    }
  }
  return count <= DAILY_SEARCH_LIMIT;
}
