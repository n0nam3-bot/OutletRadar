# Serving many visitors on free tiers

This guide explains what limits apply when hundreds of people use Outlet Radar, what the app does about them, and what cannot be free.

## The idea

Visitor traffic should never be what spends the scarce resources. Reads (search results, saved catalog, comparisons) are made cheap and effectively unlimited by caching. Fresh provider data, which is limited, is spent in the background on what visitors actually search for. Nobody is blocked: when fresh data is not available the visitor sees saved results with a clear notice.

## How a search is served

1. **CDN (edge).** A complete answer is cached for 10 minutes. Identical searches never reach the server. (`CATALOG_CDN_SECONDS`)
2. **Exact-query cache** in Neon (12 hours).
3. **Shared catalog** in Neon: every product any visitor or feed has ever loaded.
4. **Provider snapshots** (6 to 24 hours), then live providers only if budget allows.
5. **Saved or closest results** when a provider cannot be used. The search is queued and completed by the daily warm-up.

## Where the credits go

The daily warm-up (and `GET /api/cron/ingest-feeds` if you schedule it) spends at most `WARM_DAILY_SHARE` of each provider's daily budget, in this order: queued partial searches, the most-searched filters of the last 7 days, then the static seed list. Anonymous demand counts (`/admin/providers` → Search demand) decide the order. Searches that found nothing are listed so you know what to load next.

## Limits to know

| Resource | Free-tier limit | Effect at scale |
|---|---|---|
| Provider credits (PCKT, SerpApi, Channel3...) | Small monthly allowances | The reason fresh data is rationed. Mitigated by demand-driven refresh and bulk feeds. |
| Neon database | 0.5 GB storage, 100 compute-hours per project per month, compute only free while it scales to zero | CDN and exact-cache hits avoid waking it. Feed ingestion stops at `FEED_MAX_DB_MB`. |
| Vercel Hobby | Non-commercial personal use only | Once you earn affiliate income the site is commercial and needs the Pro plan ($20 per month at the time of writing). |
| Cloudflare Workers Free (if you move the read layer) | 100,000 requests per day, 10 ms CPU per request; D1 5 GB, 5 million row reads and 100,000 row writes per day | A possible edge read layer. Check Cloudflare's terms for commercial use before relying on it. |

## What cannot be free

Per-size resale asks (StockX, GOAT, Flight Club) for thousands of products have no free bulk source. The warm-up covers the most-searched products first; everything else shows saved data. If you want live asks for many more products, that is a paid PCKT tier, best funded by affiliate earnings.

## Checking it works

- Search the same thing twice and look for `x-vercel-cache: HIT` on the second `/api/catalog` response (browser developer tools, Network tab).
- Watch Neon's compute hours in the Neon console: they should grow slowly relative to visits.
- Check `/admin/providers` → Search demand and Refresh queue weekly.

## Next steps if traffic grows a lot

1. A search index (trigram or full-text) on the saved catalog, once it holds more than roughly 100,000 products.
2. An edge read layer (for example Cloudflare D1 or static snapshots of popular searches) so Neon rarely wakes.
3. More feed networks (Rakuten, CJ, Awin) to widen free retail coverage.
4. Paid hosting and provider tiers, funded by affiliate revenue.
