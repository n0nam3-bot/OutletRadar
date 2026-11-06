# Running Outlet Radar on free tiers

Outlet Radar is designed to keep working on free plans of Vercel, Neon, PCKT and SerpApi. This guide explains the limits, how the app stays useful when they are reached, and how to tune it.

## The limits that matter

| Service | Free allowance (verify in your dashboard) | How Outlet Radar uses it |
|---|---|---|
| PCKT | 500 credits/month, 1 request/second | App ceiling 450/month and 15/day. StockX 0.4, GOAT 0.3, Flight Club 1.0, Kicks Crew 0.5 per search. |
| SerpApi | 250 searches/month | App ceiling 200/month and 7/day. One search per uncached query. |
| API.SH | Plan-dependent | App ceiling 1,000/month and 25/day. One request per uncached Nike or Jordan search (Nike.com listings), plus the legacy Nike features. |
| Channel3 | 1,000 credits/month (verify in your dashboard) | App ceiling 900/month and 30/day. One search per Compare offers click, cached 3 hours. |
| Impact partner API | No published fixed quota (verify in your account) | App ceiling 500/day and 15,000/month. One search per Compare offers click, cached 3 hours. |
| eBay Browse API | 5,000 calls/day by default (verify in your developer account) | App ceiling 3,000/day. One search per Compare offers click, cached 3 hours. |
| Vercel Hobby | Cron jobs run at most once per day, within the scheduled hour | Two daily crons: price check and catalog warm-up. |
| Neon Free | 0.5 GB storage and 100 compute-hours per project per month; compute is free only while it scales to zero | Everything is cached in Neon; keep it idle when possible. |

Allowances change; the app's ceilings are *safety margins under* them, not copies of them. Hobby is intended for non-commercial use: review Vercel's and each provider's terms before monetizing the site.

## How a search is answered

1. **Exact-query cache** (12 h) in `retailer_search_cache`.
2. **Shared catalog** in `canonical_products` / `retailer_offers`: anything any visitor already discovered. Every query word must match, and model numbers match exactly (`Jordan 1` never matches `Jordan 14`).
3. **Provider snapshots** (24 h per PCKT source, 12 h for Nike.com, 6 h for Google Shopping), reused across audience and year filters.
4. **Live providers**, only if the daily/monthly budget allows and the source is not paused after repeated errors.
5. **Fallbacks if a source cannot be queried:** its expired snapshot (up to 30 days old) labelled *stale*; if nothing matches at all, a saved copy of the exact search; then the closest saved products. The page shows a notice explaining what the visitor is seeing.

An incomplete answer is **never** written to the 12-hour cache, and the search is added to the refresh queue.

### Keeping browse cheap
- StockX and GOAT (0.7 credits) always run on a browse. Flight Club and Kicks Crew (1.5 combined) run only while at least half of today's PCKT allowance remains. Skipped sources are added later by the warm-up job.
- Shorthand (`aj1`, `af1`, `am90`, `nb`, `dunks`, `yeezys`...) is expanded before caching, so equivalent searches cost one lookup. Extend the list in `lib/query-normalize.ts`.
- Size, color, price, audience and sale refinements are applied locally and never spend credits.

## Other stores and brands: what is available

Most brands (adidas, New Balance, Puma, Converse, Reebok, Vans) publish no free public product API, and scraping their sites breaks their terms. The legitimate routes are:

- **Channel3** (built in): one API that matches a product to offers at many stores and brand sites. It is used only when someone presses **Compare offers**, so it costs one credit per comparison, and results are cached for 3 hours because its terms ask that offer data not be stored longer.
- **Google Shopping via SerpApi** (built in): returns whichever merchants Google lists for a query.
- **Impact partner catalogs** (built in): searches the product catalogs of every brand and store that has approved your Impact account, with your affiliate tracking links. Join more programs in Impact (adidas, New Balance, Puma, Reebok, Vans, Converse...) to widen coverage. Other networks (Rakuten, CJ, Awin) are not built in yet.
- **eBay Browse API** (built in): new fixed-price eBay listings in Compare, with a large free daily quota. Used live only; eBay's license terms limit how long its data may be kept.

Use `/admin/providers` → **Retailer coverage** to see which stores have actually appeared in results.

