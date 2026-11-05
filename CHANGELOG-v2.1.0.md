# Outlet Radar v2.1.0 — Normalized inventory and provider reliability

- Added canonical product/colorway persistence in `canonical_products`, individual seller offers in `retailer_offers`, and separate size/availability signals in `retailer_offer_sizes`.
- Catalog search snapshots and exact comparison responses are upserted into the normalized catalog alongside the existing JSON cache.
- Product-size labels from catalog discovery are stored as `unknown`; only explicit source-reported size availability can be stored as `available` or `unavailable`.
- Fresh and still-valid cached StockX, GOAT and Flight Club size quotes are persisted with their source check timestamp and six-hour expiry.
- Added provider health telemetry and per-source circuit breakers with exponential cooldown after repeated failures. A failing marketplace does not stop other sources.
- Added `/api/health` for sanitized service health and `/api/admin/providers` for CRON_SECRET-protected provider usage, health, and catalog counts.
- Reduced image-detail enrichment from 16 to 6 product records per uncached browse to conserve PCKT credits.
- If Neon is unavailable during a comparison, grouped catalog listings remain visible; new paid provider calls pause to avoid bypassing shared budget protection.
- Added idempotent migration `db/migrations/002_catalog_inventory.sql` and appended it to `db/schema.sql`.
- No new environment variable is introduced. The existing `CRON_SECRET` protects admin diagnostics.

- Added a mobile-friendly `/admin/providers` diagnostics page. It accepts the existing `CRON_SECRET` in memory only and displays provider reservations, health/cooldowns, and normalized catalog counts.
- Corrected the JSONB size-array SQL alias in the normalized persistence upsert to explicitly address the set-returning function value column.
- Added responsive styling for the owner diagnostics dashboard; no public navigation item exposes it.
- Added database-first catalog search: exact-query cache is checked first, then normalized products are queried from Neon before any new external discovery request. Search results from the normalized catalog are read-through cached by query/filter combination. Expired retailer offers are not presented as current listings.
