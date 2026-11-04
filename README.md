# Outlet Radar — Multi-Brand Product Discovery v1.8

A multi-brand product discovery and price-comparison platform built with Next.js, Vercel, and Neon Postgres. Browse sneaker, apparel and accessory catalogs by brand, discover models that have not previously been searched in the app, compare online listings across StockX, GOAT, Flight Club, Kicks Crew and Google Shopping merchants such as Foot Locker, Champs Sports and JD Sports, and find nearby retailer addresses by ZIP code. Catalog and retailer searches are cached in Neon to conserve free API credits.

> **Catalog and inventory limitation:** The catalog is a discovery index, not a complete universal product master. StockX/GOAT/Flight Club/Kicks Crew and Google Shopping can reveal models not previously searched in Outlet Radar, including older/discontinued models when those providers index them. A catalog record is not proof of a current listing or size-level availability. Nearby mapped retailer locations do not prove an item is in stock at those stores.

Outlet Radar is an independent comparison platform and is not affiliated with or endorsed by any brand, retailer, or marketplace displayed.

## Features in this starter

- **Product Discovery Catalog (primary experience):** select a product type (sneakers/shoes, apparel, accessories) and a brand (or all brands) to discover model names directly from connected marketplace and shopping indexes. Models do not need to have been searched in Outlet Radar before; discontinued items may appear when providers still index them.
- **Cross-brand, multi-retailer comparison (on demand):** choose a catalog model and compare online offers from StockX, GOAT, Flight Club, Kicks Crew through PCKT and Google Shopping merchants including Foot Locker, Champs Sports, JD Sports and other returned sellers through SerpApi.
- **Nike direct search (secondary):** retain a dedicated Nike.com product search for users who specifically want Nike's public catalog. This is not the master catalog and does not constrain discovery to currently active Nike products.
- **Online versus store distinction:** marketplace cards identify the seller and show an Online label. A product listing is not treated as proof that a specific size is in stock. Nearby physical retailer locations are shown separately with name, address and straight-line distance; a location card never claims the item is stocked there.
- **Free-tier protection:** catalog and retailer lookups are cached in Neon, with shared monthly safety ceilings of 450 PCKT credits and 200 SerpApi requests. There is no arbitrary daily search cap per visitor; once a provider's monthly safety budget is reached, fresh Neon-cached results remain available until their cache expires, and new uncached requests to that source pause.
- **Nearby sneaker retailers:** the ZIP locator now searches mapped Nike, Foot Locker, Kids Foot Locker, Champs Sports, JD Sports, Finish Line, DICK'S Sporting Goods, Hibbett, Shoe Palace, Snipes, Flight Club, adidas, New Balance, ASICS and PUMA locations.

- Search Nike's US public product listings by product name, model, or style code when the user deliberately chooses the secondary Nike search.
- Sale-only, audience, category and size filters are applied locally after the shared base search has been fetched and cached. Changing these filters does not create another product-search API request.
- Direct Nike product searches are cached for 12 hours. Gender, category, size and sale filters remain local and do not create another product-search request.
- Product image, style code, current price, original price, markdown percentage, audience and online size data when returned by the provider.
- Relevance-filtered search: meaningful search terms must match the returned product title/description/style code, reducing unrelated Nike fallback listings.
- Product suggestions from the Neon catalogue as the user types. Typeahead reads Neon only and does not make paid API requests; a new product appears in suggestions after its first successful search is cached.
- Men, Women, Kids / Youth, and Unisex audience filters; product type, free-entry size filter, sale-only and sort filters are visible before search and also update results after search. Youth sizing is kept separate from adult sizing (for example, 5Y does not equal adult 5). Size filtering is local and does not automatically trigger paid product-detail calls. The shopper explicitly checks sizes one product at a time; product detail responses are cached in Neon for one hour to reduce repeat API usage, and the UI shows the age of the provider check.
- ZIP-code sneaker retailer locator with 5, 10, 25, 50, or 100-mile distance filters and store cards sorted by distance.
- Product-specific **Open product page** handoff. This does not claim that a selected size is available or that a store has the item.
- Persistent Neon caching: the unfiltered base result for an identical model query is reused for 12 hours regardless of audience, size, category or sale filters; product details and online size data are reused for one hour; nearby store locations are reused for 24 hours. The catalogue uses a version marker so partially filtered records created by v1.1 are not mistaken for complete v1.3 catalogues.
- Save products to a browser watchlist; Neon persistence is enabled when `DATABASE_URL` is configured and `db/schema.sql` has been run.
- Daily price history refresh for up to 10 saved product links per day through Vercel Cron (requires `API_SH_KEY`, `DATABASE_URL`, and `CRON_SECRET`).
- No user account or personal information is required. The watchlist uses a random browser-generated visitor ID; clearing browser storage loses the local watchlist unless the database is configured and that visitor ID is retained. Legacy hashed-IP limit tables remain in the schema for compatibility but no daily per-visitor search cap is enforced by v1.8.

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

API.SH is used only for the optional direct Nike.com search and Nike size-detail checks. It is not the source of the main product discovery catalog. Free-credit allowances and pricing are subject to provider changes; check your API.SH dashboard for the exact quota. The app's daily background refresh is limited to 10 saved-product checks. Neon caching avoids repeated model searches and detail lookups. Entering a size filter does not make a provider call. The shopper requests size details per product, and each successful detail response is cached for one hour.

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

