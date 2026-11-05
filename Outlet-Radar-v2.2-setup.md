# Outlet Radar v2.2.0 — Deployment guide

## What this release fixes
1. **Less API usage:** PCKT search snapshots are shared for 24 hours; SerpApi Shopping snapshots for 6 hours. Compare offers reuses the selected product's saved retailer URLs and does not start new broad provider searches. The unused `/api/marketplaces` broad-search endpoint now returns HTTP 410.
2. **Daily safety caps:** PCKT 12.5 credits/day and 450/month; SerpApi 6 searches/day and 200/month; API.SH 25 requests/day and 1,000/month. These are Outlet Radar application-side ceilings.
3. **Size rows actually link to offers:** the size prefetch sends the exact retailer URL. Neon first matches `(source, listing_url)` and only falls back to provider product ID if there is no URL.
4. **Better diagnostics:** separates API connectivity, extracted size quotes, retailer offers matched, and size rows stored. It also reports last size sync and counts verified vs unknown size labels.

## Step 1 — Apply the Neon migration first

Open the Neon project and branch used by Vercel's `DATABASE_URL` → SQL Editor → New query. Run the complete contents of `outlet-radar-v2.2-migration.sql` (the separate SQL download).

This is migration 003. It is additive and safe to run more than once. Keep migrations 001 and 002 and all existing tables; do not drop or recreate anything. It adds the shared daily budget ledger, the atomic reserve function, additional provider-size diagnostic fields and `last_size_checked_at`.

After running, confirm that these exist:
- `retailer_api_usage_daily`
- `reserve_retailer_api_budget(text, numeric, numeric, numeric)`
- `provider_health.last_size_checked_at`

## Step 2 — Upload the application ZIP

1. Download `outlet-radar-v2.2.zip`.
2. Upload it to the root of `n0nam3-bot/OutletRadar` on GitHub and commit it.
3. Let the existing ZIP workflow validate/build and extract the archive.
4. Confirm the later extraction commit triggers Vercel and the latest deployment reaches **Ready**.

Keep the GitHub Actions workflow you already installed. No need to add a second ZIP updater.

## Step 3 — Check diagnostics

Open `https://outlet-radar.vercel.app/admin/providers` and enter the existing `CRON_SECRET`.

The budget display reports application-side reservations, not actual billing totals. Existing monthly PCKT/SerpApi rows are preserved. Daily counts start after migration 003 is first used. API.SH calls made before v2.2 were not recorded in the application ledger, so check the API.SH account for the true month-to-date amount.

## Step 4 — Exercise the size pipeline

1. Search for a product known to have StockX or GOAT listings.
2. Add a size refinement and press Find it, or open Compare offers on a product.
3. Refresh `/admin/providers`.
4. Inspect each source's **Last size sync**, **Size quotes extracted**, **Offers matched in Neon**, and **Size variants stored**.

How to read the diagnostics:
- **No last size sync:** no size request/synchronization has happened yet. Size checks are intentionally demand-driven; a browse without a size refinement does not request sizes for every product.
- **0 quotes extracted:** the provider returned no rows matching the selected provider IDs or the response shape was not recognized. The source is reported as `no_data`; it is not an availability confirmation.
- **Quotes > 0, matched offers = 0:** provider size data was returned but no Neon retailer offer matched its exact listing URL/provider ID.
- **Matched offers > 0, variants stored = 0:** investigate Neon table constraints or the size-row upsert; the source has been matched but no size rows were inserted.
- **Variants stored > 0:** the normalized size records have been saved. Available/unavailable are explicit provider signals; unknown labels remain unverified.

## Budgets and what gets cached

- PCKT marketplace catalog search snapshots: 24 hours per provider/query.
- SerpApi Google Shopping snapshots: 6 hours per query.
- Marketplace size details: 6 hours per provider product.
- Compare offers itself: no new broad catalog-search calls.
- One missing-image detail lookup maximum per uncached catalog browse, using StockX or GOAT when available.

The PCKT daily cap (12.5 credits) leaves headroom below the 450-credit monthly application ceiling even in 31-day months. SerpApi is capped at 6/day and 200/month. API.SH is capped at 25/day and 1,000/month. When a daily or monthly ceiling is reached, uncached calls to that provider are paused; shared cached catalog data and other providers remain usable.

No new environment variables are required. Keep `DATABASE_URL`, `PCKT_API_KEY`, `SERPAPI_API_KEY`, `API_SH_KEY` (optional legacy Nike features), and `CRON_SECRET` server-side in Vercel.