## Scheduled warm-up

`/api/cron/warm-catalog` runs daily (05:47 UTC in `vercel.json`, ~1 a.m. US Eastern). It:
1. completes searches from the refresh queue, most requested first (up to 3 per run, 6 attempts each, at least 3 hours between attempts);
2. if capacity remains, refreshes the popular searches listed in `lib/warm-seeds.ts` whose cache has expired;
3. uses at most `WARM_DAILY_SHARE` (default 40%) of each provider's daily budget, so visitors keep the rest of the day's allowance.

Edit `lib/warm-seeds.ts` to match what your visitors actually search. Each seed costs up to 2.2 PCKT credits plus one SerpApi search when its cache has expired.

### Running the warm-up more often
Vercel Hobby cannot run a cron more than once a day. GitHub Actions can, for free:

1. In the GitHub repository: **Settings → Secrets and variables → Actions**, add `SITE_URL` (for example `https://outlet-radar.vercel.app`, no trailing slash) and `CRON_SECRET` (the same value as in Vercel).
2. Create `.github/workflows/warm-catalog.yml` with the contents of [`examples/github-actions-warm-catalog.yml`](./examples/github-actions-warm-catalog.yml). It must be added by hand because the ZIP updater never writes to `.github/`.

Each run only spends what is left of the warm-up's daily share, so extra runs cannot exceed it.

## Tuning

All optional; set them in Vercel → Settings → Environment Variables.

| Variable | Default | Purpose |
|---|---|---|
| `PCKT_DAILY_BUDGET` / `PCKT_MONTHLY_BUDGET` | 15 / 450 | Credits |
| `SERPAPI_DAILY_BUDGET` / `SERPAPI_MONTHLY_BUDGET` | 7 / 200 | Searches |
| `APISH_DAILY_BUDGET` / `APISH_MONTHLY_BUDGET` | 25 / 1000 | Requests |
| `CHANNEL3_DAILY_BUDGET` / `CHANNEL3_MONTHLY_BUDGET` | 30 / 900 | Searches |
| `EBAY_DAILY_BUDGET` / `EBAY_MONTHLY_BUDGET` | 3000 / 90000 | Calls |
| `IMPACT_DAILY_BUDGET` / `IMPACT_MONTHLY_BUDGET` | 500 / 15000 | Calls |
| `WARM_DAILY_SHARE` | 0.4 | Fraction of each daily budget the warm-up may use (0.05-0.9) |

If you move to a paid provider plan, raise the monthly and daily values to match.

## Protecting Neon's compute allowance
- Do not point an uptime monitor at `/api/health`: it runs a database query and keeps Neon awake. The web page itself uses `/api/health?light=1`, which never touches the database.
- Prefer a few scheduled jobs over frequent polling.
- Watch **Storage** in the Neon console. Expired cache rows are not deleted automatically; if storage grows, delete old rows from `retailer_search_cache` and `nike_search_cache` where `expires_at` is more than a month in the past.

## Admin dashboard

Open `/admin/providers` and enter `CRON_SECRET`. It shows:
- today's and this month's reservations per provider (application-side counters, not the provider's billing ledger);
- provider health, cooldowns and last errors;
- the **refresh queue** (pending searches, completed in the last 7 days, oldest waiting);
- catalog and size-variant counts.

The secret is sent in an HTTPS authorization header and kept in page memory only.

### Reading the size diagnostics
Size checks are demand-driven: a size refinement triggers one batched StockX/GOAT lookup for up to 20 products, and **Compare offers** checks the selected product (including Flight Club). A browse without a size does not request sizes, so zero size variants before any size lookup is normal.

After a lookup, read each source's counters in order:
- **No last size sync:** no size request has happened yet.
- **0 quotes extracted:** the provider returned no rows for the requested IDs, or the response shape was not recognized. Reported as `no_data`, never as proof of availability.
- **Quotes > 0, offers matched = 0:** size data arrived but no stored retailer offer matched its listing URL or provider ID.
- **Offers matched > 0, variants stored = 0:** investigate Neon table constraints or the size-row upsert.
- **Variants stored > 0:** normalized size records were saved. Available/unavailable are explicit provider signals; unknown labels stay unverified.
