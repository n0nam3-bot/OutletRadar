# Outlet Radar v1.9.3 — Deployment hotfix

- Fixed the availability endpoint's numeric parser to accept multiple candidate fields (Flight Club price fields and fallbacks).
- Preserved first-valid, non-negative numeric selection so price/cents fallback parsing works as intended.
- Added explicit StockX/GOAT source narrowing before calling the provider detail-image lookup, resolving an additional TypeScript type error.
- No database migration or environment-variable changes.
