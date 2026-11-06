import { fetchJson, pcktSources, records } from "@/lib/catalog-discovery";
import { channel3Candidates, channel3Configured, searchChannel3 } from "@/lib/channel3";
import { ebayConfigured, ebayOffers, searchEbay } from "@/lib/ebay";
import { impactConfigured, impactOffers, searchImpact } from "@/lib/impact";
import { nikeApiRequest, normalizeNikeProduct, productArray } from "@/lib/nike";
import { reserveProviderBudget, type BudgetProvider } from "@/lib/provider-budget";

/**
 * One real request to each configured provider, so the owner can confirm from the admin page
 * that every connection works and see which stores each one actually returns. Each probe
 * reserves its normal budget units first, so the usage counters stay accurate. Probes do not
 * touch the circuit breaker or any cache.
 */
export type ProbeResult = {
  provider: string; label: string; status: "ok" | "empty" | "error" | "not_configured" | "budget_reached";
  durationMs: number; count: number; retailers: string[]; sample: string[]; credits: string; message: string;
};

const QUERY = "Air Jordan 4";
const distinct = (values: string[]) => [...new Set(values.filter(Boolean))].slice(0, 30);
const str = (value: unknown) => (typeof value === "string" ? value.trim() : "");

async function probe(
  base: Pick<ProbeResult, "provider" | "label" | "credits">,
  configured: boolean, notConfiguredMessage: string,
  budget: { provider: BudgetProvider; units: number },
  run: () => Promise<{ count: number; retailers: string[]; sample: string[] }>,
): Promise<ProbeResult> {
  const empty = { count: 0, retailers: [] as string[], sample: [] as string[], durationMs: 0 };
  if (!configured) return { ...base, ...empty, status: "not_configured", message: notConfiguredMessage };
  try {
    if (!(await reserveProviderBudget(budget.provider, budget.units))) {
      return { ...base, ...empty, status: "budget_reached", message: "The app's safety budget for this provider is used up for today or this month, so no test request was sent." };
    }
  } catch (error) {
    return { ...base, ...empty, status: "error", message: `Could not reserve budget: ${error instanceof Error ? error.message : "database error"}` };
  }
  const started = Date.now();
  try {
    const result = await run();
    return { ...base, ...result, durationMs: Date.now() - started, status: result.count ? "ok" : "empty",
      message: result.count ? "Connected. The provider returned results." : "Connected, but the provider returned no results for the test search." };
  } catch (error) {
    return { ...base, ...empty, durationMs: Date.now() - started, status: "error", message: error instanceof Error ? error.message : "Request failed." };
  }
}

export async function runProviderSelfTest(only?: string): Promise<ProbeResult[]> {
  const wanted = (name: string) => !only || only === name;
  const jobs: Array<Promise<ProbeResult>> = [];

  if (wanted("pckt")) {
    const source = pcktSources[0]; // StockX: the cheapest PCKT endpoint (0.4 credits)
    jobs.push(probe({ provider: "pckt", label: "PCKT (StockX)", credits: "0.4 PCKT credit" }, Boolean(process.env.PCKT_API_KEY),
      "Add PCKT_API_KEY in Vercel.", { provider: "pckt", units: source.credits }, async () => {
        const url = new URL(`https://api.pckt.sh${source.path}`);
        Object.entries(source.params(QUERY)).forEach(([key, value]) => url.searchParams.set(key, value as string));
        const found = records(await fetchJson(url, { Authorization: `Bearer ${process.env.PCKT_API_KEY}`, Accept: "application/json" }));
        return { count: found.length, retailers: found.length ? ["StockX"] : [], sample: found.slice(0, 3).map((item) => str(item.title) || str(item.name)).filter(Boolean) };
      }));
  }
  if (wanted("serpapi")) {
    jobs.push(probe({ provider: "serpapi", label: "SerpApi (Google Shopping)", credits: "1 SerpApi search" }, Boolean(process.env.SERPAPI_API_KEY),
      "Add SERPAPI_API_KEY in Vercel.", { provider: "serpapi", units: 1 }, async () => {
        const url = new URL("https://serpapi.com/search.json");
        url.searchParams.set("engine", "google_shopping"); url.searchParams.set("q", QUERY);
        url.searchParams.set("gl", "us"); url.searchParams.set("hl", "en"); url.searchParams.set("api_key", process.env.SERPAPI_API_KEY as string);
        const payload = await fetchJson(url) as Record<string, unknown>;
        const results = (Array.isArray(payload?.shopping_results) ? payload.shopping_results : []) as Array<Record<string, unknown>>;
        return { count: results.length, retailers: distinct(results.map((item) => str(item.source))), sample: results.slice(0, 3).map((item) => str(item.title)).filter(Boolean) };
      }));
  }
  if (wanted("apish")) {
    jobs.push(probe({ provider: "apish", label: "API.SH (Nike.com)", credits: "1 API.SH request" }, Boolean(process.env.API_SH_KEY),
      "Add API_SH_KEY in Vercel.", { provider: "apish", units: 1 }, async () => {
        const products = productArray(await nikeApiRequest<unknown>("/nike/v1/search", { q: QUERY, country: "US" })).map(normalizeNikeProduct).filter((item) => Boolean(item));
        return { count: products.length, retailers: products.length ? ["Nike.com"] : [], sample: products.slice(0, 3).map((item) => item?.title ?? "").filter(Boolean) };
      }));
  }
  if (wanted("channel3")) {
    jobs.push(probe({ provider: "channel3", label: "Channel3", credits: "1 Channel3 credit" }, channel3Configured(),
      "Add CHANNEL3_API_KEY in Vercel.", { provider: "channel3", units: 1 }, async () => {
        const candidates = channel3Candidates(await searchChannel3(QUERY, 20));
        return { count: candidates.length, retailers: distinct(candidates.map((candidate) => candidate.offer.retailer)), sample: distinct(candidates.map((candidate) => candidate.productTitle)).slice(0, 3) };
      }));
  }
  if (wanted("ebay")) {
    jobs.push(probe({ provider: "ebay", label: "eBay Browse API", credits: "1 eBay call" }, ebayConfigured(),
      "Add EBAY_CLIENT_ID and EBAY_CLIENT_SECRET (production keyset) in Vercel.", { provider: "ebay", units: 1 }, async () => {
        const offers = ebayOffers(await searchEbay(QUERY, 20));
        return { count: offers.length, retailers: offers.length ? ["eBay"] : [], sample: offers.slice(0, 3).map((offer) => offer.title) };
      }));
  }
  if (wanted("impact")) {
    jobs.push(probe({ provider: "impact", label: "Impact partner catalogs", credits: "1 Impact call" }, impactConfigured(),
      "Add IMPACT_ACCOUNT_SID and IMPACT_AUTH_TOKEN in Vercel.", { provider: "impact", units: 1 }, async () => {
        const offers = await impactOffers(await searchImpact(["retro", "jordan", "4"], 30));
        return { count: offers.length, retailers: distinct(offers.map((offer) => offer.retailer)), sample: offers.slice(0, 3).map((offer) => offer.title) };
      }));
  }
  return Promise.all(jobs);
}
