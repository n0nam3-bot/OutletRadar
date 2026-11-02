# Outlet Radar — Nike Clearance Finder v1.6

A product-first Nike deal finder built with Next.js, Vercel, and Neon Postgres. Search the US Nike catalog once per model query, then narrow the saved result set locally by audience, size, category, sale status and price order. Save products, keep daily price history, and open the Nike listing when you need to check its official pickup options.

> **Inventory limitation:** Nike's public product data is not the same as physical-store inventory. This app does not claim to know which clearance store has an item on its sales floor. Its product data provider returns public product, price, and online size information; the **Open product page** link opens the Nike product page, where shoppers can select a color and size and review participating pickup stores. Clearance-floor stock and store pickup are not interchangeable. See [Nike's pickup instructions](https://www.nike.com/help/a/store-pickup).

This is an independent tool and is not affiliated with or endorsed by Nike, Inc.

## Features in this starter

- Search Nike's US public product listings by product name, model, or style code.
- Sale-only, audience, category and size filters are applied locally after the shared base search has been fetched and cached. Changing these filters does not create another product-search API request.
- Daily cap of 20 live provider-search misses per client IP (stored as a keyed hash when Neon is connected; process-local fallback otherwise). Cache hits do not consume a provider request or search-limit slot.
- Product image, style code, current price, original price, markdown percentage, audience and online size data when returned by the provider.
- Relevance-filtered search: meaningful search terms must match the returned product title/description/style code, reducing unrelated Nike fallback listings.
- Product suggestions from the Neon catalogue as the user types. Typeahead reads Neon only and does not make paid API requests; a new product appears in suggestions after its first successful search is cached.
- Men, Women, Kids / Youth, and Unisex audience filters; product type, free-entry size filter, sale-only and sort filters are visible before search and also update results after search. Youth sizing is kept separate from adult sizing (for example, 5Y does not equal adult 5). Size filtering is local and does not automatically trigger paid product-detail calls. The shopper explicitly checks sizes one product at a time; product detail responses are cached in Neon for one hour to reduce repeat API usage, and the UI shows the age of the provider check.
- ZIP-code store locator with 5, 10, 25, 50, or 100-mile distance filters and store cards sorted by distance.
- Product-specific **Open product page** handoff. This does not claim that a selected size is available or that a store has the item.
- Persistent Neon caching: the unfiltered base result for an identical model query is reused for 12 hours regardless of audience, size, category or sale filters; product details and online size data are reused for one hour; nearby store locations are reused for 24 hours. The catalogue uses a version marker so partially filtered records created by v1.1 are not mistaken for complete v1.3 catalogues.
- Save products to a browser watchlist; Neon persistence is enabled when `DATABASE_URL` is configured and `db/schema.sql` has been run.
- Daily price history refresh for up to 10 saved product links per day through Vercel Cron (requires `API_SH_KEY`, `DATABASE_URL`, and `CRON_SECRET`).
- No user account or personal information is required. The watchlist uses a random browser-generated visitor ID; clearing browser storage loses the local watchlist unless the database is configured and that visitor ID is retained.

## Version 1.2 changes

- One base search cache key per normalized query; server no longer passes gender or sale filters to the provider.
- Product search returns the broad matching set and stores it before front-end audience, size, category and sale filtering.
- Search filters are displayed with the search controls so they can be chosen before submitting, then changed without repeating the search.
- Youth markers such as Big Kids, Grade School, GS, Little Kids, Preschool and Y sizing take priority over inconsistent broad gender metadata.
- Size filtering distinguishes `5` from `5Y`; shared Nike labels such as `M 6 / W 7.5` are interpreted using the selected audience.
- Size detail lookups are not automatic. The shopper explicitly checks one product at a time, avoiding a burst of up to 10 paid provider calls from simply entering a size. Each product detail is reused from Neon for one hour; a manual refresh can bypass the cache.
- Removed the misleading “Select this exact product” card control and renamed the Nike link to “Open product page”.
- Old v1.1 catalogue rows are ignored as base search results because they may have been stored with audience/sale filters already applied. They are retained in Neon, not deleted.

## Version 1.4 changes

- Product title and subtitle audience labels take priority over broad provider metadata. A product described as `Men's Shoes` is classified as Men even if the API's generic gender field says `Unisex`; youth taxonomy and Y-size labels still take priority.
- Size normalization accepts additional provider field variants and nested availability/status objects. Combined labels such as `M 11.5 / W 13` are matched against the selected audience.
- Only explicit stock signals are treated as available or unavailable. Values such as `HIGH`, `LOW`, `IN_STOCK` and `OOS` are interpreted as stock signals; generic product/SKU states such as `ACTIVE` remain unverified.
- Size chips now distinguish online shipping available, unavailable, and unverified. Product cards explain when a size is listed but its stock status is not reported.
- Product detail responses with no size rows no longer overwrite a non-empty size list from search. Product detail response unwrapping supports nested `data.product` and `data.item` envelopes.

## Stack

- Next.js 15 / React 19 / TypeScript
- Vercel Hobby hosting and daily Cron
- Neon PostgreSQL
- API.SH Nike product-data endpoint

## Setup

### 1. Get a product-data key

1. Create an account at [API.SH](https://api.sh/).
2. Create an API key.
3. Add it to Vercel as `API_SH_KEY` (or copy it to `.env.local` for local development).

API.SH currently lists one credit per Nike search and product-detail call. Free-credit allowances and pricing are subject to provider changes; check your current API.SH dashboard for the exact quota. The app limits its daily background refresh to 10 product calls. Neon caching avoids repeated model searches and detail lookups. Entering a size filter does not make a provider call. The shopper requests size details per product, and each successful detail response is cached for one hour. This limits provider calls and makes the check cost explicit.

### 2. Connect Neon

1. Create a Neon PostgreSQL project, or use an existing one.
2. Copy its pooled connection string.
3. Add it to Vercel as `DATABASE_URL`.
4. Open Neon's SQL Editor and run the contents of [`db/schema.sql`](./db/schema.sql) if this is a new database or the schema has not already been applied.

The database contains watchlists, price history, hashed search limits, a shared product search cache, product details cache, a cached product catalogue for typeahead, and a nearby-store cache. Run the **entire current** `db/schema.sql` in Neon's SQL Editor. It uses `CREATE TABLE IF NOT EXISTS` and `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`, so it can be run again on an existing project without deleting your existing watchlist or history. If Neon is not configured, live product search still works, but persistent search caching and catalog suggestions are unavailable.

### 3. Deploy to Vercel

1. Put this project in a GitHub repository.
2. In Vercel, choose **Add New → Project** and import the repository.
3. Add the environment variables below before deploying.
4. Deploy. Vercel will register the daily Cron from `vercel.json`.

For local development:

```bash
cp .env.example .env.local
npm install
npm run dev
```

Open `http://localhost:3000`.

### Upgrade from v1.2

Replace the repository contents with this v1.3 project and redeploy. **No new Neon SQL migration is required** because v1.3 reuses the existing tables and catalogue marker. Existing catalogue records remain in Neon. The first search for a model after deploying v1.3 will fetch and save a clean unfiltered base result; later filter changes and repeat searches reuse that cached result for 12 hours.

## Environment variables

| Variable | Required for | Notes |
|---|---|---|
| `API_SH_KEY` | Live Nike product search | API.SH key; keep server-side only |
| `DATABASE_URL` | Watchlist, history, product/search/store caches | Neon pooled PostgreSQL connection string |
| `CRON_SECRET` | Daily price-check job | Random secret, at least 32 characters recommended |
| `MAX_DAILY_PRICE_CHECKS` | Optional | Default 10; hard-capped at 10 by this starter |
| `RATE_LIMIT_SALT` | Optional | Salt for hashed-IP search limits; defaults to `API_SH_KEY` |

Do not use a `NEXT_PUBLIC_` prefix for any of these secrets.

## How store availability is handled

Nike's public help page explains that a shopper can open an item's information page, choose a color and size, and use the Pickup section to see participating stores with that item available for pickup. The product card's **Open product page** link opens that Nike product page. The ZIP locator shows nearby store locations directly in the app and gives an optional directions link for each store.

The ZIP locator geocodes a five-digit US ZIP through Zippopotam.us, then finds mapped Nike locations through OpenStreetMap Overpass and calculates straight-line distance from the ZIP centroid (not driving distance). Store map data can be incomplete or have missing addresses. The app labels Factory/Clearance stores when those words are present in map data, but does not guarantee that the list contains every Nike outlet. Nearby store results are cached in Neon for 24 hours.

The app intentionally does **not** translate online shipping size status into store stock. Nike's public help instructions say shoppers can select a product color and size and review participating stores in the Pickup section. The API.SH Nike product API returns public product and online size information, not a public store-by-store inventory feed. A Nike location card is therefore a nearby store, **not a confirmation that the searched shoe is available there**. The **Open product page** action simply opens the product page; Nike may require the shopper to select the color and size before any Pickup options appear.

## Price monitoring behavior

Vercel Hobby supports Cron Jobs but schedules are limited to once per day, and execution can happen within the configured UTC hour rather than at an exact minute. This starter schedules one daily refresh at 13:17 UTC. The endpoint is protected by `CRON_SECRET` and checks at most 10 watchlist rows per run. Refreshes create one price-history record per product per calendar day. The feature records history only; it does not send email, text, or push notifications.

If you add many users, watchlist rows, or manual searches, monitor the API.SH monthly credit balance and Neon/Vercel usage. Free tiers have quotas and are not an unlimited commercial hosting arrangement.

## Important source links

- [Nike — How store pickup works](https://www.nike.com/help/a/store-pickup)
- [Nike — US store directory](https://www.nike.com/retail/directory/united-states)
- [API.SH — Nike API](https://api.sh/nike-api)
- [API.SH — Getting started and credits](https://api.sh/docs)
- [Vercel — Cron usage and pricing](https://vercel.com/docs/cron-jobs/usage-and-pricing)
- [Vercel — Hobby plan](https://vercel.com/docs/plans/hobby)
- [Neon — Plans](https://neon.com/docs/introduction/plans)

## Project structure

```text
app/
  api/
    cron/price-check/route.ts
    health/route.ts
    product/route.ts
    search/route.ts
    stores/route.ts
    suggest/route.ts
    watchlist/route.ts
  globals.css
  layout.tsx
  page.tsx
 db/
  schema.sql
 lib/
  db.ts
  nike.ts
  search-cache.ts
  types.ts
vercel.json
.env.example
```

## License

Starter code is provided for personal experimentation. Product data is supplied by API.SH and Nike's public website and remains subject to each provider's terms. Do not republish Nike images or product data in ways that violate applicable terms.


## v1.4 search and inventory interpretation

- Product title/subtitle audience descriptors take priority over broad provider gender metadata. For example, a listing labelled `Unisex` by the provider but described as `Men's Shoes` is classified as Men. Youth naming and Y-size labels still take priority.
- Combined size labels such as `M 11.5 / W 13` are matched against the selected audience's side of the size conversion.
- Size status is only marked available/unavailable when the provider returns an explicit boolean or a recognized inventory level (`HIGH`, `MEDIUM`, `LOW`, `IN_STOCK`, `OOS`, etc.). Generic catalog states such as `ACTIVE` remain unverified.
- Gray/dashed sizes are listed options without a verified shipping-stock signal. Store pickup availability is never inferred from online shipping status.
- If a product detail response contains no sizes, the app preserves the size list from the search result rather than replacing it with an empty list.


## Version 1.5 availability safeguards

- Search and typeahead results retain size labels but do not present search-index availability as confirmed stock.
- A selected-size check uses the product-detail endpoint and the provider's per-size online shipping status.
- Product-detail availability cache lifetime is one hour. Old Neon rows are ignored when their one-hour cache lifetime expires.
- The product card provides **Check sizes** to use a still-fresh Neon cache entry or make a single product-detail request. After a check, **Refresh sizes** bypasses the cache.
- Explicit `OOS`/sold-out status overrides any contradictory positive `available` flag.
- This is online shipping availability reported by API.SH, not Nike store pickup or clearance-floor inventory. Nike's page remains the final check when a provider response disagrees.


## Version 1.6 changes

- Exact model token matching replaces compact substring matching. Numeric model identifiers must match as whole tokens, so `Air Jordan 1` cannot match `Air Jordan 14`.
- The same strict matcher is used for live search results, Neon-catalogue reuse and typeahead suggestions.
- Size filtering no longer triggers automatic batches of paid product-detail requests. The shopper checks one product at a time.
- Product-detail availability is cached for one hour in Neon to reduce repeated API credits.
- The page re-renders every 30 seconds so availability status becomes unverified when its one-hour freshness window expires, even if the page remains open.
- Product cards show the age of the latest availability check.
