/**
 * Protects the shared daily provider allowance from one runaway or abusive client, without ever blocking
 * anyone from getting results. Each search that has to ask a live provider (it was not answered by a cache or
 * the saved catalog) uses one "fresh lookup". A single connection may make LIVE_LOOKUPS_PER_HOUR of them per
 * hour (default 15, 0 = no limit). Beyond that the search is still answered, from saved or closest results,
 * and is queued so the warm-up completes it later. Normal visitors never notice.
 *
 * Counts live only in this server's memory and are never saved or logged; the connection address is used
 * transiently as the counter key. Because each server instance counts separately, this is a best-effort
 * guard, not a security boundary. For real abuse, use Vercel's firewall or rate limiting as well.
 */
const WINDOW_MS = 60 * 60 * 1000;
const MAX_KEYS = 20_000;
const buckets = new Map<string, { count: number; resetAt: number }>();

export function liveLookupsPerHour(): number {
  const value = Number(process.env.LIVE_LOOKUPS_PER_HOUR ?? 15);
  return Number.isFinite(value) ? Math.max(0, Math.min(10_000, Math.floor(value))) : 15;
}

/** The connecting client's address from proxy headers, or null when it cannot be determined. */
export function clientKeyFromHeaders(get: (name: string) => string | null): string | null {
  const raw = (get("x-forwarded-for") ?? "").split(",")[0]?.trim() || (get("x-real-ip") ?? "").trim();
  return raw && raw.length <= 64 && /^[0-9a-fA-F:.]+$/.test(raw) ? raw : null;
}

/** Counts one fresh lookup for this client. Returns false once the hourly allowance is used. */
export function allowLiveLookup(clientKey: string | null, now = Date.now()): boolean {
  const limit = liveLookupsPerHour();
  if (limit === 0 || !clientKey) return true;
  if (buckets.size >= MAX_KEYS) {
    for (const [key, bucket] of buckets) if (bucket.resetAt <= now) buckets.delete(key);
    if (buckets.size >= MAX_KEYS) buckets.clear(); // fail open rather than grow without bound
  }
  const bucket = buckets.get(clientKey);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(clientKey, { count: 1, resetAt: now + WINDOW_MS });
    return true;
  }
  if (bucket.count >= limit) return false;
  bucket.count++;
  return true;
}

export function resetLiveLimits(): void {
  buckets.clear();
}
