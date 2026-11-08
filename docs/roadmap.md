# Roadmap

Planned direction after v3.2. Order reflects dependencies: confirm the data sources work, then the features that depend on them, then monetization and scale.

**Shipped so far:** v2.3 never-empty search and warm-up, v2.4 Nike.com and Channel3 cross-store comparison, v2.5 eBay listings in Compare, v2.6 Impact partner catalogs in Compare, v2.7 admin live connection test, v2.8 anonymous outbound click counts, v2.9 affiliate link templates, v3.0 accurate size filtering with per-size prices, v3.1 browser-only saved searches with price-drop tracking, v3.2 optional Impact feed ingestion, v3.3 single gender control with best price for your size across all sources, v3.4 edge caching, anonymous search demand and demand-driven refresh, v3.5 privacy page, affiliate disclosure and site hygiene.

| Release | Focus | Why this order |
|---|---|---|
| v3.5 | **Confirm and tune live integrations** using the connection test and feed preview results (Channel3, eBay, Impact, API.SH), and adjust any mapping that differs from the documentation | Several integrations were built from published documentation and tested against simulated responses. |
| v3.6 | **More feed networks** (Rakuten, CJ, Awin) using the same ingestion pipeline | Impact ingestion is in place; each network needs its own API mapping and approved programs. |
| v3.7 | **E-mail price-drop alerts** for saved searches | Needs a sending service with a verified domain, double opt-in, unsubscribe links, a postal address and stored e-mail addresses. Browser-only saved searches already work. |
| v3.8 | **Edge read layer and search index** (static snapshots or D1 for popular searches; trigram/full-text index on the saved catalog) | Only needed when traffic or the catalog grows a lot; see docs/scaling.md. |
| v3.9 | **Wider size coverage:** live size prices beyond the first 20 results and for retailer listings | Size matching and pricing are in place; coverage is limited by provider credits. |
| v3.10 | **Commercial readiness, remainder:** confirm Vercel and each provider's terms allow commercial use, move to paid hosting where required, review the privacy and disclosure pages for your country | The privacy and disclosure pages exist (v3.5); the remaining work is terms and hosting. |
| v4.0 | **Scale:** paid provider plans, hosting and database sized for commercial traffic | Triggered by real traffic or revenue, not by a date. |

An earnings dashboard is intentionally not planned: the affiliate networks already provide one.
