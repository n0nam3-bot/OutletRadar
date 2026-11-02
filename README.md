# Outlet Radar — Nike Clearance Finder

A product-first Nike deal finder built with Next.js, Vercel, and Neon Postgres. Search the US Nike catalog, narrow to sale listings, compare current and original prices, save products, keep daily price history, and open Nike's own product page to verify pickup locations for the exact size and color.

> **Inventory limitation:** Nike's public product data is not the same as physical-store inventory. This app does not claim to know which clearance store has an item on its sales floor. Its product data provider returns public product, price, and size information; the **Check store pickup** link opens the Nike product page, where Nike says shoppers can select a color and size and review participating pickup stores. Clearance-floor stock and store pickup are not interchangeable. See [Nike's pickup instructions](https://www.nike.com/help/a/store-pickup).

This is an independent tool and is not affiliated with or endorsed by Nike, Inc.

## Features in this starter

- Search Nike's US public product listings by product name, model, or style code.
- Optional sale-only search.
- Daily cap of 20 searches per client IP (stored as a keyed hash when Neon is connected; process-local fallback otherwise).
- Product image, style code, current price, original price, markdown percentage, and size data when returned by the provider.
- Local category, size, and sort filters.
- ZIP-code shortcut to search for nearby Nike Factory/Clearance Stores in Google Maps.
- Product-specific **Check store pickup** handoff to Nike's product page.
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

API.SH documents 1,000 free credits per month for its free account. Nike search and product-detail calls are listed at one credit each. The app limits its daily background refresh to 10 product calls, leaving most of the free monthly allowance for manual searches. Check the provider's current [Nike API page](https://api.sh/nike-api) and [general docs](https://api.sh/docs) before relying on its quota or pricing; terms and limits can change.

### 2. Connect Neon

1. Create a Neon PostgreSQL project, or use an existing one.
2. Copy its pooled connection string.
3. Add it to Vercel as `DATABASE_URL`.
4. Open Neon's SQL Editor and run the contents of [`db/schema.sql`](./db/schema.sql).

The database contains `watched_products`, `price_history`, and `search_rate_limits`. If Neon is not configured, searching still works and the watchlist falls back to this browser.

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
| `DATABASE_URL` | Cross-session watchlist and price history | Neon pooled PostgreSQL connection string |
| `CRON_SECRET` | Daily price-check job | Random secret, at least 32 characters recommended |
| `MAX_DAILY_PRICE_CHECKS` | Optional | Default 10; hard-capped at 10 by this starter |
| `RATE_LIMIT_SALT` | Optional | Salt for hashed-IP search limits; defaults to `API_SH_KEY` |

Do not use a `NEXT_PUBLIC_` prefix for any of these secrets.

## How store availability is handled

Nike's public help page explains that a shopper can open an item's information page, choose a color and size, and use the Pickup section to see participating stores with that item available for pickup. The product card's **Check store pickup** button opens that Nike product page. The separate ZIP shortcut opens a map search for nearby Nike stores.

The app intentionally does **not** translate online shipping size status into store stock. A future version could display store-by-store results inside the app only if an authorized data source exposes Nike's pickup inventory in a permitted, stable way.

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
    watchlist/route.ts
  globals.css
  layout.tsx
  page.tsx
 db/
  schema.sql
 lib/
  db.ts
  nike.ts
  types.ts
vercel.json
.env.example
```

## License

Starter code is provided for personal experimentation. Product data is supplied by API.SH and Nike's public website and remains subject to each provider's terms. Do not republish Nike images or product data in ways that violate applicable terms.
