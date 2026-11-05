# Outlet Radar v2.0.0

## Structured product discovery
- Find it now requires a product description (minimum two characters), an item type, optional brand, audience and optional four-digit release year.
- Size, color, min/max price and sale-only remain local refinements; they do not change the provider query or create extra catalog search calls.

## Grouped models and exact retailer offers
- Retailer listings are consolidated into a product card using normalized brand, category and model tokens.
- Missing audience, release-year or color metadata can be reconciled across compatible listings; conflicting known attributes remain separate variants.
- A matching manufacturer style code can bridge slightly different retailer titles, provided the known attributes do not conflict.
- Compare offers expands inside the selected product card and shows only direct listings for that selected model, with each seller-specific title, price, available size signals and exact retailer URL. Its cache identity includes the grouped listing URLs so newly discovered sellers are not hidden behind an older comparison cache.
- Provider comparison matching now requires the complete normalized model/variant token set to agree (unless the same manufacturer style code is available), rather than only checking that all target words appear in a longer candidate title.
- Similar but non-matching products are intentionally excluded rather than padded into the comparison.

## Caching and migration
- Catalog cache namespace updated to `catalog:v6`.
- Exact offer cache namespace updated to `exact-offers:v5` so previous loosely matched results are not reused.
- No Neon SQL migration or new environment variables required; existing `retailer_search_cache` is reused.
- Impact website-verification meta tag and existing configuration are preserved.

## Validation
- TypeScript/TSX syntax transpilation passed for the application source files.
- Full Next.js production build was not completed in this environment because dependencies were not available for installation; Vercel must perform the final production build check.
