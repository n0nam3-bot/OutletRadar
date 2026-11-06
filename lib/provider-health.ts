import { getDb } from "@/lib/db";

export type ProviderHealthKey = "stockx" | "goat" | "flightclub" | "kickscrew" | "shopping" | "apish" | "channel3";
export type ProviderCooldown = { paused: boolean; disabledUntil?: string; consecutiveFailures: number };

/** Provider health telemetry is best-effort: an observability failure must not
 * take down a successful cached search or comparison. */
export async function getProviderCooldown(provider: ProviderHealthKey): Promise<ProviderCooldown> {
  const sql = getDb();
  if (!sql) return { paused: false, consecutiveFailures: 0 };
  try {
    const rows = await sql`
      SELECT disabled_until, consecutive_failures
      FROM provider_health WHERE provider = ${provider} LIMIT 1
    ` as Array<{ disabled_until: string | Date | null; consecutive_failures: number }>;
    const row = rows[0];
    if (!row) return { paused: false, consecutiveFailures: 0 };
    const disabledUntil = row.disabled_until ? new Date(row.disabled_until).toISOString() : undefined;
    return {
      paused: Boolean(disabledUntil && new Date(disabledUntil).getTime() > Date.now()),
      disabledUntil,
      consecutiveFailures: Number(row.consecutive_failures || 0),
    };
  } catch {
    return { paused: false, consecutiveFailures: 0 };
  }
}

export async function recordProviderSuccess(provider: ProviderHealthKey, latencyMs: number, resultCount?: number): Promise<void> {
  const sql = getDb();
  if (!sql) return;
  try {
    await sql`
      INSERT INTO provider_health (
        provider, last_attempt_at, last_success_at, last_latency_ms, last_result_count,
        consecutive_failures, disabled_until, last_error_code, last_error_message, updated_at
      ) VALUES (${provider}, NOW(), NOW(), ${Math.max(0, Math.round(latencyMs))}, COALESCE(${resultCount === undefined ? null : Math.max(0, Math.round(resultCount))}, 0), 0, NULL, NULL, NULL, NOW())
      ON CONFLICT (provider) DO UPDATE SET
        last_attempt_at = NOW(), last_success_at = NOW(),
        last_latency_ms = EXCLUDED.last_latency_ms,
        last_result_count = CASE WHEN ${resultCount === undefined} THEN provider_health.last_result_count ELSE EXCLUDED.last_result_count END,
        consecutive_failures = 0, disabled_until = NULL,
        last_error_code = NULL, last_error_message = NULL, updated_at = NOW()
    `;
  } catch {
    // Monitoring is deliberately non-blocking.
  }
}

export async function recordProviderFailure(provider: ProviderHealthKey, latencyMs: number, error: unknown): Promise<void> {
  const sql = getDb();
  if (!sql) return;
  const message = (error instanceof Error ? error.message : String(error || "Provider request failed.")).slice(0, 480);
  const codeMatch = message.match(/\b(?:HTTP|status)\s*(\d{3})\b/i);
  const code = codeMatch?.[1] || "provider_error";
  try {
    await sql`
      INSERT INTO provider_health (
        provider, last_attempt_at, last_error_at, last_error_code,
        last_error_message, last_latency_ms, last_result_count, consecutive_failures, disabled_until, updated_at
      ) VALUES (${provider}, NOW(), NOW(), ${code}, ${message}, ${Math.max(0, Math.round(latencyMs))}, 0, 1, NULL, NOW())
      ON CONFLICT (provider) DO UPDATE SET
        last_attempt_at = NOW(), last_error_at = NOW(),
        last_error_code = EXCLUDED.last_error_code,
        last_error_message = EXCLUDED.last_error_message,
        last_latency_ms = EXCLUDED.last_latency_ms,
        consecutive_failures = provider_health.consecutive_failures + 1,
        disabled_until = CASE
          WHEN provider_health.consecutive_failures + 1 >= 3 THEN
            NOW() + make_interval(secs => LEAST(21600, (300 * power(2, LEAST(provider_health.consecutive_failures - 2, 6)))::integer))
          ELSE provider_health.disabled_until
        END,
        updated_at = NOW()
    `;
  } catch {
    // Monitoring is deliberately non-blocking.
  }
}


export async function recordProviderSizeSync(
  provider: ProviderHealthKey,
  quoteCount: number,
  matchedOffers: number,
  persistedVariants: number,
): Promise<void> {
  const sql = getDb();
  if (!sql) return;
  try {
    await sql`
      INSERT INTO provider_health (
        provider, last_size_quote_count, last_size_matched_offers,
        last_size_persisted_variants, last_size_checked_at, updated_at
      ) VALUES (
        ${provider}, ${Math.max(0, quoteCount)}, ${Math.max(0, matchedOffers)},
        ${Math.max(0, persistedVariants)}, NOW(), NOW()
      )
      ON CONFLICT (provider) DO UPDATE SET
        last_size_quote_count = EXCLUDED.last_size_quote_count,
        last_size_matched_offers = EXCLUDED.last_size_matched_offers,
        last_size_persisted_variants = EXCLUDED.last_size_persisted_variants,
        last_size_checked_at = NOW(), updated_at = NOW()
    `;
  } catch {
    // Diagnostics must never interrupt a working size response.
  }
}
