# Outlet Radar

A multi-brand product discovery and price-comparison platform built with Next.js, Vercel, and Neon Postgres. Browse sneaker, apparel and accessory catalogs by brand, discover models that have not previously been searched in the app, compare online listings across StockX, GOAT, Flight Club, Kicks Crew and Google Shopping merchants such as Foot Locker, Champs Sports and JD Sports. Catalog and retailer searches are cached in Neon to conserve free API credits.

> **Catalog and inventory limitation:** The catalog is a discovery index, not a complete universal product master. StockX/GOAT/Flight Club/Kicks Crew and Google Shopping can reveal models not previously searched in Outlet Radar, including older/discontinued models when those providers index them. A catalog record is not proof of a current listing or size-level availability. The app does not currently claim physical-store inventory; online listings still require seller checkout verification.


## Version 2.1 — Normalized inventory and provider reliability

- Added an additive Neon data model: `canonical_products` stores canonical model/colorway/release records; `retailer_offers` stores each individual seller/marketplace listing; `retailer_offer_sizes` stores size labels separately from stock signals; `provider_health` tracks provider response health and circuit-breaker state.
- Catalog discoveries and exact comparison offers are persisted to the normalized tables while the existing `retailer_search_cache` continues to serve fast shared snapshots. Existing watchlists, price history and legacy caches are preserved.
- Explicit size-provider responses are upserted as variant signals with source, size system, price, source status and verification time. Catalog size labels remain `unknown`; merely seeing a size label never makes it available.
- Added per-source circuit breakers. After three consecutive request failures, that source is temporarily paused with exponential backoff. Other sources and already-cached results continue to work.
- Added public `GET /api/health` for sanitized service/database/provider-configuration checks and protected `GET /api/admin/providers` for current-month budget reservations, provider health and normalized catalog counts. The admin endpoint requires `Authorization: Bearer <CRON_SECRET>`.
- Reduced automatic image-detail enrichment from 16 to 6 catalog cards per browse to avoid spending disproportionate provider credits on cosmetic enrichment.
- Comparison can still return catalog-seeded exact listings if Neon becomes temporarily unavailable; in that condition, new external provider pulls pause because shared budgets and caches cannot be safely enforced.
- Run `db/migrations/002_catalog_inventory.sql` in Neon before deploying this release. The migration is idempotent and does not delete existing application data.

### v2.1 operational notes

- The provider budget figures are application-side safety reservations, not authoritative provider billing. Reconcile them with the PCKT and SerpApi dashboards.
- Provider circuit breakers are best-effort and require the v2.1 migration. If the health table is not installed, requests continue using the existing monthly budget controls, but cooldown telemetry is unavailable.
- The admin provider endpoint is intentionally protected by the existing `CRON_SECRET`; do not put that secret in a public URL, source file, or `NEXT_PUBLIC_` variable.

Outlet Radar is an independent comparison platform and is not affiliated with or endorsed by any brand, retailer, or marketplace displayed.

## Features in this starter

- **Structured product discovery:** start with “What are you hunting for?”, choose an item type, optional brand, audience and (when known) release year, and enter a product/model query of at least two characters. Empty broad-category searches are intentionally blocked to avoid noisy results and unnecessary provider calls.
- **Local refinements:** size, color, minimum/maximum price and sale-only refine the discovered catalog. They do not alter the provider query or spend another catalog-search credit; products are only retained when the returned data can confirm the selected attribute.
- **Multi-brand catalog discovery:** discover product models from StockX, GOAT, Flight Club, Kicks Crew and Google Shopping merchant indexes. Products can appear before anyone has searched for them in Outlet Radar; discontinued models may appear when providers still index them.
- **Grouped product results:** retailer records are combined into one product card when their model identity matches. Missing audience/year/color metadata can be reconciled across listings, while conflicting known year, audience or color attributes keep distinct variants separate.
- **Inline exact-product comparison:** press Compare offers on a product card to expand that same card with the selected model’s direct retailer listings, each seller’s own title, price, size signals and direct product URL. Provider search results are held to strict model/variant matching; similar models are not displayed as offers.
- **Compact mobile-first layout:** the search controls are in the opening panel; advanced refinements can be expanded when needed. The old separate Nike search section and Nike store-directory link have been removed.
- **Free-tier protection:** catalog and retailer lookups are cached in Neon, with shared monthly safety ceilings of 450 PCKT credits and 200 SerpApi requests. There is no arbitrary daily search cap per visitor; after a provider safety budget is reached, existing cached results remain available and new uncached requests to that source pause.
- **Watchlist:** save products from the multi-brand catalog. Neon persistence is enabled when `DATABASE_URL` is configured and the schema has been run. The current automated daily price-history job remains Nike-URL-only; other saved retailer links are retained but are not automatically refreshed yet.
- **Product imagery:** the catalog extracts product artwork from multiple provider image fields and hydrates up to 6 image-less models per uncached browse using cached StockX, GOAT or Flight Club product details. Some source records still do not include an image.
- **Inventory clarity:** catalog filters use attributes actually supplied by sources. Comparison size signals distinguish StockX active asks, GOAT size-availability flags and Flight Club listed new sizes; these are not final checkout guarantees.

