# Outlet Radar v1.7 — Multi-retailer expansion

## Added
- On-demand marketplace catalog comparison for StockX, GOAT, Flight Club and Kicks Crew through PCKT.
- Optional Google Shopping merchant results through SerpApi, which can include Foot Locker, Champs Sports, JD Sports and other retailers returned for the query.
- Nearby sneaker retailer location search by ZIP code and radius, including mapped locations for major footwear chains.
- Neon-backed caching for retailer comparison results (6 hours) and store-location results (24 hours).
- Shared monthly API-usage reservations, per-IP daily comparison limits, and a shared PCKT free-plan request gate.

## Inventory safeguards
- Marketplace search results are labeled as online listings; a catalog hit is not treated as proof that a particular size is purchasable.
- Physical retailer addresses are shown separately from product listings. Nearby locations are not reported as having the searched model or size.
- Google Shopping results are merchant listings, not a store-specific inventory feed.
- PCKT cached StockX/GOAT catalog data can be up to 24 hours old. The app's six-hour Neon cache does not make the upstream source data newer.

## Setup
- Existing v1.6 users must run `db/migrations/001_multi_retailer.sql` in Neon, or run the updated `db/schema.sql`.
- Add `PCKT_API_KEY` for StockX, GOAT, Flight Club and Kicks Crew.
- Add `SERPAPI_API_KEY` to enable Google Shopping merchant listings, including Foot Locker and other merchants returned by Google.
- No new API calls occur while typing. Marketplace providers are called only after the user explicitly presses **Compare retailers**.
