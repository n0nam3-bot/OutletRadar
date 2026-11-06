# Roadmap

Planned direction after v2.3. Order reflects dependencies: data supply and reliability first, then features that depend on it, then monetization and scale.

| Release | Focus | Why this order |
|---|---|---|
| v2.7 | **Bulk affiliate feeds into Neon** (nightly, filtered to footwear) so catalog browse, not only Compare, shows brand and store offers | Needs approved programs and a storage plan for Neon's 0.5 GB. Other networks (Rakuten, CJ, Awin) could be added the same way as Impact. |
| v3.0 | **Review commercial readiness:** Vercel and provider terms, paid hosting, a privacy policy and affiliate disclosures | Affiliate links (v2.9) and click counts (v2.8) are in place; before relying on revenue, confirm every service's terms allow commercial use. |
| v3.1 | **Saved searches and price-drop emails**, refreshing only watched products | Refreshing watched items costs far fewer credits than a global refresh. Uses a free email tier. |
| v3.2 | **Size-level accuracy** for StockX, GOAT and Flight Club, on demand and limited to watched or clicked products | Size lookups spend the same scarce credits, so they come after the supply and refresh work. |
| v3.3 | **Scale:** paid provider plans, hosting and database sized for commercial traffic | Triggered by real traffic or revenue, not by a date. |

Shipped so far: v2.3 never-empty search and warm-up, v2.4 Nike.com and Channel3 cross-store comparison, v2.5 eBay listings in Compare, v2.6 Impact partner catalogs in Compare, v2.7 admin live connection test, v2.8 anonymous outbound click counts, v2.9 affiliate link templates.

An earnings dashboard is intentionally not planned: the affiliate networks already provide one.
