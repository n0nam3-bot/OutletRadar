# Upgrading Outlet Radar

Releases are delivered as a ZIP and applied by the GitHub Actions workflow in `.github/workflows/apply-update-zip.yml`. Database changes are separate, additive SQL files in `db/migrations/`.

## Standard procedure

1. **Run any new migration first.** In Neon, open the project and branch used by Vercel's `DATABASE_URL` → SQL Editor → New query, and run the new file(s) from the table below. Every migration is additive and safe to run more than once. Never drop or recreate existing tables.
2. **Upload the release ZIP to the root of the GitHub repository** and commit it. Only one ZIP may be at the root.
3. **Let the workflow run.** It extracts the ZIP in a temporary folder, runs `npm install` and `npm run build`, and only if the build passes does it copy the files over the repository and commit them. The ZIP is deleted afterwards.
4. **Confirm Vercel deploys.** The workflow's commit triggers Vercel; wait for the latest deployment to reach **Ready**.
5. **Check `/admin/providers`** (enter your `CRON_SECRET`) to confirm budgets, provider health and the refresh queue appear.

### What the updater does and does not touch
- Files in the ZIP replace the repository's files, and files that are no longer in the ZIP are removed (this is how moved or renamed files disappear).
- `.github/`, `.env*` files, `*.zip` and `node_modules` are never overwritten, so **changes under `.github/` must be made by hand** in the GitHub web editor.
- Secrets live in Vercel and GitHub settings, not in the repository, and are unaffected.

## Which migrations each version needs

| Version | Migration to run | Required? |
|---|---|---|
| v2.3.0 | `004_catalog_refresh_queue.sql` | Recommended. The app works without it, but the refresh queue (and its dashboard card) stay disabled. |
| v2.2.0 | `003_provider_budget_and_size_diagnostics.sql` | Required. Adds the daily budget ledger and the atomic reservation function. |
| v2.1.0 | `002_catalog_inventory.sql` | Required. Adds canonical products, offers, sizes and provider health. |
| v1.7 | `001_multi_retailer.sql` | Required. Retailer search cache and monthly usage. |

For a brand-new database, run the whole of `db/schema.sql` instead of the individual migrations. It is idempotent and always reflects the current schema.

## Upgrading from v2.2.0 to v2.3.0

1. Run `db/migrations/004_catalog_refresh_queue.sql` in Neon.
2. Upload the v2.3 ZIP and wait for the workflow and Vercel deployment.
3. Nothing needs to change in Vercel: the second daily cron (`/api/cron/warm-catalog`) comes from `vercel.json`, and `CRON_SECRET` is already set. Optionally review the new tuning variables in [`.env.example`](../.env.example).
4. Open `/admin/providers` and confirm a **Refresh queue** card appears.
5. Optional: add the more frequent GitHub Actions schedule described in [free-tier-operations.md](./free-tier-operations.md#running-the-warm-up-more-often).

The v2.3 release removes the previously cached empty results automatically (the cache namespace changed), so no manual cache clearing is needed.

## Upgrading from v2.1.0 to v2.2.0

1. Run `db/migrations/003_provider_budget_and_size_diagnostics.sql`. Existing monthly PCKT and SerpApi reservations are preserved; daily reservations begin when the migration is first used. API.SH usage from before v2.2 was not recorded in the application ledger, so compare the API.SH dashboard with the new counter.
2. Upload the ZIP and confirm the deployment.
3. Search a product that has StockX or GOAT listings, open **Compare offers**, then check the size diagnostics on `/admin/providers` (see [free-tier-operations.md](./free-tier-operations.md#reading-the-size-diagnostics)).
