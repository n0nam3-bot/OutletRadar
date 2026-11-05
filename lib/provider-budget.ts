import { getDb } from "@/lib/db";

export type BudgetProvider = "pckt" | "serpapi" | "apish";

// Daily ceilings smooth usage across the whole month. With a 30-day budget
// model these leave a safety margin under the monthly hard stop.
export const PROVIDER_BUDGETS: Record<BudgetProvider, { monthly: number; daily: number }> = {
  pckt: { monthly: 450, daily: 12.5 },
  serpapi: { monthly: 200, daily: 6 },
  // Conservative application cap under the API.SH free allowance; this is a
  // site-side guardrail, not a claim about the provider's billing ledger.
  apish: { monthly: 1000, daily: 25 },
};

export async function reserveProviderBudget(provider: BudgetProvider, units: number): Promise<boolean> {
  const sql = getDb();
  if (!sql) return false;
  const limits = PROVIDER_BUDGETS[provider];
  const rows = await sql`
    SELECT reserve_retailer_api_budget(
      ${provider}, ${units}, ${limits.monthly}, ${limits.daily}
    ) AS reserved
  ` as Array<{ reserved: boolean }>;
  return rows[0]?.reserved === true;
}
