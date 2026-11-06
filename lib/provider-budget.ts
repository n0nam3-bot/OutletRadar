import { getDb } from "@/lib/db";

export type BudgetProvider = "pckt" | "serpapi" | "apish" | "channel3";

function envNumber(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

// Application-side safety ceilings. They are not the providers' billing ledgers:
// keep each monthly figure below the provider's free allowance so a bug or traffic
// spike cannot exhaust the real quota. Every value can be overridden in Vercel with
// the environment variables named below (see docs/free-tier-operations.md).
//
// Daily ceilings spread the month's allowance across ~30 days. PCKT: 450 / 30 = 15.
export const PROVIDER_BUDGETS: Record<BudgetProvider, { monthly: number; daily: number }> = {
  pckt: {
    monthly: envNumber("PCKT_MONTHLY_BUDGET", 450, 0, 100_000),
    daily: envNumber("PCKT_DAILY_BUDGET", 15, 0, 10_000),
  },
  serpapi: {
    monthly: envNumber("SERPAPI_MONTHLY_BUDGET", 200, 0, 100_000),
    daily: envNumber("SERPAPI_DAILY_BUDGET", 7, 0, 10_000),
  },
  apish: {
    monthly: envNumber("APISH_MONTHLY_BUDGET", 1000, 0, 100_000),
    daily: envNumber("APISH_DAILY_BUDGET", 25, 0, 10_000),
  },
  // Channel3 free tier: 1,000 credits/month, 1 credit per search. 900/30 = 30 per day.
  channel3: {
    monthly: envNumber("CHANNEL3_MONTHLY_BUDGET", 900, 0, 100_000),
    daily: envNumber("CHANNEL3_DAILY_BUDGET", 30, 0, 10_000),
  },
};

/** Fraction of the daily budget the background warm-up job may use (default 40%).
 * The rest stays available for visitors' live searches. */
export function warmDailyShare(): number {
  return envNumber("WARM_DAILY_SHARE", 0.4, 0.05, 0.9);
}

/**
 * Atomically reserves daily + monthly units before an external request.
 * `dailyShare` (0-1) lowers the daily ceiling for this one reservation; the
 * warm-up job uses it so it can never starve visitor searches.
 */
export async function reserveProviderBudget(
  provider: BudgetProvider,
  units: number,
  options?: { dailyShare?: number },
): Promise<boolean> {
  const sql = getDb();
  if (!sql) return false;
  const limits = PROVIDER_BUDGETS[provider];
  const share = options?.dailyShare === undefined ? 1 : Math.min(1, Math.max(0, options.dailyShare));
  const dailyLimit = Math.round(limits.daily * share * 100) / 100;
  const rows = await sql`
    SELECT reserve_retailer_api_budget(
      ${provider}, ${units}, ${limits.monthly}, ${dailyLimit}
    ) AS reserved
  ` as Array<{ reserved: boolean }>;
  return rows[0]?.reserved === true;
}

export type ProviderBudgetStatus = {
  dailyLimit: number;
  dailyUsed: number;
  dailyRemaining: number;
  monthlyLimit: number;
  monthlyUsed: number;
  monthlyRemaining: number;
};

/** Read-only look at today's and this month's reservations. Returns null if
 * Neon or the usage tables are unavailable; callers must treat that as "unknown". */
export async function getProviderBudgetStatus(provider: BudgetProvider): Promise<ProviderBudgetStatus | null> {
  const sql = getDb();
  if (!sql) return null;
  const limits = PROVIDER_BUDGETS[provider];
  try {
    const rows = await sql`
      SELECT
        COALESCE((SELECT units_reserved FROM retailer_api_usage_daily
                  WHERE provider = ${provider} AND usage_day = CURRENT_DATE), 0)::float8 AS day_used,
        COALESCE((SELECT units_reserved FROM retailer_api_usage
                  WHERE provider = ${provider} AND usage_month = date_trunc('month', NOW())::date), 0)::float8 AS month_used
    ` as Array<{ day_used: number; month_used: number }>;
    const dayUsed = Number(rows[0]?.day_used ?? 0);
    const monthUsed = Number(rows[0]?.month_used ?? 0);
    return {
      dailyLimit: limits.daily,
      dailyUsed: dayUsed,
      dailyRemaining: Math.max(0, limits.daily - dayUsed),
      monthlyLimit: limits.monthly,
      monthlyUsed: monthUsed,
      monthlyRemaining: Math.max(0, limits.monthly - monthUsed),
    };
  } catch {
    return null;
  }
}
