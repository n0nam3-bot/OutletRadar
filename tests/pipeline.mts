import { readdirSync, readFileSync } from "node:fs";
import { createTestDatabase } from "./harness.mts";

const root = new URL("../", import.meta.url);
const pg = await createTestDatabase();
const stripExtension = (sql: string) => sql.replace(/CREATE EXTENSION IF NOT EXISTS pgcrypto;/g, "");
const schema = stripExtension(readFileSync(new URL("db/schema.sql", root), "utf8"));
await pg.exec(schema);
// Idempotency: applying the schema and every migration a second time must not fail.
await pg.exec(schema);
for (const file of readdirSync(new URL("db/migrations/", root)).filter((name) => name.endsWith(".sql")).sort()) {
  await pg.exec(stripExtension(readFileSync(new URL(`db/migrations/${file}`, root), "utf8")));
}
console.log("schema + migrations applied twice OK");

process.env.API_SH_KEY = "test"; process.env.CHANNEL3_API_KEY = "test"; process.env.PCKT_API_KEY = "test"; process.env.SERPAPI_API_KEY = "test"; process.env.CRON_SECRET = "s3cret-s3cret-s3cret-s3cret";

let calls: string[] = [];
const realFetch = globalThis.fetch;
globalThis.fetch = (async function (input: any) {
  const url = String(input);
  calls.push(url.replace(/\?.*/, "").replace("https://", ""));
  const q = new URL(url).searchParams;
  const term = (q.get("query") || q.get("q") || "").toLowerCase();
  const num = (term.match(/\b(\d+)\b/) || [])[1] || "4";
  if (url.includes("api.api.sh")) {
    return new Response(JSON.stringify({ success: true, data: { products: [
      { id: "nk1", title: `Air Jordan ${num} Retro`, subtitle: "Men's Shoes", style_code: `CU111${num}-010`, url: `https://www.nike.com/t/air-jordan-${num}-retro/CU111${num}-010`, price: 210, full_price: 210, image_url: "https://x/n.jpg" },
      { id: "nk2", title: "Nike Dunk Low Retro", subtitle: "Men's Shoes", style_code: "DD1391-100", url: "https://www.nike.com/t/dunk-low/DD1391-100", price: 115 },
    ] } }), { status: 200 });
  }
  if (url.includes("api.impact.com")) {
    calls.push("impact:" + decodeURIComponent(url.replace("https://api.impact.com", "")) + ":" + String((arguments as any)[1]?.headers?.authorization).slice(0, 14) + ":" + String((arguments as any)[1]?.headers?.accept));
    if ((globalThis as any).__impactFail) return new Response(JSON.stringify({ Message: "Authentication failed" }), { status: 401 });
    if (/\/Catalogs\/42\/Items/.test(url)) {
      const pageNo = Number(new URL(url).searchParams.get("Page") || "1");
      const v = (name: string, size: string, stock: string, extra: Record<string, unknown> = {}) => ({ Name: name, Manufacturer: "adidas", Url: `https://adidas.pxf.io/c/1/2/3?u=${encodeURIComponent(name + size)}`, ImageUrl: "https://x/ad.jpg", CurrentPrice: "100.00", OriginalPrice: "100.00", Currency: "USD", Gender: "Men", Color: "Black", Size: size, StockAvailability: stock, Category: "Shoes > Sneakers", CatalogItemId: `${name}-${size}`, Mpn: "IE3437", ...extra });
      const items = pageNo === 1 ? [
        v("adidas Samba OG Shoes", "8", "InStock"), v("adidas Samba OG Shoes", "9", "InStock", { CurrentPrice: "95.00" }), v("adidas Samba OG Shoes", "10", "InStock"), v("adidas Samba OG Shoes", "11", "OutOfStock"),
        v("adidas Essentials Tee", "M", "InStock", { Category: "Apparel > T-Shirts", Mpn: "T1" }),
        v("Unbranded Slide", "9", "InStock", { Manufacturer: "", Category: "Shoes > Slides" }),
      ] : [
        v("adidas Gazelle Indoor Shoes", "7", "InStock", { CurrentPrice: "90.00", OriginalPrice: "120.00", Mpn: "IG1634", Color: "Blue" }), v("adidas Gazelle Indoor Shoes", "8", "InStock", { CurrentPrice: "90.00", OriginalPrice: "120.00", Mpn: "IG1634", Color: "Blue" }),
        v("adidas Sold Out Runner Shoes", "9", "OutOfStock", { Mpn: "S0" }),
      ];
      return new Response(JSON.stringify({ "@page": String(pageNo), "@numpages": "2", "@pagesize": "250", Items: items }), { status: 200 });
    }
    if (url.includes("/Catalogs/ItemSearch")) {
      return new Response(JSON.stringify({ Items: [
        { Name: "Air Jordan 4 Retro Black Cat Men's Shoe", Manufacturer: "Jordan", Url: "https://footlocker.pxf.io/c/1/2/3?prodsku=AJ4", ImageUrl: "https://x/fl.jpg", CurrentPrice: "219.99", Currency: "USD", StockAvailability: "InStock", CatalogItemId: "fl-1", Uri: "/Mediapartners/IRtest/Catalogs/42/Items/product_42_fl-1" },
        { Name: "Air Jordan 4 Retro Black Cat", Manufacturer: "Jordan", Url: "https://footlocker.pxf.io/c/1/2/3?prodsku=AJ4B", CurrentPrice: "229.99", StockAvailability: "InStock", CatalogItemId: "fl-2", Uri: "/Mediapartners/IRtest/Catalogs/42/Items/product_42_fl-2" },
        { Name: "Air Jordan 4 Retro Black Cat", Manufacturer: "Jordan", Url: "https://newbalance.pxf.io/c/9/9/9?prodsku=X", CurrentPrice: "225.00", StockAvailability: "OutOfStock", CatalogItemId: "nb-1", Uri: "/Mediapartners/IRtest/Catalogs/77/Items/product_77_nb-1" },
        { Name: "Air Jordan 4 Retro Military Blue", Manufacturer: "Jordan", Url: "https://footlocker.pxf.io/c/1/2/3?prodsku=MB", CurrentPrice: "190.00", CatalogItemId: "fl-3", Uri: "/Mediapartners/IRtest/Catalogs/42/Items/product_42_fl-3" },
        { Name: "Air Jordan 14 Retro Black Cat", Manufacturer: "Jordan", Url: "https://footlocker.pxf.io/c/1/2/3?prodsku=14", CurrentPrice: "170.00", CatalogItemId: "fl-4", Uri: "/Mediapartners/IRtest/Catalogs/42/Items/product_42_fl-4" },
      ] }), { status: 200 });
    }
    return new Response(JSON.stringify({ Catalogs: [ { Id: "42", CampaignName: "Foot Locker" }, { Id: "77", CampaignName: "Finish Line" }, { Id: "99", CampaignName: "adidas US" } ] }), { status: 200 });
  }
  if (url.includes("identity/v1/oauth2/token")) {
    calls.push("ebay-token:" + String((arguments as any)[1]?.headers?.authorization).slice(0, 12) + ":" + String((arguments as any)[1]?.body));
    return new Response(JSON.stringify({ access_token: "tok123", expires_in: 7200 }), { status: 200 });
  }
  if (url.includes("buy/browse/v1/item_summary/search")) {
    calls.push("ebay-search:" + decodeURIComponent(url.split("?")[1] || "") + ":" + String((arguments as any)[1]?.headers?.authorization) + ":" + String((arguments as any)[1]?.headers?.["x-ebay-c-enduserctx"]));
    return new Response(JSON.stringify({ itemSummaries: [
      { itemId: "v1|111|0", title: "Nike Air Jordan 4 Retro Black Cat CU1110-010 NEW", price: { value: "245.00", currency: "USD" }, image: { imageUrl: "https://i.ebayimg.com/a.jpg" }, itemWebUrl: "https://www.ebay.com/itm/111", itemAffiliateWebUrl: "https://rover.ebay.com/rover/1/111", condition: "New", seller: { username: "sneakerhub", feedbackPercentage: "99.8" } },
      { itemId: "v1|222|0", title: "Air Jordan 4 Retro Black Cat Size 10", price: { value: "230.00", currency: "USD" }, itemWebUrl: "https://www.ebay.com/itm/222", condition: "New", seller: { username: "kicksdeals", feedbackPercentage: "100" } },
      { itemId: "v1|333|0", title: "Air Jordan 4 Retro Military Blue", price: { value: "180.00", currency: "USD" }, itemWebUrl: "https://www.ebay.com/itm/333" },
      { itemId: "v1|444|0", title: "Air Jordan 14 Retro Black Cat", price: { value: "150.00", currency: "USD" }, itemWebUrl: "https://www.ebay.com/itm/444" },
    ] }), { status: 200 });
  }
  if (url.includes("trychannel3")) {
    calls.push("channel3-body:" + String((arguments as any)[1]?.body));
    return new Response(JSON.stringify({ products: [
      { id: "c1", title: "Air Jordan 4 Retro Black Cat Men's Shoes", brand: { name: "Jordan" }, images: [{ url: "https://x/c.jpg", is_main_image: true }], offers: [
        { domain: "www.footlocker.com", url: "https://www.footlocker.com/product/aj4", price: { price: 210, currency: "USD" }, availability: "InStock" },
        { domain: "champssports.com", url: "https://www.champssports.com/product/aj4", price: { price: 215, currency: "USD" }, availability: "InStock" },
        { domain: "champssports.com", url: "https://www.champssports.com/product/aj4b", price: { price: 230, currency: "USD" }, availability: "InStock" },
        { domain: "stockx.com", url: "https://stockx.com/aj4", price: { price: 300, currency: "USD" }, availability: "InStock" },
        { domain: "snipesusa.com", url: "https://www.snipesusa.com/aj4", price: { price: 214, currency: "USD" }, availability: "OutOfStock" } ] },
      { id: "c2", title: "Air Jordan 4 Retro Military Blue", brand: { name: "Jordan" }, offers: [
        { domain: "jdsports.com", url: "https://www.jdsports.com/aj4mb", price: { price: 200, currency: "USD" }, availability: "InStock" } ] },
      { id: "c3", title: "Air Jordan 14 Retro Black Cat", brand: { name: "Jordan" }, offers: [
        { domain: "ebay.com", url: "https://www.ebay.com/aj14", price: { price: 150, currency: "USD" }, availability: "InStock" } ] },
    ] }), { status: 200 });
  }
  if (url.includes("serpapi")) {
    return new Response(JSON.stringify({ shopping_results: [{ title: `Air Jordan ${num} Retro Black Cat`, link: "https://www.footlocker.com/product/aj"+num, source: "Foot Locker", extracted_price: 210, thumbnail: "https://x/y.jpg" }] }), { status: 200 });
  }
  const host = url.includes("stockx") ? "stockx" : url.includes("goat") ? "goat" : url.includes("flightclub") ? "flightclub" : "kickscrew";
  return new Response(JSON.stringify({ data: { results: [{ title: `Air Jordan ${num} Retro Black Cat`, brand: "Jordan", sku: `CU111${num}-010`, slug: `aj${num}-${host}`, id: `${host}-${num}`, price: 300, image: "https://x/i.jpg" }] } }), { status: 200 });
}) as any;

