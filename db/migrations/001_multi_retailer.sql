-- Outlet Radar v1.7 multi-retailer migration. Safe to run against an existing v1.6 Neon database.
CREATE TABLE IF NOT EXISTS retailer_search_cache (
  cache_key CHAR(64) PRIMARY KEY,
  query_text VARCHAR(160) NOT NULL,
  results_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  sources_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  cached_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_retailer_search_cache_expiry ON retailer_search_cache (expires_at);
CREATE TABLE IF NOT EXISTS retailer_api_usage (
  provider VARCHAR(24) NOT NULL,
  usage_month DATE NOT NULL,
  units_reserved NUMERIC(12,2) NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (provider, usage_month)
);
CREATE TABLE IF NOT EXISTS marketplace_search_rate_limits (
  ip_hash CHAR(64) NOT NULL,
  usage_day DATE NOT NULL DEFAULT CURRENT_DATE,
  request_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (ip_hash, usage_day)
);
CREATE TABLE IF NOT EXISTS retailer_store_search_cache (
  zip_code CHAR(5) NOT NULL,
  radius_miles INTEGER NOT NULL,
  latitude DOUBLE PRECISION NOT NULL,
  longitude DOUBLE PRECISION NOT NULL,
  stores_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  cached_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (zip_code, radius_miles)
);

CREATE TABLE IF NOT EXISTS retailer_provider_request_gate (
  provider VARCHAR(24) PRIMARY KEY,
  next_allowed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
