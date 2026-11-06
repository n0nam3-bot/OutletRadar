# Roadmap

Planned direction after v2.3. Order reflects dependencies: data supply and reliability first, then features that depend on it, then monetization and scale.

| Release | Focus | Why this order |
|---|---|---|
| v2.6 | **Bulk free sources:** affiliate product feeds (Impact, already verified, plus any other network you join) loaded nightly into Neon | The PCKT/SerpApi/Channel3 free allowances are the ceiling on what the site can show. A bulk, free source removes it. Check each source's license terms. |
| v2.7 | **Click-out redirect** (`/go/<offer>`) with affiliate link wrapping and click logging | Cheap, and the click data shows which products deserve warm-up credits. Review Vercel and provider terms for commercial use before enabling; plan for paid hosting. |
| v2.8 | **Saved searches and price-drop emails**, refreshing only watched products | Refreshing watched items costs far fewer credits than a global refresh. Uses a free email tier. |
| v2.9 | **Size-level accuracy** for StockX, GOAT and Flight Club, on demand and limited to watched or clicked products | Size lookups spend the same scarce credits, so they come after the supply and refresh work. |
| v3.0 | **Scale:** paid provider plans, hosting and database sized for commercial traffic | Triggered by real traffic or revenue, not by a date. |

Shipped so far: v2.3 never-empty search and warm-up, v2.4 Nike.com and Channel3 cross-store comparison, v2.5 eBay listings in Compare.

An earnings dashboard is intentionally not planned: the affiliate networks already provide one.
