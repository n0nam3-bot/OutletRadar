# Outlet Radar v2.2.0 — Usage control and size persistence

## Reduce repeat provider usage
- Added shared PCKT provider search snapshots in Neon (24-hour TTL) and Google Shopping snapshots (6-hour TTL), reused across visitor searches and gender/release-year refinements.
- Kept the exact-query catalog cache and normalized Neon catalog as earlier lookup layers. External calls are attempted only after these shared sources miss.
- Reduced missing-image enrichment to at most one StockX/GOAT product-detail lookup per uncached catalog browse.
- Compare offers reuses only the exact retailer listing URLs already grouped under the selected product. It does not perform another broad StockX/GOAT/Flight Club/Kicks Crew/SerpApi search. The exact-offer cache namespace is bumped to v9 so previously cached broad-search comparisons cannot reappear.
- Retired the unused `/api/marketplaces` endpoint with HTTP 410 so it cannot bypass the new snapshots or shared budgets.

## Daily + monthly provider protection
- Added an atomic Neon function that reserves daily and monthly budgets together. A failed monthly reservation rolls back the daily reservation.
- Default application caps: PCKT 12.5 credits/day and 450/month; SerpApi 6 searches/day and 200/month; API.SH 25 requests/day and 1,000/month.
- These limits apply to marketplace discovery, size-detail requests, legacy Nike searches and scheduled Nike price checks. Existing monthly PCKT and SerpApi reservations remain intact; API.SH historical usage predating this release is not retroactively known to the app ledger.

## Size persistence and diagnostics
- The automatic size prefetch now sends the exact retailer listing URL with each provider product ID.
- Normalized size persistence joins by `(source, listing_url)` first and falls back to provider product ID only when there is no URL.
- The selected product and its retailer URLs are upserted before size variants are inserted.
- Provider HTTP success with zero parsed size rows is reported as `no_data`, not as proof of size availability.
- Added a last-size-sync timestamp and separate counts for total size labels, verified availability signals, available signals, unknown labels, extracted quotes, matched offers and persisted variants.
- Size checks remain demand-driven: size-filtered searches batch StockX/GOAT pricing for up to 20 products, while Compare offers checks the selected product and can query Flight Club. A catalog browse with no size refinement does not query sizes for every card.
- GOAT search uses first-page pagination (`page=1`).

## Migration and configuration
- Apply `db/migrations/003_provider_budget_and_size_diagnostics.sql` to the Neon branch used by Vercel before deploying. The migration is additive and repeatable.
- No new environment variables. Existing `DATABASE_URL`, `PCKT_API_KEY`, `SERPAPI_API_KEY`, `API_SH_KEY`, and `CRON_SECRET` are reused.
- Daily application reservations begin on/after migration use. Provider accounts remain authoritative for actual quota/billing.

## Validation
- Strict backend TypeScript check passed using temporary framework/database type declarations.
- All TypeScript/TSX files passed syntax transpilation.
- Full Next.js production build could not be completed locally because `npm install` timed out; the configured GitHub Actions validation workflow should run the production build before applying the ZIP.
