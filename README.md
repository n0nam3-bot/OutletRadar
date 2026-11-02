# Outlet Radar — Nike Clearance Finder

A product-first Nike deal finder built with Next.js, Vercel, and Neon Postgres. Search the US Nike catalog, narrow to sale listings, compare current and original prices, save products, keep daily price history, and open Nike's own product page to verify pickup locations for the exact size and color.

> **Inventory limitation:** Nike's public product data is not the same as physical-store inventory. This app does not claim to know which clearance store has an item on its sales floor. Its product data provider returns public product, price, and size information; the **Check store pickup** link opens the Nike product page, where Nike says shoppers can select a color and size and review participating pickup stores. Clearance-floor stock and store pickup are not interchangeable. See [Nike's pickup instructions](https://www.nike.com/help/a/store-pickup).

This is an independent tool and is not affiliated with or endorsed by Nike, Inc.

## Features in this starter

- Search Nike's US public product listings by product name, model, or style code.
- Optional sale-only search.
- Daily cap of 20 live provider-search misses per client IP (stored as a keyed hash when Neon is connected; process-local fallback otherwise). Cache hits do not consume a provider request or search-limit slot.
- Product image, style code, current price, original price, markdown percentage, audience and online size data when returned by the provider.
- Relevance-filtered search: meaningful search terms must match the returned product title/description/style code, reducing unrelated Nike fallback listings.
- Product suggestions from the Neon catalogue as the user types. Typeahead reads Neon only and does not make paid API requests; a new product appears in suggestions after its first successful search is cached.
- Men, Women, Kids, and Unisex audience filters; product type, returned online size, and sort filters. Size options are drawn from the product size data already loaded; opening a product's Sizes action fetches and caches its online size list.
- ZIP-code store locator with 5, 10, 25, 50, or 100-mile distance filters and store cards sorted by distance.
- Product-specific **Check Nike pickup** handoff to the Nike product page.
- Persistent Neon caching: identical search/filter combinations are reused for 12 hours; product details and online size data are reused for 18 hours; nearby store locations are reused for 24 hours.
- Save products to a browser watchlist; Neon persistence is enabled when `DATABASE_URL` is configured and `db/schema.sql` has been run.
- Daily price history refresh for up to 10 saved product links per day through Vercel Cron (requires `API_SH_KEY`, `DATABASE_URL`, and `CRON_SECRET`).
- No user account or personal information is required. The watchlist uses a random browser-generated visitor ID; clearing browser storage loses the local watchlist unless the database is configured and that visitor ID is retained.

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

API.SH currently lists one credit per Nike search and product-detail call. Free-credit allowances and pricing are subject to provider changes; check your current API.SH dashboard for the exact quota. The app limits its daily background refresh to 10 product calls and uses Neon caching to avoid repeated exact searches and detail lookups.

### 2. Connect Neon

1. Create a Neon PostgreSQL project, or use an existing one.
2. Copy its pooled connection string.
3. Add it to Vercel as `DATABASE_URL`.
4. Open Neon's SQL Editor and run the contents of [`db/schema.sql`](./db/schema.sql).

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

Nike's public help page explains that a shopper can open an item's information page, choose a color and size, and use the Pickup section to see participating stores with that item available for pickup. The product card's **Check Nike pickup** button opens that Nike product page. The ZIP locator shows nearby store locations directly in the app and gives an optional directions link for each store.

The ZIP locator geocodes a five-digit US ZIP through Zippopotam.us, then finds mapped Nike locations through OpenStreetMap Overpass and calculates straight-line distance from the ZIP centroid (not driving distance). Store map data can be incomplete or have missing addresses. The app labels Factory/Clearance stores when those words are present in map data, but does not guarantee that the list contains every Nike outlet. Nearby store results are cached in Neon for 24 hours.

The app intentionally does **not** translate online shipping size status into store stock. Nike's public help instructions say shoppers can select a product color and size and review participating stores in the Pickup section. The API.SH Nike product API returns public product and online size information, not a public store-by-store inventory feed. A Nike location card is therefore a nearby store, **not a confirmation that the searched shoe is available there**. Use the Nike Pickup link for official size-specific pickup checking.

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