The database contains watchlists, price history, legacy hashed search-limit records, Nike direct-search caches, retailer/catalog discovery caches, retailer API monthly-budget counters, a shared PCKT pacing gate, a cached Nike typeahead catalogue, and nearby retailer-location caches. Run the **entire current** `db/schema.sql` in Neon's SQL Editor. It uses `CREATE TABLE IF NOT EXISTS` and `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`, so it can be run again on an existing project without deleting your existing watchlist or history. If Neon is not configured, live product search still works, but persistent search caching and catalog suggestions are unavailable.

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

### Upgrade from v1.7

Replace the repository contents with this v1.8 project and deploy. If you already ran the v1.7 multi-retailer migration, no additional SQL migration is required: v1.8 reuses `retailer_search_cache` for brand/type catalog discovery. If the retailer tables are not installed, run [`db/migrations/001_multi_retailer.sql`](./db/migrations/001_multi_retailer.sql) or the complete current [`db/schema.sql`](./db/schema.sql) in Neon. Add `PCKT_API_KEY` to enable StockX, GOAT, Flight Club and Kicks Crew catalog discovery, and `SERPAPI_API_KEY` to add Google Shopping merchant results such as Foot Locker when returned. `API_SH_KEY` is only needed for the optional direct Nike search and Nike size details.

## Environment variables

| Variable | Required for | Notes |
|---|---|---|
| `API_SH_KEY` | Live Nike product search | API.SH key; keep server-side only |
| `DATABASE_URL` | Watchlist, history, product/search/store caches | Neon pooled PostgreSQL connection string |
| `PCKT_API_KEY` | Marketplace catalog discovery and StockX, GOAT, Flight Club and Kicks Crew comparison | PCKT bearer token; never expose client-side |
| `SERPAPI_API_KEY` | Optional Google Shopping retailer listings | SerpApi key; never expose client-side |
| `CRON_SECRET` | Daily price-check job | Random secret, at least 32 characters recommended |
| `MAX_DAILY_PRICE_CHECKS` | Optional | Default 10; hard-capped at 10 by this starter |
| `RATE_LIMIT_SALT` | Legacy optional setting | Retained for compatibility; arbitrary daily visitor search caps are not enforced by v1.8 |

Do not use a `NEXT_PUBLIC_` prefix for any of these secrets.

## How store availability is handled

Nike's public help page explains that a shopper can open an item's information page, choose a color and size, and use the Pickup section to see participating stores with that item available for pickup. The product card's **Open product page** link opens that Nike product page. The ZIP locator shows nearby store locations directly in the app and gives an optional directions link for each store.

The ZIP locator geocodes a five-digit US ZIP through Zippopotam.us, then finds mapped sneaker-retailer locations through OpenStreetMap Overpass and calculates straight-line distance from the ZIP centroid (not driving distance). Store map data can be incomplete or have missing addresses. The app labels Nike Factory/Clearance stores when those words are present in map data, but does not guarantee that the list contains every outlet or retailer. Nearby store results are cached in Neon for 24 hours.

The multi-retailer comparator intentionally does **not** translate an online catalog listing into confirmed stock. v1.7 returns marketplace/merchant names, listing prices when the source exposes them, images and product links. It does not yet perform per-product variant-detail requests for these marketplaces, so selected-size availability remains unverified. The ZIP locator lists physical store addresses from OpenStreetMap only; it cannot confirm the searched product is stocked at those stores. Foot Locker explicitly says store assortment varies by location and size and recommends calling the store to verify.

The app intentionally does **not** translate online shipping size status into store stock. Nike's public help instructions say shoppers can select a product color and size and review participating stores in the Pickup section. The API.SH Nike product API returns public product and online size information, not a public store-by-store inventory feed. A Nike location card is therefore a nearby store, **not a confirmation that the searched shoe is available there**. The **Open product page** action simply opens the product page; Nike may require the shopper to select the color and size before any Pickup options appear.

## Price monitoring behavior

Vercel Hobby supports Cron Jobs but schedules are limited to once per day, and execution can happen within the configured UTC hour rather than at an exact minute. This starter schedules one daily refresh at 13:17 UTC. The endpoint is protected by `CRON_SECRET` and checks at most 10 watchlist rows per run. Refreshes create one price-history record per product per calendar day. The feature records history only; it does not send email, text, or push notifications.

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
  api/
    cron/price-check/route.ts
    health/route.ts
    product/route.ts
    search/route.ts
    stores/route.ts
    marketplaces/route.ts
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
- Discovery responses reuse `retailer_search_cache` in Neon for 12 hours. No new SQL migration is required for v1.8 if the v1.7 multi-retailer schema has already been applied.
- Removed the hard daily per-IP caps from direct Nike searches and multi-retailer comparisons. Provider-level monthly budgets and Neon caching remain in place; when a provider budget is exhausted, existing cached records remain available and uncached requests from that source pause.
- Updated branding and page copy so Nike is a secondary direct-search source rather than the product catalog's primary identity.
- Catalog coverage is not exhaustive. Discontinued and older models may appear when indexed by the connected providers; no catalog result guarantees a currently purchasable offer, size, or physical-store stock.