## Version 2.0 changes

- Reworked Find it into a structured discovery request: item type, optional brand, audience, optional release year and a required free-text model description (at least two characters).
- Kept size, color, price range and sale-only as local result refinements; changing them does not become a new provider search query.
- Grouped cross-retailer records by normalized brand/category/model tokens. Listings with missing year, audience or color metadata can join a compatible product group; contradictory known year, gender or color attributes remain separate products.
- Added shared manufacturer style-code matching as a secondary grouping bridge when marketplace titles differ.
- Compare offers is tied to the selected grouped product, and offers expand inside that product card with each retailer’s own listing title, direct URL, price and available size-level provider signals. Exact matching requires the complete model/variant token set or a matching manufacturer style code.
- Bumped the Neon catalog and exact-offer cache namespaces so older loosely grouped results are not reused.
- No Neon schema migration or new environment variables required.

## Version 1.9.3 changes

- Fixed the multi-argument numeric parser used by Flight Club size/price details; it now selects the first valid non-negative value from the provider fallback fields.
- Added explicit TypeScript narrowing for StockX/GOAT product-detail image lookups.
- No Neon migration or new environment variables required.

## Version 1.9.2 changes

- Expanded image field extraction for marketplace catalog and product-detail responses, including nested image/picture/media objects.
- Catalog discovery hydrates up to 16 image-less cards per uncached catalog browse from StockX, GOAT or Flight Club product details; image lookups are cached in Neon for 30 days. Products without upstream artwork remain clearly image-unavailable rather than receiving fabricated images.
- Corrected marketplace gender fallback so an individual listing marked `Unknown` does not mask a known audience on the grouped catalog product; this is especially important when interpreting GOAT numeric sizes.
- Normalized StockX size-system values that use underscore/hyphen formats before identifying Men's, Women's or Youth variants.
- Size quote cache is now six hours; cache identity is versioned so old ambiguous size records are not reused.
- In product comparison mode, the discovery hero and catalog grid stay collapsed, a compact return bar remains visible, and the page scrolls to the expanded comparison panel once per selected product.
- No Neon schema migration or additional environment variables required.

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
- PCKT marketplace catalog APIs (StockX, GOAT, Flight Club, Kicks Crew)
- SerpApi Google Shopping API for broad retailer discovery
- API.SH Nike product-data endpoint for optional direct Nike search

## Setup

### 1. Get a product-data key

