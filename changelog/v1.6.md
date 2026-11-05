# Outlet Radar v1.6

## Search precision
- Added shared strict token matching for search results and suggestions.
- Model numbers are exact tokens: `Air Jordan 1` no longer matches `Air Jordan 14` because of a compact-prefix substring.
- Neon suggestion lookup retrieves a broader candidate set before strict matching, so false-positive model variants do not crowd out the requested model.

## API-credit usage and cache behavior
- Removed automatic size-detail lookups when the shopper enters a size. Size filtering itself now remains local and free.
- Added explicit per-product **Check sizes**. It uses a valid Neon cache entry first and only calls API.SH when no fresh entry exists.
- Product-detail cache lifetime increased from 5 minutes to 60 minutes to reduce repeat provider calls. **Refresh sizes** bypasses the cache deliberately.
- Availability status is aged out in the browser after 60 minutes; a 30-second UI clock ensures stale green/red labels turn unverified while the page remains open.
- Cards show the age of the last provider availability check.

## Database and deployment
- No SQL migration or new environment variable is required. Existing product-detail cache rows older than 60 minutes are ignored automatically.
