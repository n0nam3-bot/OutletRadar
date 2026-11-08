# Tests

`npm test` runs every check (about 230) against the real application code. No Neon account, network access or API keys are needed.

- The database is an in-memory PostgreSQL ([PGlite](https://pglite.dev/)) behind the same interface as the Neon client, installed by `tests/harness.mts` through the small `setTestDatabase` hook in `lib/db.ts`. The full `db/schema.sql` and every file in `db/migrations/` are applied twice to prove they are repeatable.
- Providers (PCKT, SerpApi, API.SH, Channel3, eBay, Impact) are simulated by replacing `fetch`, so the tests also show exactly which requests the app makes.

| File | What it covers |
|---|---|
| `pipeline.mts` | Search pipeline, caching, budgets, fallbacks, warm-up, queue, Nike/Channel3/eBay/Impact sources, feed ingestion, click and search counters, affiliate links, edge-cache headers, fresh-lookup limit |
| `sizes.mts` | Size parsing, men's/women's/kids' scales, conversion rules, per-seller size prices and price filtering |
| `saved.mts` | Browser-only saved searches and price-drop detection |
| `legal.mts` | Site settings, robots.txt, sitemap, security headers |
| `limit.mts` | Per-connection fresh-lookup limiter |

A test file is a plain script that prints `PASS` or `FAIL` lines. To run one: `npx tsx tests/sizes.mts`.

Not covered: real provider responses, the browser, and Vercel's network. Use `/admin/providers` → Run connection test and Preview Impact feeds for the providers.

## Running the tests on every update (optional)

The update workflow in `.github/workflows/apply-update-zip.yml` builds the project before applying it. To also run the tests, add `npm test` after the build step in that file (workflow files can only be edited by hand in GitHub, not through the update ZIP).
