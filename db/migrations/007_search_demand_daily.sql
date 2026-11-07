-- Outlet Radar v3.4: anonymous daily search counts, used to refresh the most-searched products first.
-- Stores only the day, the search filters, the lowercase search words, how often it was searched and how
-- often it found nothing. No IP address, cookie or user agent. Additive and repeatable.

CREATE TABLE IF NOT EXISTS search_demand_daily (
  search_day DATE NOT NULL DEFAULT CURRENT_DATE,
  category VARCHAR(16) NOT NULL,
  brand VARCHAR(32) NOT NULL,
  gender VARCHAR(12) NOT NULL DEFAULT 'all',
  release_year INTEGER NOT NULL DEFAULT 0,
  query_text VARCHAR(100) NOT NULL,
  searches INTEGER NOT NULL DEFAULT 1,
  empty_results INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (search_day, category, brand, gender, release_year, query_text)
);

CREATE INDEX IF NOT EXISTS idx_search_demand_daily_day ON search_demand_daily (search_day);

COMMENT ON TABLE search_demand_daily IS 'Anonymous per-day search counts used to prioritise catalog refreshes. Pruned after 60 days.';