1. Create an account at [API.SH](https://api.sh/).
2. Create an API key.
3. Add it to Vercel as `API_SH_KEY` (or copy it to `.env.local` for local development).

API.SH is not required for the unified multi-brand catalog. It remains available to the legacy Nike-specific endpoints and the optional daily price-history job for previously saved Nike URLs. It is not the source of the main product discovery catalog. Free-credit allowances and pricing are subject to provider changes; check your API.SH dashboard for the exact quota. The app's daily background refresh is limited to 10 saved-product checks. Neon caching avoids repeated model searches and detail lookups. Entering a size filter does not make a provider call. The shopper requests size details per product, and each successful detail response is cached for one hour.

### 2. Add optional multi-retailer providers

These providers are called only when a user explicitly presses **Browse catalog** or **Compare retailers**. The app does not call them while typing or silently in the background.

**PCKT — StockX, GOAT, Flight Club and Kicks Crew**

1. Create a free account at [PCKT](https://pckt.sh/).
2. Open the API docs / account area and create or copy your API key.
3. Add the key to Vercel as `PCKT_API_KEY` (Secret, server-side only).

PCKT currently advertises 500 free credits per month after its initial signup credits. An uncached sneaker catalog browse or retailer comparison that calls all four sources has documented costs of 0.4 (StockX cached search), 0.3 (GOAT cached search), 1 (Flight Club search) and 0.5 (Kicks Crew search), or up to 2.2 credits in total. Apparel/accessory catalog browsing currently queries StockX and GOAT (0.7 credits combined). PCKT's Free plan rate limit is 1 request per second. A shared Neon request gate enforces that pacing across concurrent Vercel instances. The app reserves at most 450 PCKT credits per month, leaving a 50-credit buffer. Cached PCKT catalog data can be up to 24 hours old. These quotas and provider terms can change; check your PCKT dashboard.

**SerpApi — Google Shopping merchant listings, including Foot Locker when returned**

1. Create an account at [SerpApi](https://serpapi.com/).
2. Copy the API key from your account dashboard.
3. Add it to Vercel as `SERPAPI_API_KEY` (Secret, server-side only).

SerpApi currently advertises a free allowance of 250 searches per month. The app caps requests at 200 per month, leaving a 50-search buffer. Google Shopping results can include Foot Locker, Champs Sports, JD Sports and other merchants, but Google does not return every retailer for every query. Google Shopping results are online offers; they do not prove a selected size is available or expose individual store inventory. If you do not add `SERPAPI_API_KEY`, PCKT marketplace search still works; Foot Locker and other Google Shopping merchant results will simply be omitted.

Both keys are optional and do not replace `API_SH_KEY`. Do not give either key a `NEXT_PUBLIC_` prefix. You can use the app without either provider, but retailer comparison results require the respective keys.

### 3. Connect Neon

1. Create a Neon PostgreSQL project, or use an existing one.
2. Copy its pooled connection string.
3. Add it to Vercel as `DATABASE_URL`.
4. Open Neon's SQL Editor and run the contents of [`db/schema.sql`](./db/schema.sql) if this is a new database or the schema has not already been applied.

The database contains watchlists, price history, legacy hashed search-limit records, Nike direct-search caches, retailer/catalog discovery caches, retailer API monthly-budget counters, a shared PCKT pacing gate, canonical products, retailer offers, size variants and provider health telemetry. A legacy nearby retailer-location cache table may remain in Neon but is no longer used by the customer-facing UI. Run the **entire current** `db/schema.sql` in Neon's SQL Editor. It uses `CREATE TABLE IF NOT EXISTS` and `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`, so it can be run again on an existing project without deleting your existing watchlist or history. If Neon is not configured, live product search still works, but persistent search caching and catalog suggestions are unavailable.

### 4. Deploy to Vercel

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

## Database-first catalog behavior

Catalog discovery follows this order: exact-query cache, then the shared normalized `canonical_products` / `retailer_offers` catalog, then external provider discovery only when the product has not already been learned. The normalized catalog uses whole numeric model tokens (so model `1` does not match `14`) and the user's brand, product type, audience and release-year filters. Size, color, price and sale remain result refinements. Existing catalog products remain discoverable even when their previous retailer offers have expired; expired offers are not presented as current retailer listings. Comparing a product is the separate step that attempts to refresh retailer offers.

## Provider health dashboard

After applying `db/migrations/002_catalog_inventory.sql` and deploying v2.1, open `/admin/providers` on the production site. Enter the existing `CRON_SECRET` from Vercel to view application-side PCKT/SerpApi usage reservations, provider success/error/cooldown state, and normalized catalog counts. The secret is sent only in an HTTPS authorization header and is held in page memory; it is not placed in the URL or browser local storage. The underlying endpoint is protected with constant-time token comparison.

`/api/health` is a public, sanitized liveness check. It reports whether Neon is configured/connected and which provider keys are configured, but never returns secrets.

The provider budget values in the dashboard are Outlet Radar's own reservations, not the provider's billing ledger. Check each provider account for authoritative quota and billing status. If a provider enters cooldown, the app continues showing other providers and cached/grouped offers where available.

### Upgrade from v2.0.1

1. Run [`db/migrations/002_catalog_inventory.sql`](./db/migrations/002_catalog_inventory.sql) in the same Neon project and branch used by Vercel `DATABASE_URL`.
2. Upload the v2.1 ZIP through the GitHub ZIP updater, or replace the repository contents with the project files.
3. Confirm the extraction workflow and then confirm the subsequent Vercel deployment is **Ready**.
4. Check `/api/health`, then open `/admin/providers` and enter the existing `CRON_SECRET` to view provider budgets and health.
5. Optional but recommended: replace the repository's existing `.github/workflows/apply-update-zip.yml` with the separately supplied `apply-update-zip-validate.yml`. That workflow extracts the ZIP into a temporary directory, installs dependencies and runs `npm run build` before it changes the working source files. A failed build leaves the current application source intact.

No existing tables need to be dropped. The migration is additive and safe to run more than once. Keep `PCKT_API_KEY`, `SERPAPI_API_KEY`, `DATABASE_URL` and `CRON_SECRET` as server-side environment variables. `API_SH_KEY` remains optional for the legacy Nike-only routes.

## Environment variables

| Variable | Required for | Notes |
|---|---|---|
| `API_SH_KEY` | Optional legacy Nike endpoints and Nike-only scheduled price checks | API.SH key; keep server-side only |
| `DATABASE_URL` | Watchlist, history, product/search/store caches | Neon pooled PostgreSQL connection string |
| `PCKT_API_KEY` | Marketplace catalog discovery and StockX, GOAT, Flight Club and Kicks Crew comparison | PCKT bearer token; never expose client-side |
| `SERPAPI_API_KEY` | Optional Google Shopping retailer listings | SerpApi key; never expose client-side |
| `CRON_SECRET` | Daily price-check job and protected provider diagnostics | Random secret, at least 32 characters recommended |
| `MAX_DAILY_PRICE_CHECKS` | Optional | Default 10; applies only to Nike product URLs in the legacy price-check job |
| `RATE_LIMIT_SALT` | Legacy optional setting | Retained for compatibility; arbitrary daily visitor search caps are not enforced by v1.9 |

Do not use a `NEXT_PUBLIC_` prefix for any of these secrets.

## Physical-store inventory and online availability

The customer-facing application focuses on product discovery and online retailer comparisons. The nearby-store directory has been removed. Outlet Radar does not currently receive a reliable universal physical-store inventory feed. Marketplace catalog records and online listings are not proof that a selected size can be checked out; shoppers should verify size, price, and availability on the seller's current product page.

## Price monitoring behavior

Vercel Hobby supports Cron Jobs but schedules are limited to once per day, and execution can happen within the configured UTC hour rather than at an exact minute. This starter schedules one daily refresh at 13:17 UTC. The endpoint is protected by `CRON_SECRET` and checks at most 10 saved Nike product URLs per run. Other marketplace/retailer watchlist links are saved but skipped until source-specific price tracking is implemented. Refreshes create one price-history record per checked Nike product per calendar day. The feature records history only; it does not send email, text, or push notifications.

If you add many users, watchlist rows, or manual searches, monitor the PCKT, SerpApi and API.SH usage dashboards as well as Neon/Vercel usage. Visitor searches are not arbitrarily capped, but provider requests still pause when the shared monthly safety budgets are reached. Free tiers are not an unlimited commercial hosting arrangement.

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
  admin/providers/
    page.tsx
    ProviderDashboard.tsx
  api/
    admin/providers/route.ts
    catalog/route.ts
    catalog/offers/route.ts
    catalog/availability/route.ts
    health/route.ts
    cron/price-check/route.ts
  globals.css
  layout.tsx
  page.tsx
db/
  schema.sql
  migrations/
    001_multi_retailer.sql
    002_catalog_inventory.sql
lib/
  catalog-store.ts
  provider-health.ts
  audience.ts
  search-match.ts
  db.ts
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


## Version 1.7 multi-retailer expansion

- Added on-demand search across StockX, GOAT, Flight Club and Kicks Crew through PCKT's free-plan APIs.
- Added optional Google Shopping merchant search through SerpApi for Foot Locker and other merchants that Google returns for the product query.
- Added Neon caching for complete retailer-comparison results (6-hour TTL). Filter controls and typing do not trigger retailer provider calls.
- Added conservative shared monthly budget reservations: 450 PCKT credits and 200 SerpApi searches, and arbitrary daily per-IP visitor search caps were removed. Marketplace calls are disabled when Neon is not available so the shared monthly ceilings remain enforceable.
- Expanded ZIP location search to mapped major sneaker retailers. Physical locations are clearly separated from product inventory and never labeled as in-stock without item-specific evidence.
- All online marketplace/search-engine offers are labeled as unverified for the selected size unless the source provides an explicit size-specific availability field.


## v1.7.1 — Impact website verification

This release adds the Impact website ownership verification meta tag to `app/layout.tsx`. After deploying, return to Impact and click **Add Website** to complete verification. No database migration or new environment variables are required.


## Version 1.8 — Multi-brand catalog discovery

- Added the Product Discovery Catalog as the primary experience. Users select a product type (sneakers/shoes, apparel, accessories) and a brand (or all brands) to discover model names without first searching for each model manually.
- Added catalog discovery through PCKT cached StockX and GOAT search, plus Flight Club and Kicks Crew footwear search; Google Shopping adds broader online merchant results when `SERPAPI_API_KEY` is configured.
- Catalog records from different sources are grouped by style/SKU where possible and can be sent to the existing cross-retailer comparison flow with one action.
- Discovery responses reuse `retailer_search_cache` in Neon for 12 hours. No new SQL migration is required for v1.9 if the v1.7 multi-retailer schema has already been applied.
- Removed the hard daily per-IP caps from direct Nike searches and multi-retailer comparisons. Provider-level monthly budgets and Neon caching remain in place; when a provider budget is exhausted, existing cached records remain available and uncached requests from that source pause.
- Updated branding and page copy so Nike is a secondary direct-search source rather than the product catalog's primary identity.
- Catalog coverage is not exhaustive. Discontinued and older models may appear when indexed by the connected providers; no catalog result guarantees a currently purchasable offer, size, or physical-store stock.


## Version 1.9 — Unified search and catalog refinements

- Replaced the large hero and separate Nike search panel with one compact “What are you hunting for?” search experience.
- Removed the Nike-specific search bar and external Nike store-directory navigation. The nearby-store directory now opens the in-app multi-retailer ZIP locator.
- Added query-aware catalog discovery: a user can type a model name (for example, Jordan 4) or browse by product type and brand. Catalog cache keys now include the model query.
- Added client-side audience, size, color, minimum price, maximum price and sale-only refinements. Changing refinements does not trigger provider calls. A missing source attribute is not treated as a verified match.
- Catalog provider normalization now preserves available price, original price, color, size labels, audience and sale fields when returned by a provider. These fields are optional and remain unavailable when a source does not supply them.
- Catalog items can be saved to the watchlist through the generic HTTPS listing URL handler. The scheduled API.SH price-history job skips non-Nike retailer URLs until source-specific price tracking is implemented.
- No new Neon tables or migration are required; existing `retailer_search_cache` and watchlist tables are reused.


## v1.9.1 interface and filter refinements

This release removes the nearby retailer directory from the customer-facing UI. Product catalog filters now distinguish a known mismatch from missing provider attributes: known mismatches are excluded, while products with unavailable size/color/audience/price/sale metadata remain visible as possible matches with an explicit note. Confirmed attribute matches are sorted first. Product images use square contained frames for consistent display. No SQL migration is required.


## v1.9.1 interface refinements

- Removed the nearby physical-store directory from the customer-facing interface.
- Size, color, audience, price and sale refinements now keep products with missing provider attributes as clearly labelled possible matches; known mismatches are excluded and verified matches rank first.
- Size/color attributes are aggregated from product records and retailer listing records.
- Product card imagery uses square padded frames and `object-fit: contain`.
- No Neon migration or new environment variables are required.


## v2.0.1 audience filtering

Retailer offers and size quotes now respect the selected audience. Men and Women views exclude explicit youth/PS/GS variants, and numeric sizes without a known sizing system are not presented as adult sizes. No database migration is required.
