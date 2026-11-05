import { getDb } from "@/lib/db";

/**
 * Searches that could not be served completely (budget used up, provider paused
 * or erroring, optional sources skipped) are remembered here. The scheduled
 * warm-up job (app/api/cron/warm-catalog) completes them later using leftover
 * free-tier credits, so the next visitor gets a full result from the cache.
 *
 * The queue is optional: if migration 004 has not been applied, every function
 * below fails soft and the app behaves as it did before.
 */
export type QueuedSearch = {
  cacheKey: string;
  category: string;
  brand: string;
  gender: string;
  releaseYear: number | null;
  query: string;
  requestCount: number;
  attempts: number;
};

export async function enqueueCatalogRefresh(entry: {
  cacheKey: string; category: string; brand: string; gender: string;
  releaseYear?: number; query: string; reason: string;
}): Promise<boolean> {
  const sql = getDb();
  if (!sql) return false;
  try {
    await sql`
      INSERT INTO catalog_refresh_queue
        (cache_key, category, brand, gender, release_year, query_text, reason)
      VALUES (${entry.cacheKey}, ${entry.category}, ${entry.brand}, ${entry.gender},
              ${entry.releaseYear ?? null}, ${entry.query.slice(0, 100)}, ${entry.reason.slice(0, 32)})
      ON CONFLICT (cache_key) DO UPDATE SET
        request_count = catalog_refresh_queue.request_count + 1,
        last_requested_at = NOW(),
        reason = EXCLUDED.reason,
        -- A search that degraded again after completing is pending again.
        completed_at = NULL,
        attempts = CASE WHEN catalog_refresh_queue.completed_at IS NOT NULL THEN 0 ELSE catalog_refresh_queue.attempts END
    `;
    return true;
  } catch {
    return false;
  }
}

/** Claims up to `limit` pending searches (most requested first). Rows are
 * stamped with an attempt so one failing search cannot monopolize every run. */
export async function claimCatalogRefreshes(limit: number): Promise<QueuedSearch[]> {
  const sql = getDb();
  if (!sql) return [];
  try {
    const rows = await sql`
      UPDATE catalog_refresh_queue q SET
        attempts = q.attempts + 1, last_attempt_at = NOW()
      WHERE q.cache_key IN (
        SELECT cache_key FROM catalog_refresh_queue
        WHERE completed_at IS NULL
          AND attempts < 6
          AND (last_attempt_at IS NULL OR last_attempt_at < NOW() - INTERVAL '3 hours')
        ORDER BY request_count DESC, first_requested_at ASC
        LIMIT ${Math.max(1, Math.min(10, limit))}
        FOR UPDATE SKIP LOCKED
      )
      RETURNING q.cache_key, q.category, q.brand, q.gender, q.release_year,
                q.query_text, q.request_count, q.attempts
    ` as Array<{
      cache_key: string; category: string; brand: string; gender: string;
      release_year: number | null; query_text: string; request_count: number; attempts: number;
    }>;
    return rows.map((row) => ({
      cacheKey: row.cache_key, category: row.category, brand: row.brand, gender: row.gender,
      releaseYear: row.release_year, query: row.query_text,
      requestCount: Number(row.request_count), attempts: Number(row.attempts),
    }));
  } catch {
    return [];
  }
}

export async function completeCatalogRefresh(cacheKey: string): Promise<void> {
  const sql = getDb();
  if (!sql) return;
  try {
    await sql`UPDATE catalog_refresh_queue SET completed_at = NOW() WHERE cache_key = ${cacheKey}`;
  } catch { /* queue bookkeeping is best-effort */ }
}

export async function pruneCatalogRefreshQueue(): Promise<void> {
  const sql = getDb();
  if (!sql) return;
  try {
    await sql`DELETE FROM catalog_refresh_queue WHERE completed_at IS NOT NULL AND completed_at < NOW() - INTERVAL '30 days'`;
    await sql`DELETE FROM catalog_refresh_queue WHERE completed_at IS NULL AND attempts >= 6 AND last_requested_at < NOW() - INTERVAL '14 days'`;
  } catch { /* best-effort */ }
}

export type QueueStats = { available: boolean; pending: number; oldestPendingAt: string | null; completedLast7Days: number };

export async function getCatalogQueueStats(): Promise<QueueStats> {
  const sql = getDb();
  if (!sql) return { available: false, pending: 0, oldestPendingAt: null, completedLast7Days: 0 };
  try {
    const rows = await sql`
      SELECT
        COUNT(*) FILTER (WHERE completed_at IS NULL AND attempts < 6)::int AS pending,
        MIN(first_requested_at) FILTER (WHERE completed_at IS NULL AND attempts < 6) AS oldest,
        COUNT(*) FILTER (WHERE completed_at > NOW() - INTERVAL '7 days')::int AS done_7d
      FROM catalog_refresh_queue
    ` as Array<{ pending: number; oldest: string | Date | null; done_7d: number }>;
    const row = rows[0];
    return {
      available: true,
      pending: Number(row?.pending ?? 0),
      oldestPendingAt: row?.oldest ? new Date(row.oldest).toISOString() : null,
      completedLast7Days: Number(row?.done_7d ?? 0),
    };
  } catch {
    return { available: false, pending: 0, oldestPendingAt: null, completedLast7Days: 0 };
  }
}