const { discoverCatalog } = await import("../lib/catalog-discovery.ts");
const { reserveProviderBudget, getProviderBudgetStatus } = await import("../lib/provider-budget.ts");
const { getCatalogQueueStats } = await import("../lib/catalog-queue.ts");
const q = (o: Record<string,string>) => new URLSearchParams(o);
let failures = 0;
function check(name: string, ok: boolean, detail = "") { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  -> " + detail : ""}`); if (!ok) failures++; }
const statuses = (b: any) => b.sources.map((s: any) => `${s.key}:${s.status}`).join(",");

// S1 fresh day, full budget
let r = await discoverCatalog(q({ category: "sneakers", brand: "jordan", q: "aj4" })); if (!(r.body as any).products) console.log("DEBUG", r.status, JSON.stringify(r.body));
check("S1 aliases expand (aj4 -> air jordan 4) and discovery succeeds", r.status === 200 && (r.body as any).products.length >= 1, `${(r.body as any).products.length} products; ${statuses(r.body)}`);
check("S1 complete + no notice", (r.body as any).complete === true && (r.body as any).notice === null);
check("S1 used all 4 PCKT sources + Nike.com + SerpApi", calls.length === 6, calls.join(" | "));
let st = await getProviderBudgetStatus("pckt");
check("S1 PCKT daily usage = 2.2", Math.abs(st!.dailyUsed - 2.2) < 0.001, String(st!.dailyUsed));

// S2 same query via different wording hits cache, no provider calls
calls = [];
r = await discoverCatalog(q({ category: "sneakers", brand: "jordan", q: "Air Jordan 4" }));
check("S2 'Air Jordan 4' shares cache with 'aj4' (no provider calls)", calls.length === 0 && (r.body as any).cached === true, `calls=${calls.length}`);

// S6 conserve optional sources when <50% of today's allowance remains
await pg.query("UPDATE retailer_api_usage_daily SET units_reserved = 9 WHERE provider='pckt'");
calls = [];
r = await discoverCatalog(q({ category: "sneakers", brand: "jordan", q: "Air Jordan 3" }));
check("S6 Flight Club + Kicks Crew skipped when allowance is low", statuses(r.body).includes("flightclub:skipped") && statuses(r.body).includes("kickscrew:skipped"), statuses(r.body));
check("S6 only StockX+GOAT(+SerpApi) were called", calls.filter(c => c.includes("pckt")).length === 2, calls.join(" | "));
check("S6 incomplete, queued, still returns products", (r.body as any).incomplete === true && (r.body as any).queued === true && (r.body as any).products.length >= 1, (r.body as any).notice);
let cacheRows = await pg.query("SELECT 1 FROM retailer_search_cache WHERE query_text LIKE 'catalog: sneakers / jordan / air jordan 3'");
check("S6 incomplete result was NOT written to the 12h exact cache", cacheRows.rows.length === 0);

// S3 budget fully exhausted: new query -> never a blank page
await pg.query("UPDATE retailer_api_usage_daily SET units_reserved = 15 WHERE provider='pckt'");
await pg.query("UPDATE retailer_api_usage_daily SET units_reserved = 7 WHERE provider='serpapi'");
await pg.query("INSERT INTO retailer_api_usage_daily (provider, usage_day, units_reserved) VALUES ('apish', CURRENT_DATE, 25) ON CONFLICT (provider, usage_day) DO UPDATE SET units_reserved = 25");
calls = [];
r = await discoverCatalog(q({ category: "sneakers", brand: "jordan", q: "Air Jordan 11" }));
check("S3 no provider calls when budget is exhausted", calls.length === 0, calls.join(","));
check("S3 closest saved products shown instead of an empty page", (r.body as any).approximate === true && (r.body as any).products.length >= 1, `${(r.body as any).products.length} products`);
check("S3 queued for the warm-up job + user-facing notice", (r.body as any).queued === true && /used up/.test((r.body as any).notice), (r.body as any).notice);
cacheRows = await pg.query("SELECT 1 FROM retailer_search_cache WHERE query_text LIKE '%air jordan 11%'");
check("S3 empty/approximate result was NOT cached for 12h", cacheRows.rows.length === 0);

// S4 stale provider snapshots are used when the budget is exhausted
await pg.query("UPDATE retailer_search_cache SET expires_at = NOW() - INTERVAL '2 days'");
await pg.exec("DELETE FROM retailer_offer_sizes; DELETE FROM retailer_offers; DELETE FROM canonical_products");
r = await discoverCatalog(q({ category: "sneakers", brand: "jordan", q: "Air Jordan 4" }));
check("S4 expired snapshots shown as 'stale' when budget is exhausted", statuses(r.body).includes("stockx:stale") && (r.body as any).products.length >= 1, statuses(r.body));
check("S4 flagged incomplete + queued", (r.body as any).incomplete === true && (r.body as any).queued === true);

// S9 saved copy of exact search when everything else is empty
await pg.query("DELETE FROM retailer_search_cache WHERE query_text LIKE 'provider-catalog:%'");
await pg.query("DELETE FROM canonical_products");
r = await discoverCatalog(q({ category: "sneakers", brand: "jordan", q: "Air Jordan 4" }));
check("S9 expired exact-query cache served as a saved copy", (r.body as any).savedSearch === true && (r.body as any).products.length >= 1, (r.body as any).notice);

// Queue + warm-up route
let qs = await getCatalogQueueStats();
check("Queue has pending searches", qs.available && qs.pending >= 3, JSON.stringify(qs));
await pg.query("UPDATE retailer_api_usage_daily SET units_reserved = 0");
await pg.query("DELETE FROM retailer_search_cache");
const route = await import("../app/api/cron/warm-catalog/route.ts");
const fakeReq = (auth?: string, max = "3") => ({ headers: { get: (k: string) => k.toLowerCase() === "authorization" ? (auth ?? null) : null }, nextUrl: { searchParams: new URLSearchParams({ max }) } }) as any;
let res = await route.GET(fakeReq());
check("Warm route rejects missing secret", res.status === 401);
res = await route.GET(fakeReq("Bearer wrong"));
check("Warm route rejects wrong secret", res.status === 401);
calls = [];
res = await route.GET(fakeReq(`Bearer ${process.env.CRON_SECRET}`));
const body: any = await res.json();
check("Warm route runs queued searches", res.status === 200 && body.ran >= 1 && body.results.some((x: any) => x.source === "queue" && x.outcome === "refreshed"), JSON.stringify(body.results));
qs = await getCatalogQueueStats();
check("Completed queue entries are marked done", qs.completedLast7Days >= 1, JSON.stringify(qs));
st = await getProviderBudgetStatus("pckt");
check("Warm run stayed within 40% of the daily PCKT allowance (<= 6.0)", st!.dailyUsed <= 6.0 + 1e-9, String(st!.dailyUsed));
check("reserve with dailyShare refuses once the share is spent", (await reserveProviderBudget("pckt", 2.2, { dailyShare: 0.4 })) === (st!.dailyUsed + 2.2 <= 6.0));

// Seeds: once the queue is drained the warm-up job refreshes popular seed searches
await pg.query("UPDATE catalog_refresh_queue SET completed_at = NOW()");
await pg.query("UPDATE retailer_api_usage_daily SET units_reserved = 0");
calls = [];
res = await route.GET(fakeReq(`Bearer ${process.env.CRON_SECRET}`, "2"));
const seedBody: any = await res.json();
check("Warm route refreshes seed searches when the queue is empty", seedBody.results.length === 2 && seedBody.results.every((x: any) => x.source === "seed"), JSON.stringify(seedBody.results.map((x: any) => x.query + ":" + x.outcome)));
const seedCached = await pg.query("SELECT COUNT(*)::int AS n FROM retailer_search_cache WHERE query_text LIKE 'catalog: sneakers / jordan%'");
check("Seed results were written to the exact-query cache", (seedCached.rows[0] as any).n >= 1);

// ---- Nike.com source (API.SH) ----
await pg.query("DELETE FROM retailer_search_cache"); await pg.exec("DELETE FROM retailer_offer_sizes; DELETE FROM retailer_offers; DELETE FROM canonical_products");
await pg.query("UPDATE retailer_api_usage_daily SET units_reserved = 0"); await pg.query("UPDATE provider_health SET consecutive_failures = 0, disabled_until = NULL").catch(() => {});
calls = [];
r = await discoverCatalog(q({ category: "sneakers", brand: "jordan", q: "Air Jordan 4" }));
check("Nike: API.SH queried for a Jordan search", calls.some(c => c.includes("api.api.sh")), calls.join(" | "));
check("Nike: nike source status success", statuses(r.body).includes("nike:success"), statuses(r.body));
const allListings = ((r.body as any).products as any[]).flatMap(p => p.listings.map((l: any) => l.source + ":" + l.retailer));
check("Nike: Nike.com listing grouped with marketplace listings", allListings.includes("nike:Nike.com"), allListings.join(","));
check("Nike: unrelated Nike result (Dunk) filtered out", !((r.body as any).products as any[]).some(p => /Dunk/.test(p.title)));
let apish = await getProviderBudgetStatus("apish");
check("Nike: used 1 API.SH unit", apish!.dailyUsed === 1, String(apish!.dailyUsed));
const nikeOffers = await pg.query("SELECT retailer_name FROM retailer_offers WHERE source = 'nike'");
check("Nike: offers persisted to the normalized catalog", nikeOffers.rows.length >= 1);
calls = [];
r = await discoverCatalog(q({ category: "sneakers", brand: "adidas", q: "Samba" }));
check("Nike: NOT queried for an adidas search", !calls.some(c => c.includes("api.api.sh")) && !statuses(r.body).includes("nike:"), statuses(r.body));

// ---- Nike budget exhaustion degrades like the others ----
await pg.query("UPDATE retailer_api_usage_daily SET units_reserved = 25 WHERE provider='apish'");
r = await discoverCatalog(q({ category: "sneakers", brand: "nike", q: "Air Max 90" }));
check("Nike: budget exhausted -> status budget_reached, search still answered", statuses(r.body).includes("nike:budget_reached") && (r.body as any).incomplete === true, statuses(r.body));

// ---- Coverage queue: stored result served, missing snapshots queued quietly ----
await pg.query("UPDATE retailer_api_usage_daily SET units_reserved = 0");
await pg.query("DELETE FROM retailer_search_cache WHERE query_text LIKE 'provider-catalog:%' OR query_text NOT LIKE 'catalog%'");
await pg.query("DELETE FROM retailer_search_cache");
await pg.query("DELETE FROM catalog_refresh_queue");
r = await discoverCatalog(q({ category: "sneakers", brand: "jordan", q: "Air Jordan 4" }));
check("Coverage: stored catalog serves the search", (r.body as any).cacheSource === "normalized_catalog", JSON.stringify((r.body as any).cacheSource));
const covQueue = await pg.query("SELECT reason FROM catalog_refresh_queue");
check("Nike: Nike.com offers saved earlier are returned when the catalog is read back (v2.4 regression fixed)", ((r.body as any).products as any[]).some(p => p.listings.some((l: any) => l.source === "nike")), JSON.stringify(((r.body as any).products as any[]).map(p => p.listings.map((l: any) => l.source))));
check("Coverage: search quietly queued for a full refresh", covQueue.rows.length === 1 && (covQueue.rows[0] as any).reason === "coverage", JSON.stringify(covQueue.rows));
check("Coverage: no user-facing notice for coverage-only refresh", (r.body as any).notice === undefined || (r.body as any).notice === null);

// ---- Channel3 live comparison ----
const offersRoute = await import("../app/api/catalog/offers/route.ts");
const target = { id: "t1", title: "Air Jordan 4 Retro Black Cat", brand: "Jordan", category: "sneakers", styleCode: "CU1110-010", listings: [
  { source: "stockx", retailer: "StockX", title: "Air Jordan 4 Retro Black Cat", url: "https://stockx.com/aj4", price: 300, currency: "USD" } ] };
const offersReq = (extra: Record<string, unknown> = {}) => ({ json: async () => ({ product: target, audience: "men", ...extra }) }) as any;
await pg.query("UPDATE retailer_api_usage_daily SET units_reserved = 0");
await pg.query("UPDATE provider_health SET consecutive_failures = 0, disabled_until = NULL").catch(() => {});
calls = [];
let cr = await offersRoute.POST(offersReq());
let cb: any = await cr.json();
const names = cb.offers.map((o: any) => o.retailer);
check("Channel3: returns Foot Locker, Champs and Snipes offers", ["Foot Locker", "Champs Sports", "Snipes USA"].every(n => names.includes(n)), names.join(","));
check("Channel3: excludes a different colorway (Military Blue) and a different model (Jordan 14)", !names.includes("JD Sports") && !names.includes("eBay"), names.join(","));
check("Channel3: retailers already in the catalog group are not duplicated", names.filter((n: string) => n === "StockX").length === 1);
check("Channel3: cheapest offer kept per retailer", cb.offers.filter((o: any) => o.retailer === "Champs Sports").length === 1 && cb.offers.find((o: any) => o.retailer === "Champs Sports").price === 215);
check("Channel3: status success and 1 credit reserved", cb.sources.find((s: any) => s.key === "channel3")?.status === "success" && (await getProviderBudgetStatus("channel3"))!.dailyUsed === 1);
check("Channel3: request body has query and limit, no brand_ids", /"query":"Air Jordan 4 Retro Black Cat CU1110-010/.test(calls.find(c => c.startsWith("channel3-body")) || "") && !/brand_ids/.test(calls.join("")));
const sf = cb.offers.find((o: any) => o.retailer === "Snipes USA");
check("Channel3: out-of-stock merchant signal preserved as unavailable", sf?.availability === "unavailable");
const c3Persisted = await pg.query("SELECT 1 FROM retailer_offers WHERE source = 'channel3'");
check("Channel3: offers are NOT saved to the normalized catalog (terms)", c3Persisted.rows.length === 0);
const c3Cache = await pg.query("SELECT (expires_at - cached_at) AS ttl FROM retailer_search_cache WHERE query_text LIKE '%Black Cat%' ORDER BY cached_at DESC LIMIT 1");
check("Channel3: comparison cached for 3 hours, not 6", /^03:00:00/.test(String((c3Cache.rows[0] as any)?.ttl?.hours !== undefined ? `0${(c3Cache.rows[0] as any).ttl.hours}:00:00` : (c3Cache.rows[0] as any)?.ttl)), JSON.stringify((c3Cache.rows[0] as any)?.ttl));
calls = [];
cr = await offersRoute.POST(offersReq()); cb = await cr.json();
check("Channel3: second compare served from cache with no new credit", cb.cached === true && !calls.some(c => c.includes("trychannel3")));
// budget exhausted -> other retailers still shown, incomplete result not cached
await pg.query("DELETE FROM retailer_search_cache"); await pg.query("UPDATE retailer_api_usage_daily SET units_reserved = 30 WHERE provider='channel3'");
calls = [];
cr = await offersRoute.POST(offersReq()); cb = await cr.json();
check("Channel3: exhausted budget -> budget_reached, catalog offers still shown", cb.sources.find((s: any) => s.key === "channel3")?.status === "budget_reached" && cb.offers.some((o: any) => o.retailer === "StockX") && !calls.some(c => c.includes("trychannel3")));
const c3NotCached = await pg.query("SELECT 1 FROM retailer_search_cache");
check("Channel3: incomplete comparison not cached", c3NotCached.rows.length === 0);

// ---- eBay Browse API in Compare ----
process.env.EBAY_CLIENT_ID = "app-id"; process.env.EBAY_CLIENT_SECRET = "cert-id"; process.env.EBAY_CAMPAIGN_ID = "5338000000";
await pg.query("DELETE FROM retailer_search_cache");
await pg.query("UPDATE retailer_api_usage_daily SET units_reserved = 0");
await pg.query("UPDATE provider_health SET consecutive_failures = 0, disabled_until = NULL").catch(() => {});
calls = [];
cr = await offersRoute.POST(offersReq()); cb = await cr.json();
const ebayOffers = cb.offers.filter((o: any) => o.source === "ebay");
check("eBay: signs in with Basic auth and the client-credentials grant", calls.some(c => c.startsWith("ebay-token:Basic ") && /grant_type=client_credentials/.test(c) && /api_scope/.test(c)), calls.find(c => c.startsWith("ebay-token")));
check("eBay: search asks for NEW, fixed-price only", calls.some(c => c.startsWith("ebay-search:") && /conditions:\{NEW\}/.test(c) && /buyingOptions:\{FIXED_PRICE\}/.test(c)), calls.find(c => c.startsWith("ebay-search")));
check("eBay: affiliate header sent when EBAY_CAMPAIGN_ID is set", calls.some(c => /affiliateCampaignId=5338000000/.test(c)));
check("eBay: only exact-product listings returned (no Military Blue, no Jordan 14)", ebayOffers.length === 2 && ebayOffers.every((o: any) => /Black Cat/.test(o.title) && !/\b14\b/.test(o.title)), JSON.stringify(ebayOffers.map((o: any) => o.title)));
check("eBay: cheapest first and affiliate link preferred", ebayOffers[0].price === 230 && ebayOffers.find((o: any) => o.price === 245).url.startsWith("https://rover.ebay.com"));
check("eBay: seller and independent-seller note shown", /sneakerhub/.test(ebayOffers.find((o: any) => o.price === 245).availabilityLabel) && /authenticity/.test(ebayOffers[0].availabilityLabel));
check("eBay: no duplicate eBay rows from Channel3", cb.offers.filter((o: any) => o.retailer === "eBay").every((o: any) => o.source === "ebay"));
check("eBay: 1 call reserved, status success", (await getProviderBudgetStatus("ebay"))!.dailyUsed === 1 && cb.sources.find((s: any) => s.key === "ebay")?.status === "success");
check("eBay: offers NOT saved to the normalized catalog", (await pg.query("SELECT 1 FROM retailer_offers WHERE source = 'ebay'")).rows.length === 0);
// budget exhausted
await pg.query("DELETE FROM retailer_search_cache"); await pg.query("UPDATE retailer_api_usage_daily SET units_reserved = 3000 WHERE provider='ebay'");
calls = [];
cr = await offersRoute.POST(offersReq()); cb = await cr.json();
check("eBay: exhausted budget -> budget_reached, no call, other offers kept", cb.sources.find((s: any) => s.key === "ebay")?.status === "budget_reached" && !calls.some(c => c.startsWith("ebay-search")) && cb.offers.some((o: any) => o.retailer === "StockX"));
delete process.env.EBAY_CLIENT_ID; delete process.env.EBAY_CLIENT_SECRET; delete process.env.EBAY_CAMPAIGN_ID;

// ---- light health check never touches the database ----
const health = await import("../app/api/health/route.ts");
const hr = await health.GET({ nextUrl: { searchParams: new URLSearchParams({ light: "1" }) } } as any);
const hb: any = await hr.json();
check("Health: ?light=1 returns config flags without a database query", hr.status === 200 && "databaseConfigured" in hb && hb.productSearchConfigured === true && hb.database === undefined, JSON.stringify(hb));

// ---- Impact partner catalogs in Compare ----
process.env.IMPACT_ACCOUNT_SID = "IRtest"; process.env.IMPACT_AUTH_TOKEN = "tok";
await pg.query("DELETE FROM retailer_search_cache");
await pg.query("UPDATE retailer_api_usage_daily SET units_reserved = 0");
await pg.query("UPDATE provider_health SET consecutive_failures = 0, disabled_until = NULL").catch(() => {});
calls = [];
cr = await offersRoute.POST(offersReq()); cb = await cr.json();
const impactCall = calls.find(c => c.startsWith("impact:/Mediapartners/IRtest/Catalogs/ItemSearch")) || "";
check("Impact: HTTP Basic auth and JSON accept header", /Basic /.test(impactCall) && /application\/json/.test(impactCall), impactCall.slice(0, 160));
check("Impact: Query ANDs 'contains' tests on model words incl. the model number", /Name~'black'[+ ]AND[+ ]/.test(impactCall) && /Name~'4'/.test(impactCall) && /PageSize=50/.test(impactCall), impactCall.slice(0, 200));
const impactOnly = cb.offers.filter((o: any) => o.source === "impact");
check("Impact: exact-product offers only (no Military Blue, no Jordan 14)", impactOnly.length === 2 && impactOnly.every((o: any) => /Black Cat/.test(o.title) && !/\b14\b/.test(o.title)), JSON.stringify(impactOnly.map((o: any) => o.retailer + ":" + o.price)));
check("Impact: advertiser names resolved from the catalog list", impactOnly.some((o: any) => o.retailer === "Foot Locker") && impactOnly.some((o: any) => o.retailer === "Finish Line"), JSON.stringify(impactOnly.map((o: any) => o.retailer)));
check("Impact: cheapest offer per store kept, tracking link used", impactOnly.filter((o: any) => o.retailer === "Foot Locker").length === 1 && impactOnly.find((o: any) => o.retailer === "Foot Locker").price === 219.99 && impactOnly.every((o: any) => /pxf\.io/.test(o.url)));
check("Impact: out-of-stock feed signal preserved", impactOnly.find((o: any) => o.retailer === "Finish Line").availability === "unavailable");
check("Impact: replaces Channel3's plain Foot Locker link but keeps Champs/Snipes", !cb.offers.some((o: any) => o.source === "channel3" && o.retailer === "Foot Locker") && cb.offers.some((o: any) => o.source === "channel3" && o.retailer === "Champs Sports"));
check("Impact: 1 call reserved, status success, affiliate offers saved to the catalog for 7 days", (await getProviderBudgetStatus("impact"))!.dailyUsed === 1 && cb.sources.find((s: any) => s.key === "impact")?.status === "success" && (await pg.query("SELECT 1 FROM retailer_offers WHERE source = 'impact' AND expires_at > NOW() + INTERVAL '6 days'")).rows.length >= 1);
// error (bad credentials): visible message, not cached
await pg.query("DELETE FROM retailer_search_cache"); (globalThis as any).__impactFail = true;
cr = await offersRoute.POST(offersReq()); cb = await cr.json();
const ie = cb.sources.find((s: any) => s.key === "impact");
check("Impact: bad credentials -> clear error status, other offers still shown", ie?.status === "error" && /401/.test(ie.message) && cb.offers.some((o: any) => o.retailer === "StockX"), ie?.message);
check("Impact: failed lookup is not cached", (await pg.query("SELECT 1 FROM retailer_search_cache")).rows.length === 0);
(globalThis as any).__impactFail = false;
await pg.query("UPDATE provider_health SET consecutive_failures = 0, disabled_until = NULL").catch(() => {});
await pg.query("UPDATE retailer_api_usage_daily SET units_reserved = 500 WHERE provider='impact'");
calls = [];
cr = await offersRoute.POST(offersReq()); cb = await cr.json();
check("Impact: exhausted budget -> budget_reached, no call", cb.sources.find((s: any) => s.key === "impact")?.status === "budget_reached" && !calls.some(c => c.startsWith("impact:")));
delete process.env.IMPACT_ACCOUNT_SID; delete process.env.IMPACT_AUTH_TOKEN;

// ---- Admin live connection test ----
process.env.EBAY_CLIENT_ID = "app-id"; process.env.EBAY_CLIENT_SECRET = "cert-id";
process.env.IMPACT_ACCOUNT_SID = "IRtest"; process.env.IMPACT_AUTH_TOKEN = "tok";
await pg.query("UPDATE retailer_api_usage_daily SET units_reserved = 0");
await pg.query("DELETE FROM retailer_search_cache");
const testRoute = await import("../app/api/admin/providers/test/route.ts");
const testReq = (auth?: string) => ({ headers: { get: (k: string) => k.toLowerCase() === "authorization" ? (auth ?? null) : null }, nextUrl: { searchParams: new URLSearchParams() } }) as any;
let tr = await testRoute.POST(testReq());
check("Self-test: rejects a missing secret", tr.status === 401);
tr = await testRoute.POST(testReq("Bearer wrong"));
check("Self-test: rejects a wrong secret", tr.status === 401);
calls = [];
tr = await testRoute.POST(testReq(`Bearer ${process.env.CRON_SECRET}`));
const tb: any = await tr.json();
const byProvider = Object.fromEntries(tb.results.map((r: any) => [r.provider, r]));
check("Self-test: every configured provider probed and OK", ["pckt", "serpapi", "apish", "channel3", "ebay", "impact"].every(k => byProvider[k]?.status === "ok"), JSON.stringify(tb.results.map((r: any) => r.provider + ":" + r.status)));
check("Self-test: SerpApi probe lists the merchants Google Shopping returned", byProvider.serpapi.retailers.includes("Foot Locker"), JSON.stringify(byProvider.serpapi.retailers));
check("Self-test: Channel3 and Impact probes list stores", byProvider.channel3.retailers.includes("Foot Locker") && byProvider.impact.retailers.includes("Foot Locker"), JSON.stringify([byProvider.channel3.retailers, byProvider.impact.retailers]));
check("Self-test: usage counters reflect the probes (PCKT 0.4, others 1)", Math.abs((await getProviderBudgetStatus("pckt"))!.dailyUsed - 0.4) < 1e-9 && (await getProviderBudgetStatus("serpapi"))!.dailyUsed === 1 && (await getProviderBudgetStatus("ebay"))!.dailyUsed === 1);
check("Self-test: no cache rows or catalog rows written", (await pg.query("SELECT 1 FROM retailer_search_cache")).rows.length === 0);
tr = await testRoute.POST(testReq(`Bearer ${process.env.CRON_SECRET}`));
check("Self-test: second immediate run is rate limited", tr.status === 429);
delete process.env.EBAY_CLIENT_ID; delete process.env.EBAY_CLIENT_SECRET; delete process.env.IMPACT_ACCOUNT_SID; delete process.env.IMPACT_AUTH_TOKEN;

// ---- Outbound click counts ----
const clickRoute = await import("../app/api/click/route.ts");
const clickReq = (body: unknown) => ({ json: async () => { if (body === "BAD") throw new Error("bad json"); return body; } }) as any;
const goodClick = { source: "impact", retailer: "Foot Locker", url: "https://footlocker.pxf.io/c/1/2/3?prodsku=AJ4&secret=abc", title: "Air Jordan 4 Retro Black Cat", brand: "Jordan" };
await pg.query("DELETE FROM offer_click_daily");
let cl = await clickRoute.POST(clickReq(goodClick));
await clickRoute.POST(clickReq(goodClick));
await clickRoute.POST(clickReq({ ...goodClick, retailer: "Champs Sports", source: "channel3", url: "https://www.champssports.com/p" }));
const clickRows = (await pg.query("SELECT retailer, host, clicks FROM offer_click_daily ORDER BY retailer")).rows as any[];
check("Click: always answers 204", cl.status === 204);
check("Click: repeated clicks increment one row", clickRows.find(r => r.retailer === "Foot Locker")?.clicks === 2 && clickRows.length === 2, JSON.stringify(clickRows));
check("Click: stores only the host, never the full URL or query string", clickRows.find(r => r.retailer === "Foot Locker")?.host === "footlocker.pxf.io" && !JSON.stringify((await pg.query("SELECT * FROM offer_click_daily")).rows).includes("secret"));
for (const bad of [{ ...goodClick, source: "evil" }, { ...goodClick, url: "javascript:alert(1)" }, { ...goodClick, url: "not a url" }, { ...goodClick, title: "" }, "BAD", null]) {
  const r = await clickRoute.POST(clickReq(bad)); if (r.status !== 204) check("Click: invalid input still 204", false);
}
check("Click: invalid input (unknown source, non-http URL, empty title, bad JSON) records nothing", ((await pg.query("SELECT COUNT(*)::int AS n FROM offer_click_daily")).rows[0] as any).n === 2);
await pg.query("INSERT INTO offer_click_daily (source, retailer, host, product_title) SELECT 'ebay','eBay','ebay.com','filler ' || g FROM generate_series(1, 5000) g");
await clickRoute.POST(clickReq({ ...goodClick, title: "Brand new spam title" }));
await clickRoute.POST(clickReq(goodClick));
const capped = (await pg.query("SELECT (SELECT COUNT(*)::int FROM offer_click_daily WHERE product_title = 'Brand new spam title') AS spam, (SELECT clicks FROM offer_click_daily WHERE retailer='Foot Locker') AS fl")).rows[0] as any;
check("Click: daily row cap blocks new rows but still counts existing ones", capped.spam === 0 && capped.fl === 3, JSON.stringify(capped));
await pg.query("DELETE FROM offer_click_daily WHERE product_title LIKE 'filler %'");
const adminRoute = await import("../app/api/admin/providers/route.ts");
const ar = await adminRoute.GET({ headers: { get: (k: string) => k.toLowerCase() === "authorization" ? `Bearer ${process.env.CRON_SECRET}` : null }, nextUrl: { searchParams: new URLSearchParams() } } as any);
const ab: any = await ar.json();
check("Click: admin report lists top stores and products", ab.clicks?.available === true && ab.clicks.byStore[0].retailer === "Foot Locker" && ab.clicks.byStore[0].clicks === 3 && ab.clicks.total === 4 && ab.clicks.byProduct[0].title === "Air Jordan 4 Retro Black Cat", JSON.stringify(ab.clicks));

// ---- Affiliate link templates ----
const aff = await import("../lib/affiliate-links.ts");
process.env.AFFILIATE_LINK_TEMPLATES = JSON.stringify({
  "stockx.com": "https://stockx.sjv.io/c/111/222/333?u={url}",
  "www.footlocker.com": "https://www.awin1.com/cread.php?awinmid=1&awinaffid=2&ued={url}",
  "shop.footlocker.com": "https://specific.example.com/go?to={rawurl}",
  "insecure.com": "http://track.example.com/?u={url}",
  "notemplate.com": "https://track.example.com/no-placeholder",
  "": "https://x.example.com/?u={url}",
});
const w1 = aff.wrapAffiliateUrl("https://stockx.com/air-jordan-4?size=10&x=1");
check("Affiliate: URL is encoded into the template", w1 === "https://stockx.sjv.io/c/111/222/333?u=" + encodeURIComponent("https://stockx.com/air-jordan-4?size=10&x=1"), w1 ?? "null");
check("Affiliate: host match ignores www and covers subdomains", aff.wrapAffiliateUrl("https://www.stockx.com/a")?.startsWith("https://stockx.sjv.io") === true && aff.wrapAffiliateUrl("https://m.footlocker.com/p/1")?.startsWith("https://www.awin1.com") === true);
check("Affiliate: most specific host wins and {rawurl} is unencoded", aff.wrapAffiliateUrl("https://shop.footlocker.com/p/1") === "https://specific.example.com/go?to=https://shop.footlocker.com/p/1");
check("Affiliate: unlisted hosts and look-alike hosts are untouched", aff.wrapAffiliateUrl("https://goat.com/a") === null && aff.wrapAffiliateUrl("https://notstockx.com/a") === null && aff.wrapAffiliateUrl("https://stockx.com.evil.com/a") === null);
check("Affiliate: http templates, templates without {url}, empty hosts are ignored", aff.wrapAffiliateUrl("https://insecure.com/a") === null && aff.wrapAffiliateUrl("https://notemplate.com/a") === null && aff.affiliateTemplatesConfigured() === 3, String(aff.affiliateTemplatesConfigured()));
check("Affiliate: non-http(s) links are never wrapped", aff.wrapAffiliateUrl("javascript:alert(1)") === null && aff.wrapAffiliateUrl("not a url") === null);
const mixed = aff.applyAffiliateLinks([{ url: "https://stockx.com/a" }, { url: "https://stockx.com/b", affiliate: true }, { url: "https://goat.com/c" }] as any[]);
check("Affiliate: already-affiliate offers are left alone, plain ones flagged", mixed[0].affiliate === true && mixed[1].url === "https://stockx.com/b" && mixed[2].url === "https://goat.com/c" && mixed[2].affiliate === undefined);
await pg.query("DELETE FROM retailer_search_cache"); await pg.query("UPDATE retailer_api_usage_daily SET units_reserved = 0");
cr = await offersRoute.POST(offersReq()); cb = await cr.json();
const stockxOffer = cb.offers.find((o: any) => o.source === "stockx");
check("Affiliate: fresh Compare returns a wrapped StockX link flagged affiliate", stockxOffer?.affiliate === true && stockxOffer.url.startsWith("https://stockx.sjv.io/"), stockxOffer?.url);
check("Affiliate: Channel3 Foot Locker offer is wrapped too", cb.offers.some((o: any) => o.retailer === "Foot Locker" && o.affiliate === true && o.url.startsWith("https://www.awin1.com/")));
const stored = JSON.stringify((await pg.query("SELECT results_json FROM retailer_search_cache")).rows);
check("Affiliate: the cache keeps plain store URLs (wrapping happens on the way out)", !/sjv\.io|awin1\.com/.test(stored) && /stockx\.com/.test(stored));
cr = await offersRoute.POST(offersReq()); cb = await cr.json();
check("Affiliate: cached Compare is wrapped as well", cb.cached === true && cb.offers.find((o: any) => o.source === "stockx")?.url.startsWith("https://stockx.sjv.io/"));
delete process.env.AFFILIATE_LINK_TEMPLATES;
cr = await offersRoute.POST(offersReq()); cb = await cr.json();
check("Affiliate: removing the variable restores plain links immediately", cb.offers.find((o: any) => o.source === "stockx")?.url === "https://stockx.com/aj4" && !cb.offers.some((o: any) => o.affiliate === true && o.source === "stockx"));

// ---- Bulk feed ingestion (Impact) ----
process.env.IMPACT_ACCOUNT_SID = "IRtest"; process.env.IMPACT_AUTH_TOKEN = "tok";
const feed = await import("../lib/feed-ingest.ts");
await pg.query("DELETE FROM retailer_search_cache"); await pg.exec("DELETE FROM retailer_offer_sizes; DELETE FROM retailer_offers; DELETE FROM canonical_products; DELETE FROM feed_ingest_state");
await pg.query("UPDATE retailer_api_usage_daily SET units_reserved = 0");
await pg.query("UPDATE provider_health SET consecutive_failures = 0, disabled_until = NULL").catch(() => {});
delete process.env.FEED_INGEST_ENABLED; process.env.IMPACT_FEED_CATALOG_IDS = "42";
let fr = await feed.runFeedIngest({ maxPages: 1 });
check("Feed: disabled by default (no env flag) -> nothing runs", fr.ran === false && fr.skipped === "disabled" && (await pg.query("SELECT 1 FROM canonical_products")).rows.length === 0);
process.env.FEED_INGEST_ENABLED = "true";
calls = [];
fr = await feed.runFeedIngest({ maxPages: 1 });
check("Feed: page 1 read; only footwear with a brand kept; variants collapsed to one product", fr.ran && fr.pages === 1 && fr.items === 6 && fr.kept === 1 && fr.products === 1, JSON.stringify({ pages: fr.pages, items: fr.items, kept: fr.kept, products: fr.products }));
const feedCall = calls.find(c => c.startsWith("impact:") && /Catalogs\/42\/Items/.test(c)) || "";
check("Feed: requests the selected catalog page with PageSize", /Page=1/.test(feedCall) && /PageSize=250/.test(feedCall), feedCall.slice(0, 120));
const prod = (await pg.query("SELECT cp.product_title, cp.brand_name, cp.style_code, ro.retailer_name, ro.price, ro.source, ro.expires_at - ro.last_seen_at AS ttl FROM canonical_products cp JOIN retailer_offers ro ON ro.product_id = cp.id")).rows as any[];
check("Feed: Samba saved with advertiser name, cheapest variant price, style code", prod.length === 1 && prod[0].product_title === "adidas Samba OG Shoes" && prod[0].retailer_name === "Foot Locker" && Number(prod[0].price) === 95 && prod[0].style_code === "IE3437" && prod[0].source === "impact", JSON.stringify(prod[0]));
const ttlDays = Number(String(prod[0].ttl).match(/(\d+) days?/)?.[1] ?? 0);
check("Feed: offers kept for 7 days (not the usual 24 hours)", ttlDays >= 6.9 && ttlDays <= 7.1, JSON.stringify(prod[0].ttl));
const sizes = (await pg.query("SELECT s.size_label FROM retailer_offer_sizes s ORDER BY 1")).rows.map((r: any) => r.size_label);
check("Feed: only in-stock variant sizes saved (size 11 sold out is skipped)", JSON.stringify(sizes) === JSON.stringify(["10", "8", "9"]), JSON.stringify(sizes));
let fst = (await pg.query("SELECT next_page, num_pages, items_seen, cycles, advertiser_name FROM feed_ingest_state")).rows[0] as any;
check("Feed: cursor advances to page 2 of 2", fst.next_page === 2 && fst.num_pages === 2 && Number(fst.items_seen) === 6 && fst.cycles === 0 && fst.advertiser_name === "Foot Locker", JSON.stringify(fst));
fr = await feed.runFeedIngest({ maxPages: 1 });
fst = (await pg.query("SELECT next_page, items_seen, cycles FROM feed_ingest_state")).rows[0] as any;
const gaz = (await pg.query("SELECT ro.price, ro.original_price FROM retailer_offers ro JOIN canonical_products cp ON cp.id = ro.product_id WHERE cp.product_title LIKE '%Gazelle%'")).rows as any[];
check("Feed: page 2 read, discount captured, fully sold-out product skipped, cursor wraps to page 1", gaz.length === 1 && Number(gaz[0].price) === 90 && Number(gaz[0].original_price) === 120 && fst.next_page === 1 && fst.cycles === 1 && !(await pg.query("SELECT 1 FROM canonical_products WHERE product_title LIKE '%Sold Out%'")).rows.length, JSON.stringify(fst));
check("Feed: each page cost 1 Impact budget unit", (await getProviderBudgetStatus("impact"))!.dailyUsed === 2);
// re-run is idempotent
const offersBefore = (await pg.query("SELECT COUNT(*)::int AS n FROM retailer_offers")).rows[0] as any;
await feed.runFeedIngest({ maxPages: 1 }); await feed.runFeedIngest({ maxPages: 1 });
check("Feed: re-reading the same pages does not duplicate offers", ((await pg.query("SELECT COUNT(*)::int AS n FROM retailer_offers")).rows[0] as any).n === offersBefore.n);
// browse sees the ingested products with no live call
calls = [];
r = await discoverCatalog(q({ category: "sneakers", brand: "adidas", q: "Samba" }));
const sambaListings = ((r.body as any).products as any[]).flatMap(p => p.listings.map((l: any) => l.source + ":" + l.retailer));
check("Feed: catalog browse for adidas Samba returns the ingested product from the shared catalog", (r.body as any).cacheSource === "normalized_catalog" && sambaListings.includes("impact:Foot Locker"), JSON.stringify(sambaListings));
// storage guard
process.env.FEED_MAX_DB_MB = "0.001";
fr = await feed.runFeedIngest({ maxPages: 1 });
check("Feed: storage guard stops ingestion when the database is too large", fr.ran === false && fr.skipped === "storage_limit", JSON.stringify(fr.skipped));
delete process.env.FEED_MAX_DB_MB;
// pruning
await pg.query("UPDATE retailer_offers SET expires_at = NOW() - INTERVAL '5 days' WHERE source = 'impact'");
await feed.runFeedIngest({ maxPages: 1 });
check("Feed: offers expired for more than 3 days are pruned", ((await pg.query("SELECT COUNT(*)::int AS n FROM retailer_offers WHERE source='impact' AND expires_at < NOW() - INTERVAL '3 days'")).rows[0] as any).n === 0);
// budget exhausted
await pg.query("UPDATE retailer_api_usage_daily SET units_reserved = 500 WHERE provider='impact'");
fr = await feed.runFeedIngest({ maxPages: 1 });
check("Feed: budget exhausted -> no request, reported", fr.pages === 0 && fr.catalogs[0]?.error === "Impact safety budget reached");
await pg.query("UPDATE retailer_api_usage_daily SET units_reserved = 0");
// preview (writes nothing)
const before2 = ((await pg.query("SELECT COUNT(*)::int AS n FROM retailer_offers")).rows[0] as any).n;
const pv = await feed.previewFeeds();
check("Feed preview: lists catalogs, marks the selected one, reports item filter results", pv.catalogs.length === 3 && pv.catalogs.find(c => c.id === "42")?.selected === true && pv.sample?.items === 6 && pv.sample.matched === 5 && pv.sample.products === 1 && pv.sample.fields.includes("Name"), JSON.stringify(pv.sample));
check("Feed preview: writes nothing", ((await pg.query("SELECT COUNT(*)::int AS n FROM retailer_offers")).rows[0] as any).n === before2);
// route integration
await pg.query("UPDATE feed_ingest_state SET next_page = 1");
const ingestRoute = await import("../app/api/cron/ingest-feeds/route.ts");
const ir = await ingestRoute.GET({ headers: { get: (k: string) => k.toLowerCase() === "authorization" ? `Bearer ${process.env.CRON_SECRET}` : null }, nextUrl: { searchParams: new URLSearchParams({ pages: "2" }) } } as any);
const ib: any = await ir.json();
check("Feed route: authorized manual run ingests the requested pages", ir.status === 200 && ib.pages === 2, JSON.stringify({ pages: ib.pages, skipped: ib.skipped }));
const ir2 = await ingestRoute.GET({ headers: { get: () => null }, nextUrl: { searchParams: new URLSearchParams() } } as any);
check("Feed route: rejects a missing secret", ir2.status === 401);
await pg.query("UPDATE retailer_api_usage_daily SET units_reserved = 0"); await pg.query("DELETE FROM retailer_search_cache"); await pg.query("DELETE FROM catalog_refresh_queue");
const warmR = await route.GET(fakeReq(`Bearer ${process.env.CRON_SECRET}`, "1"));
const warmB: any = await warmR.json();
check("Warm-up route also runs a feed batch when ingestion is enabled", warmR.status === 200 && warmB.feed && warmB.feed.ran === true, JSON.stringify(warmB.feed));
const adminFeed = await adminRoute.GET({ headers: { get: (k: string) => k.toLowerCase() === "authorization" ? `Bearer ${process.env.CRON_SECRET}` : null }, nextUrl: { searchParams: new URLSearchParams() } } as any);
const afb: any = await adminFeed.json();
check("Feed: admin report shows enabled state, catalogs and stored offer count", afb.feedIngest?.enabled === true && afb.feedIngest.tableAvailable === true && afb.feedIngest.rows[0]?.catalogId === "42" && afb.feedIngest.impactOffers >= 1, JSON.stringify(afb.feedIngest).slice(0, 200));
delete process.env.FEED_INGEST_ENABLED; delete process.env.IMPACT_FEED_CATALOG_IDS; delete process.env.IMPACT_ACCOUNT_SID; delete process.env.IMPACT_AUTH_TOKEN;

// ---- v3.4: CDN cache headers, search demand, demand-driven warm-up ----
const { urlQuery } = await import("../lib/query-normalize.ts");
check("urlQuery: AJ1 / aj 1 / Air Jordan 1 share one URL form", urlQuery("AJ1") === "air jordan 1" && urlQuery("aj 1") === "air jordan 1" && urlQuery("  Air   JORDAN 1 ") === "air jordan 1", urlQuery("AJ1"));
const catalogRoute = await import("../app/api/catalog/route.ts");
const catReq = (o: Record<string, string>) => ({ headers: { get: () => null }, nextUrl: { searchParams: new URLSearchParams(o) } }) as any;
await pg.query("DELETE FROM retailer_search_cache"); await pg.query("UPDATE retailer_api_usage_daily SET units_reserved = 0");
await pg.query("UPDATE provider_health SET consecutive_failures = 0, disabled_until = NULL").catch(() => {});
delete process.env.CATALOG_CDN_SECONDS;
let cres = await catalogRoute.GET(catReq({ category: "sneakers", brand: "jordan", q: "air jordan 4" }));
check("CDN: a complete answer is cacheable for 10 minutes with stale-while-revalidate", cres.status === 200 && cres.headers.get("cache-control") === "public, max-age=0, s-maxage=600, stale-while-revalidate=3600", cres.headers.get("cache-control") ?? "");
cres = await catalogRoute.GET(catReq({ category: "sneakers", brand: "jordan", q: "air jordan 4" }));
check("CDN: a cached (exact-cache) answer is cacheable too", cres.headers.get("cache-control")?.includes("s-maxage=600"));
await pg.query("UPDATE retailer_api_usage_daily SET units_reserved = 15 WHERE provider = 'pckt'");
await pg.query("INSERT INTO retailer_api_usage_daily (provider, usage_day, units_reserved) VALUES ('serpapi', CURRENT_DATE, 7), ('apish', CURRENT_DATE, 25) ON CONFLICT (provider, usage_day) DO UPDATE SET units_reserved = EXCLUDED.units_reserved");
cres = await catalogRoute.GET(catReq({ category: "sneakers", brand: "jordan", q: "air jordan 12" }));
const cbody: any = await cres.json();
check("CDN: an incomplete answer (budget used up) is cached for only 30 seconds", cbody.incomplete === true && cres.headers.get("cache-control") === "public, max-age=0, s-maxage=30, stale-while-revalidate=60", cres.headers.get("cache-control") ?? "");
cres = await catalogRoute.GET(catReq({ category: "sneakers", brand: "jordan", q: "x" }));
check("CDN: errors are never cached", cres.status === 400 && cres.headers.get("cache-control") === "no-store");
process.env.CATALOG_CDN_SECONDS = "0";
cres = await catalogRoute.GET(catReq({ category: "sneakers", brand: "jordan", q: "air jordan 4" }));
check("CDN: CATALOG_CDN_SECONDS=0 turns edge caching off", cres.headers.get("cache-control") === "no-store");
process.env.CATALOG_CDN_SECONDS = "120";
cres = await catalogRoute.GET(catReq({ category: "sneakers", brand: "jordan", q: "air jordan 4" }));
check("CDN: the lifetime is configurable", cres.headers.get("cache-control") === "public, max-age=0, s-maxage=120, stale-while-revalidate=720", cres.headers.get("cache-control") ?? "");
delete process.env.CATALOG_CDN_SECONDS;
await pg.query("UPDATE retailer_api_usage_daily SET units_reserved = 0");

const logRoute = await import("../app/api/search-log/route.ts");
const logReq = (body: unknown) => ({ json: async () => { if (body === "BAD") throw new Error("bad json"); return body; } }) as any;
await pg.query("DELETE FROM search_demand_daily");
const base = { q: "AJ1", category: "sneakers", brand: "jordan", gender: "all", releaseYear: "", results: 12 };
let lr = await logRoute.POST(logReq(base));
await logRoute.POST(logReq({ ...base, q: "air jordan 1", results: 0 }));
await logRoute.POST(logReq({ ...base, q: "  Air   Jordan 1 ", results: 5 }));
const demandRows = (await pg.query("SELECT query_text, searches, empty_results FROM search_demand_daily")).rows as any[];
check("Demand: always 204; equivalent searches (AJ1, air jordan 1) share one row and count up", lr.status === 204 && demandRows.length === 1 && demandRows[0].query_text === "air jordan 1" && demandRows[0].searches === 3 && demandRows[0].empty_results === 1, JSON.stringify(demandRows));
for (const bad of [{ ...base, category: "evil" }, { ...base, gender: "robots" }, { ...base, brand: "a;drop" }, { ...base, releaseYear: "20x4" }, { ...base, q: "x" }, { ...base, q: "me@example.com" }, { ...base, q: "call 555 123 4567" }, { ...base, results: "NaN" }, "BAD", null]) {
  const r = await logRoute.POST(logReq(bad)); if (r.status !== 204) check("Demand: invalid input still 204", false);
}
check("Demand: invalid input, e-mail-like and phone-like text record nothing", ((await pg.query("SELECT COUNT(*)::int AS n FROM search_demand_daily")).rows[0] as any).n === 1);
await pg.query("INSERT INTO search_demand_daily (category, brand, gender, release_year, query_text) SELECT 'sneakers','nike','all',0,'filler ' || g FROM generate_series(1, 5000) g");
await logRoute.POST(logReq({ ...base, q: "brand new spam search" }));
await logRoute.POST(logReq(base));
const capped2 = (await pg.query("SELECT (SELECT COUNT(*)::int FROM search_demand_daily WHERE query_text = 'brand new spam search') AS spam, (SELECT searches FROM search_demand_daily WHERE query_text = 'air jordan 1') AS aj")).rows[0] as any;
check("Demand: daily row cap blocks new rows but existing rows still count", capped2.spam === 0 && capped2.aj === 4, JSON.stringify(capped2));
await pg.query("DELETE FROM search_demand_daily WHERE query_text LIKE 'filler %'");
const adminForDemand = await adminRoute.GET({ headers: { get: (k: string) => k.toLowerCase() === "authorization" ? `Bearer ${process.env.CRON_SECRET}` : null }, nextUrl: { searchParams: new URLSearchParams() } } as any);
const adb: any = await adminForDemand.json();
check("Demand: admin report lists top searches and searches that found nothing", adb.demand?.available === true && adb.demand.top[0]?.query === "air jordan 1" && adb.demand.top[0].searches === 4 && adb.demand.empty[0]?.query === "air jordan 1", JSON.stringify(adb.demand).slice(0, 200));

// warm-up refreshes the most-searched filters first
await pg.query("DELETE FROM search_demand_daily"); await pg.query("DELETE FROM retailer_search_cache"); await pg.query("DELETE FROM catalog_refresh_queue");
await pg.query("UPDATE retailer_api_usage_daily SET units_reserved = 0");
await pg.query("INSERT INTO search_demand_daily (category, brand, gender, release_year, query_text, searches) VALUES ('sneakers','yeezy','all',0,'yeezy slide',9), ('sneakers','yeezy','all',0,'yeezy 350',5), ('sneakers','puma','all',0,'speedcat',1)");
await pg.query("INSERT INTO search_demand_daily (search_day, category, brand, gender, release_year, query_text, searches) VALUES (CURRENT_DATE - 61, 'sneakers','nike','all',0,'old search',50)");
const warmDemand = await route.GET(fakeReq(`Bearer ${process.env.CRON_SECRET}`, "2"));
const wdb: any = await warmDemand.json();
const demandJobs = wdb.results.filter((x: any) => x.source === "demand");
check("Warm-up: the most-searched filters are refreshed first, in order of demand", demandJobs.length === 2 && demandJobs[0].query === "yeezy slide" && demandJobs[1].query === "yeezy 350", JSON.stringify(wdb.results.map((x: any) => x.source + ":" + x.query)));
check("Warm-up: a search made only once (below WARM_MIN_SEARCHES) is not refreshed", !wdb.results.some((x: any) => x.query === "speedcat"));
check("Warm-up: demand searches were answered and cached", demandJobs.every((x: any) => x.outcome === "refreshed") && ((await pg.query("SELECT COUNT(*)::int AS n FROM retailer_search_cache WHERE query_text LIKE 'catalog:%yeezy%'")).rows[0] as any).n >= 2);
check("Warm-up: demand rows older than 60 days are pruned", ((await pg.query("SELECT COUNT(*)::int AS n FROM search_demand_daily WHERE query_text = 'old search'")).rows[0] as any).n === 0);
await pg.query("UPDATE retailer_api_usage_daily SET units_reserved = 0"); await pg.query("DELETE FROM search_demand_daily");

// ---- v3.6: per-connection fresh-lookup limit ----
const live = await import("../lib/live-limit.ts");
await pg.query("DELETE FROM retailer_search_cache"); await pg.query("DELETE FROM catalog_refresh_queue"); await pg.query("UPDATE retailer_api_usage_daily SET units_reserved = 0");
await pg.query("UPDATE provider_health SET consecutive_failures = 0, disabled_until = NULL").catch(() => {});
await pg.exec("DELETE FROM retailer_offer_sizes; DELETE FROM retailer_offers; DELETE FROM canonical_products");
const { persistCatalogSnapshot: persistForLimit } = await import("../lib/catalog-store.ts");
await persistForLimit([{ id: "l1", title: "Air Jordan 4 Retro Black Cat", brand: "Jordan", category: "sneakers", styleCode: "CU1110-010", sources: ["StockX"], listings: [{ source: "stockx", retailer: "StockX", title: "Air Jordan 4 Retro Black Cat", url: "https://stockx.com/l1", price: 300, currency: "USD" }], gender: "Men" }] as any);
calls = [];
let askCount = 0;
r = await discoverCatalog(q({ category: "sneakers", brand: "jordan", q: "Air Jordan 12" }), { mode: "user", liveLookup: () => { askCount++; return false; } });
check("Limit: a limited connection triggers no provider call and no budget spend", !calls.some(c => /pckt|serpapi|api\.sh|trychannel3/.test(c)) && (await getProviderBudgetStatus("pckt"))!.dailyUsed === 0, calls.join(" | "));
check("Limit: the connection is asked once per search, however many sources there are", askCount === 1, String(askCount));
check("Limit: still answered with the closest saved products, flagged limited and queued", (r.body as any).limited === true && (r.body as any).approximate === true && (r.body as any).products.length >= 1 && (r.body as any).queued === true, (r.body as any).notice);
check("Limit: the notice explains it honestly (many fresh lookups, not 'allowance used up')", /many fresh lookups in the last hour/.test((r.body as any).notice) && !/allowance is used up/.test((r.body as any).notice), (r.body as any).notice);
check("Limit: source messages say paused, not budget exhausted", (r.body as any).sources.filter((s: any) => s.status === "budget_reached").every((s: any) => /paused/.test(s.message)));
check("Limit: a limited answer is not cached for 12 hours", (await pg.query("SELECT 1 FROM retailer_search_cache WHERE query_text LIKE '%air jordan 12%'")).rows.length === 0);
calls = []; askCount = 0;
r = await discoverCatalog(q({ category: "sneakers", brand: "jordan", q: "Air Jordan 9" }), { mode: "user", liveLookup: () => { askCount++; return true; } });
check("Limit: an allowed connection searches normally (live providers used)", (r.body as any).limited === false && calls.some(c => /pckt/.test(c)) && askCount === 1);
calls = [];
r = await discoverCatalog(q({ category: "sneakers", brand: "jordan", q: "Air Jordan 4" }), { mode: "user", liveLookup: () => { askCount++; return false; } });
check("Limit: searches answered from cache or the saved catalog never ask for a fresh lookup", calls.length === 0 && (r.body as any).limited !== true && (r.body as any).cached === true && askCount === 1, JSON.stringify({ calls, askCount }));

// route level: shared client address, two connections
process.env.LIVE_LOOKUPS_PER_HOUR = "2"; live.resetLiveLimits();
await pg.query("DELETE FROM retailer_search_cache"); await pg.query("UPDATE retailer_api_usage_daily SET units_reserved = 0");
const limReq = (query: string, ip: string) => ({ headers: { get: (k: string) => k.toLowerCase() === "x-forwarded-for" ? ip : null }, nextUrl: { searchParams: new URLSearchParams({ category: "sneakers", brand: "jordan", q: query }) } }) as any;
const flags: boolean[] = [];
for (const query of ["air jordan 5", "air jordan 6", "air jordan 7"]) { const resp = await catalogRoute.GET(limReq(query, "198.51.100.9")); flags.push(((await resp.json()) as any).limited === true); }
check("Limit (route): the third fresh lookup from one address in an hour is limited", JSON.stringify(flags) === JSON.stringify([false, false, true]), JSON.stringify(flags));
const otherResp = await catalogRoute.GET(limReq("air jordan 8", "198.51.100.77"));
check("Limit (route): a different address is unaffected", ((await otherResp.json()) as any).limited === false);
const limitedHeaders = await catalogRoute.GET(limReq("air jordan 3", "198.51.100.9"));
check("Limit (route): a limited answer is edge-cached for only 30 seconds", limitedHeaders.headers.get("cache-control") === "public, max-age=0, s-maxage=30, stale-while-revalidate=60", limitedHeaders.headers.get("cache-control") ?? "");
delete process.env.LIVE_LOOKUPS_PER_HOUR; live.resetLiveLimits();
await pg.query("UPDATE retailer_api_usage_daily SET units_reserved = 0"); await pg.query("DELETE FROM retailer_search_cache");

// S7 strict token matching regression: model 1 must not match model 14
await pg.query("DELETE FROM canonical_products");
const { persistCatalogSnapshot } = await import("../lib/catalog-store.ts");
const mk = (id: string, title: string, style: string) => ({ id, title, brand: "Jordan", category: "sneakers", styleCode: style, sources: ["StockX"], listings: [{ source: "stockx", retailer: "StockX", title, url: `https://stockx.com/${id}`, price: 200, currency: "USD" }], gender: "Men" });
await persistCatalogSnapshot([mk("a", "Air Jordan 1 Retro High OG", "555088-001"), mk("b", "Air Jordan 14 Retro", "487471-001")] as any);
const strict = await discoverCatalog(q({ category: "sneakers", brand: "jordan", q: "Air Jordan 1" }));
const titles = ((strict.body as any).products as any[]).map((p) => p.title);
check("S7 strict match: 'Air Jordan 1' excludes 'Air Jordan 14'", titles.length === 1 && /Jordan 1 /.test(titles[0]), JSON.stringify(titles));

globalThis.fetch = realFetch;
console.log(failures ? `\n${failures} FAILURE(S)` : "\nALL CHECKS PASSED");
process.exit(failures ? 1 : 0);
