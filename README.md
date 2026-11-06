# Outlet Radar

A multi-brand product discovery and price-comparison site for sneakers, apparel and accessories. Search by model, browse catalogs from StockX, GOAT, Flight Club, Kicks Crew, Nike.com and Google Shopping merchants (such as Foot Locker, Champs Sports and JD Sports), and compare each product's online listings side by side, including offers from many other stores and brand sites.

Built with Next.js 15, Vercel and Neon Postgres, and designed to keep working on **free plans**: results are cached and shared between visitors, provider usage is capped by atomic daily and monthly budgets, and a search is never left blank when a free allowance runs out.

> **Limitations:** the catalog is a discovery index, not a complete product master. A catalog record is not proof of a current listing or of size-level availability, and the app does not claim physical-store inventory. Always confirm price, size and availability on the seller's page.

**Contents:** [What it does](#what-it-does) · [How it works](#how-it-works) · [Setup](#setup) · [Environment variables](#environment-variables) · [Affiliate links](#affiliate-links) · [Operating it](#operating-it) · [Updating](#updating) · [API routes](#api-routes) · [Project structure](#project-structure) · [Docs and changelog](#docs-and-changelog) · [Data and license](#data-and-license)

## What it does

- **Structured discovery.** Choose an item type, optional brand, audience and release year, and describe the model (at least two characters). Shorthand such as `aj1`, `af1` or `nb 550` is understood.
- **Local refinements.** Size, color, price range and sale-only filter the results already on screen; they never spend provider credits.
- **Grouped products.** Listings from different retailers that describe the same model are combined into one card. Conflicting known year, audience or color keeps variants apart.
- **Exact-product comparison.** **Compare offers** expands a card to show that model's direct retailer listings: seller title, price, size signals and product link. With a Channel3 key it also adds offers from many other stores and brand sites (adidas, New Balance, Puma, Reebok, Vans, Foot Locker and more), with eBay keys it adds new fixed-price eBay listings, and with Impact keys it adds affiliate-linked offers from the brands and stores that approved your account. Similar-but-different models are excluded.
- **Never an empty page.** If a source is out of free lookups, paused or failing, saved results are shown with a clear notice and the search is queued for an automatic refresh.
- **Watchlist.** Save products. The daily price-history job currently tracks Nike URLs only; other saved links are kept but not refreshed.
- **Owner dashboard.** `/admin/providers` shows provider budgets, health, the refresh queue, catalog counts, which retailers have actually appeared in results, a one-click live connection test of every configured provider, and anonymous counts of which stores and products visitors click.

## How it works

```mermaid
flowchart TD
  Q[Visitor search] --> A{Exact-query cache?}
  A -- hit --> R[Results]
  A -- miss --> B{Shared catalog in Neon?}
  B -- match --> R
  B -- no match --> C{Provider snapshot?}
  C -- fresh --> M[Merge and group]
  C -- missing --> D{Budget left and provider healthy?}
  D -- yes --> E[Live provider call] --> M
  D -- no --> F[Expired snapshot, labelled stale] --> M
  M --> G{Complete?}
  G -- yes --> H[Cache 12 h and save to catalog] --> R
  G -- no --> I[Do not cache, add to refresh queue] --> R
  I -.-> J[Daily warm-up job completes it]
  J -.-> H
```

**Lookup layers.** Every search checks, in order: the exact-query cache (12 h), the shared normalized catalog (`canonical_products`, `retailer_offers`, `retailer_offer_sizes`), provider snapshots (24 h per PCKT source, 12 h for Nike.com, 6 h for Google Shopping), and finally live providers. A search answered from the shared catalog that is missing a fresh snapshot for a configured source is queued so the warm-up job can add the missing retailers. A product found by one visitor is reusable by all.

**Budgets.** Before any paid request, an atomic Postgres function (`reserve_retailer_api_budget`) reserves daily and monthly units together, so concurrent requests cannot overspend. Defaults: PCKT 15/day and 450/month, SerpApi 7/day and 200/month, API.SH 25/day and 1,000/month, Channel3 30/day and 900/month, eBay 3,000/day. A shared request gate keeps PCKT under its 1 request/second limit across Vercel instances. A provider that fails repeatedly is paused with exponential back-off while the others keep working.

**Cost control.** Browsing always queries StockX and GOAT (0.7 PCKT credits); Flight Club and Kicks Crew (1.5) run only while at least half of the day's allowance remains. Gender, size, color, price and sale are applied locally. Comparing a product reuses the retailer URLs already grouped with it and runs no broad search; the only live calls are one optional search each to Channel3, eBay and Impact, each cached for 3 hours and never saved to the catalog (both providers ask that offer data not be kept longer).

**Keeping results fresh.** Incomplete answers are never cached. They go into `catalog_refresh_queue`, and a daily job (`/api/cron/warm-catalog`) completes them, then refreshes popular searches from `lib/warm-seeds.ts`, using at most 40% of the day's budget.

**Size data** is demand-driven: a size refinement triggers one batched StockX/GOAT lookup (up to 20 products), and Compare offers checks the selected product. Only explicit provider signals are stored as available or unavailable; everything else stays *unverified*.

More detail: [docs/free-tier-operations.md](./docs/free-tier-operations.md).

## Stack

- Next.js 15, React 19, TypeScript
- Vercel (hosting and Cron)
- Neon serverless Postgres
- [PCKT](https://pckt.sh/): StockX, GOAT, Flight Club and Kicks Crew catalogs
- [SerpApi](https://serpapi.com/): Google Shopping merchants (optional)
- [API.SH](https://api.sh/): Nike.com listings in the catalog, legacy Nike endpoints and Nike price history (optional)
- [Channel3](https://trychannel3.com/): live cross-store offers in Compare (optional)
- [eBay Browse API](https://developer.ebay.com/): live new eBay listings in Compare (optional)
- [Impact](https://impact.com/) partner API: affiliate-linked brand and store offers in Compare (optional)

## Setup

### 1. Create the database (Neon)
1. Create a Neon project and copy its **pooled** connection string.
2. Open **SQL Editor** and run the whole of [`db/schema.sql`](./db/schema.sql). It is idempotent and creates every table and function, including the budget ledger and refresh queue.

### 2. Get provider keys (all optional, but PCKT is needed for the marketplace catalog)
| Key | Where | Enables |
|---|---|---|
| `PCKT_API_KEY` | [pckt.sh](https://pckt.sh/) free account | StockX, GOAT, Flight Club and Kicks Crew discovery and comparison |
| `SERPAPI_API_KEY` | [serpapi.com](https://serpapi.com/) free account | Google Shopping merchants such as Foot Locker and Champs |
| `API_SH_KEY` | [api.sh](https://api.sh/) | Nike.com listings in the catalog, legacy Nike search and the Nike price-history job |
| `CHANNEL3_API_KEY` | [trychannel3.com](https://trychannel3.com/) free account | Offers from many other stores and brand sites when you press Compare offers |
| `IMPACT_ACCOUNT_SID`, `IMPACT_AUTH_TOKEN` | Impact dashboard → Account Settings → API | Affiliate-linked offers from the brands and stores that approved your Impact account |
| `EBAY_CLIENT_ID`, `EBAY_CLIENT_SECRET` | [developer.ebay.com](https://developer.ebay.com/) free account (production keyset) | New fixed-price eBay listings when you press Compare offers |

Free allowances change; check each dashboard. Without `SERPAPI_API_KEY`, merchant listings are simply omitted. Never prefix a key with `NEXT_PUBLIC_`.

### 3. Deploy (Vercel)
1. Push this repository to GitHub, then in Vercel choose **Add New → Project** and import it.
2. Add the [environment variables](#environment-variables) (at minimum `DATABASE_URL`, `PCKT_API_KEY` and `CRON_SECRET`).
3. Deploy. Vercel registers the two daily crons from `vercel.json`.

### 4. Verify
- `https://<your-site>/api/health` reports Neon as connected and which keys are configured.
- Run a search such as "Air Jordan 4", then open `/admin/providers` and enter `CRON_SECRET` to see credits being reserved.

### Local development
```bash
cp .env.example .env.local   # fill in DATABASE_URL and your keys
npm install
npm run dev                  # http://localhost:3000
```
Without `DATABASE_URL` the catalog returns an error: Neon is required.

## Environment variables

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | Yes | Neon pooled connection string |
| `PCKT_API_KEY` | For the main catalog | PCKT bearer token |
| `SERPAPI_API_KEY` | Optional | Google Shopping merchants |
| `API_SH_KEY` | Optional | Nike.com catalog source, legacy Nike endpoints and price history |
| `CHANNEL3_API_KEY` | Optional | Cross-store offers in Compare |
| `EBAY_CLIENT_ID`, `EBAY_CLIENT_SECRET` | Optional | eBay listings in Compare |
| `EBAY_CAMPAIGN_ID` | Optional | eBay Partner Network campaign id for affiliate links |
| `IMPACT_ACCOUNT_SID`, `IMPACT_AUTH_TOKEN` | Optional | Impact partner offers in Compare |
| `IMPACT_DAILY_BUDGET`, `IMPACT_MONTHLY_BUDGET` | Optional | Default 500 and 15000 calls |
| `AFFILIATE_LINK_TEMPLATES` | Optional | JSON map of store host to your affiliate tracking-link template; see [Affiliate links](#affiliate-links) |
| `EBAY_DAILY_BUDGET`, `EBAY_MONTHLY_BUDGET` | Optional | Default 3000 and 90000 calls |
| `CRON_SECRET` | Yes | Authorizes the cron jobs and the admin dashboard; use a random 32+ character value |
| `PCKT_DAILY_BUDGET`, `PCKT_MONTHLY_BUDGET` | Optional | Default 15 and 450 credits |
| `SERPAPI_DAILY_BUDGET`, `SERPAPI_MONTHLY_BUDGET` | Optional | Default 7 and 200 searches |
| `APISH_DAILY_BUDGET`, `APISH_MONTHLY_BUDGET` | Optional | Default 25 and 1000 requests |
| `CHANNEL3_DAILY_BUDGET`, `CHANNEL3_MONTHLY_BUDGET` | Optional | Default 30 and 900 searches |
| `WARM_DAILY_SHARE` | Optional | Share of each daily budget the warm-up may use, default `0.4` |
| `MAX_DAILY_PRICE_CHECKS` | Optional | Nike price checks per run, default and maximum 10 |
| `RATE_LIMIT_SALT` | Legacy | Retained for compatibility; unused |

## Affiliate links

Links in **Compare offers** can earn commission in three ways:
1. **Impact** and **eBay Partner Network** results already carry your tracking links (add the Impact keys, and `EBAY_CAMPAIGN_ID`).
2. **Any other store you have joined** (StockX, GOAT, Foot Locker, adidas, and so on) through `AFFILIATE_LINK_TEMPLATES`: a JSON object mapping the store's host to the tracking-link template from your network's deep-link generator, with `{url}` where the product link goes:
   ```json
   {"goat.com":"https://goat.sjv.io/c/1111/2222/3333?u={url}","footlocker.com":"https://www.awin1.com/cread.php?awinmid=1234&awinaffid=5678&ued={url}"}
   ```
   Paste it as one line in Vercel. Use the exact format your network's deep-link generator produces; the examples above are illustrative.
3. Everything else stays a plain link.

Wrapped links show a short disclosure ("Affiliate link: Outlet Radar may earn a commission at no cost to you."). Check each network's program terms and the FTC disclosure rules for your country. The **Outbound clicks** report on `/admin/providers` shows which stores your visitors actually click, which tells you which programs to apply to.

## Operating it

| Task | Where |
|---|---|
| Check provider usage, health, refresh queue | `/admin/providers` (enter `CRON_SECRET`) |
| Confirm every provider connection works and which stores it returns | `/admin/providers` → **Run connection test** (about one credit per provider) |
| Liveness check | `/api/health` (runs a DB query; do not poll it, it keeps Neon awake). `/api/health?light=1` checks configuration only. |
| Change which searches are kept warm | `lib/warm-seeds.ts` |
| Add search shorthand | `lib/query-normalize.ts` |
| Run the warm-up more than once a day | [docs/free-tier-operations.md](./docs/free-tier-operations.md#running-the-warm-up-more-often) |

**Scheduled jobs** (Vercel Cron, UTC; Hobby runs once per day within the scheduled hour):
- `17 13 * * *` `/api/cron/price-check`: refreshes up to 10 saved Nike URLs and records one price-history row per product per day. No notifications are sent.
- `47 5 * * *` `/api/cron/warm-catalog`: completes queued searches and refreshes popular ones.

Both require `Authorization: Bearer <CRON_SECRET>`, which Vercel sends automatically.

## Updating

Releases are applied by uploading a ZIP to the repository root; a GitHub Action builds it and commits it only if the build passes. Run any new database migration first. Full steps and a per-version migration table: [docs/upgrading.md](./docs/upgrading.md).

## API routes

| Route | Purpose |
|---|---|
| `GET /api/catalog` | Catalog discovery (`category`, `brand`, `q`, `gender`, `releaseYear`) |
| `POST /api/catalog/offers` | Exact retailer offers for one grouped product |
| `POST /api/catalog/availability` | Batched StockX/GOAT size pricing |
| `GET /api/watchlist`, `POST`, `DELETE` | Saved products |
| `GET /api/search`, `/api/suggest`, `/api/product` | Legacy Nike search, typeahead and detail |
| `GET /api/cron/price-check`, `/api/cron/warm-catalog` | Scheduled jobs (secret required) |
| `GET /api/admin/providers`, `POST /api/admin/providers/test` | Diagnostics and live connection test (secret required) |
| `POST /api/click` | Anonymous outbound-click counter (always 204) |
| `GET /api/health` | Sanitized health check |
| `GET /api/marketplaces` | Retired; returns HTTP 410 |

`/api/catalog` responses include `notice`, `complete`, `incomplete`, `approximate`, `savedSearch` and `queued` when an answer is partial, and each source reports a status of `success`, `cached`, `stale`, `skipped`, `budget_reached`, `cooldown`, `error` or `not_configured`.

## Project structure

```text
app/
  page.tsx                      Search, results and comparison UI
  globals.css                   Styles
  layout.tsx                    Root layout
  admin/providers/              Owner diagnostics page
  api/
    catalog/                    route.ts (thin), offers/, availability/
    cron/                       price-check/, warm-catalog/
    admin/providers/            Diagnostics API; test/ (live connection test)
    health/  marketplaces/      Health check; retired endpoint
    click/                      Anonymous outbound click counter
    search/  suggest/  product/ Legacy Nike endpoints
    watchlist/                  Saved products
lib/
  catalog-discovery.ts          Shared discovery pipeline (visitors and warm-up)
  catalog-store.ts              Normalized catalog persistence
  catalog-queue.ts              Refresh queue
  provider-budget.ts            Atomic daily/monthly budgets
  channel3.ts  ebay.ts  impact.ts  Live-offer clients (Channel3, eBay, Impact)
  affiliate-links.ts            Affiliate tracking-link templates
  provider-selftest.ts          Live connection test used by the admin page
  provider-health.ts            Telemetry and circuit breaker
  query-normalize.ts            Search shorthand expansion
  warm-seeds.ts                 Popular searches kept warm
  search-cache.ts  search-match.ts  nike.ts  audience.ts  types.ts  db.ts
db/
  schema.sql                    Full idempotent schema
  migrations/                   001-005, additive
changelog/                      Release notes per version
docs/                           Upgrading, free-tier operations, roadmap
.github/workflows/              ZIP validation and apply workflow
vercel.json                     Cron schedule
```

## Docs and changelog

- [Free-tier operations](./docs/free-tier-operations.md): limits, fallbacks, tuning, warm-up, dashboard
- [Upgrading](./docs/upgrading.md): ZIP workflow and migrations by version
- [Roadmap](./docs/roadmap.md)
- [Changelog](./changelog/README.md): notes for every release (current: [v2.9.0](./changelog/v2.9.0.md))

## Data and license

No open-source license is included; add a `LICENSE` file if you want to allow reuse. Product data comes from third-party providers and retailers and remains subject to their terms; do not republish brand images or product data in ways their terms forbid. Vercel Hobby and the providers' free tiers are not an unlimited commercial arrangement: review their terms before monetizing.
