# Outlet Radar v1.5

## Inventory accuracy
- Catalog search and cached typeahead now keep size labels but clear any stock claims. A catalog-search result alone is not treated as live inventory confirmation.
- Size availability is checked through the individual Nike product-detail endpoint when a size filter is active or the user clicks **Refresh sizes**.
- Explicit out-of-stock signals (`OOS`, `OUT_OF_STOCK`, `SOLD_OUT`, and equivalents) take precedence over conflicting positive availability flags, even if another status field says `ACTIVE`.
- Generic `is_buyable` / `purchasable` booleans are no longer accepted as independent per-size inventory proof.
- Product detail availability cache reduced from 18 hours to 5 minutes. Existing Neon rows older than five minutes are ignored even if their previous expiration timestamp has not passed.
- Browser-displayed availability expires after five minutes and becomes unverified until checked again.
- **Refresh sizes** bypasses the Neon product-detail cache and makes a new API.SH product-detail request.

## Database and configuration
- No SQL migration required.
- No new environment variables required.
- Existing `DATABASE_URL` and `API_SH_KEY` remain in use.

## Important limitation
The stock signal is reported by API.SH from Nike online product data. It represents online shipping availability, not local store pickup or clearance-floor inventory. If a fresh API.SH product-detail response still disagrees with Nike.com, treat Nike.com as the final source and the provider response as unresolved rather than guaranteed stock.
