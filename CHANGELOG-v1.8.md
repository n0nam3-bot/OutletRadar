# Outlet Radar v1.8

## Retailer-neutral product catalog
- Added a retailer-neutral Product Discovery Catalog with product-type and brand selectors.
- Brand/type browsing discovers model names directly from PCKT cached StockX and GOAT catalogs and, for footwear, Flight Club and Kicks Crew search. Google Shopping can add product/merchant entries. A model does not need to have been searched in Outlet Radar first.
- Groups catalog records by style/SKU where possible and connects a chosen model to the existing multi-retailer comparison flow.
- Reuses the existing `retailer_search_cache` table with a 12-hour catalog browse cache. No new Neon migration is required when the v1.7 retailer schema is already installed.
- Removed arbitrary daily per-IP limits for direct Nike searches and retailer comparisons. Monthly shared provider budget ceilings remain.
- Repositioned Nike direct search as a secondary source.

## Important limitations
- Product discovery depends on connected data providers and their indexed catalog coverage. It is not a complete master list of every product ever released.
- Older/discontinued models can be discovered when included in a provider's catalog, but catalog presence is not proof of active offers or size-specific stock.
- Google Shopping merchant results vary by query and are not guaranteed for every retailer.

- Added human-readable provider search terms for brand names such as Under Armour so provider queries use retail spelling.
