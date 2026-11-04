-- Nike Clearance Finder schema for Neon PostgreSQL.
-- A visitor ID is generated in the browser. No account or personal details are required.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS watched_products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  visitor_id VARCHAR(80) NOT NULL,
  product_url TEXT NOT NULL,
  title VARCHAR(180) NOT NULL,
  image_url TEXT,
  style_code VARCHAR(80),
  current_price NUMERIC(10,2),
  full_price NUMERIC(10,2),
  discount_percent INTEGER,
  currency VARCHAR(8) NOT NULL DEFAULT 'USD',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_checked_at TIMESTAMPTZ,
  UNIQUE(visitor_id, product_url)
);

CREATE INDEX IF NOT EXISTS idx_watched_products_last_checked
  ON watched_products (last_checked_at NULLS FIRST, created_at);

CREATE TABLE IF NOT EXISTS price_history (
  id BIGSERIAL PRIMARY KEY,
  watch_id UUID NOT NULL REFERENCES watched_products(id) ON DELETE CASCADE,
  price NUMERIC(10,2),
  full_price NUMERIC(10,2),
  discount_percent INTEGER,
  currency VARCHAR(8) NOT NULL DEFAULT 'USD',
  checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_price_history_watch_checked
  ON price_history (watch_id, checked_at DESC);


-- Hashed IP-based quota for the public product-search endpoint; raw IP addresses are not stored.
CREATE TABLE IF NOT EXISTS search_rate_limits (
  ip_hash CHAR(64) NOT NULL,
  usage_day DATE NOT NULL DEFAULT CURRENT_DATE,
  request_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (ip_hash, usage_day)
);

-- Shared product cache: avoids spending a provider credit for the same search again.
CREATE TABLE IF NOT EXISTS nike_search_cache (
  cache_key CHAR(64) PRIMARY KEY,
  query_text VARCHAR(120) NOT NULL,
  sale_only BOOLEAN NOT NULL DEFAULT FALSE,
  gender_filter VARCHAR(16) NOT NULL DEFAULT 'all',
  products_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  meta_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  cached_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_nike_search_cache_expiry ON nike_search_cache (expires_at);

-- Cached catalogue powers typeahead suggestions without making a paid API call per keystroke.
CREATE TABLE IF NOT EXISTS nike_product_catalog (
  product_url TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  title VARCHAR(220) NOT NULL,
  subtitle TEXT,
  style_code VARCHAR(100),
  image_url TEXT,
  current_price NUMERIC(10,2),
  full_price NUMERIC(10,2),
  discount_percent INTEGER,
  currency VARCHAR(8) NOT NULL DEFAULT 'USD',
  product_gender VARCHAR(16) NOT NULL DEFAULT 'Unknown',
  product_category VARCHAR(24) NOT NULL DEFAULT 'Other',
  product_json JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_nike_product_catalog_title ON nike_product_catalog (lower(title));
CREATE INDEX IF NOT EXISTS idx_nike_product_catalog_style ON nike_product_catalog (lower(style_code));

-- Cached product details include online sizes, not store-specific inventory.
CREATE TABLE IF NOT EXISTS nike_product_detail_cache (
  product_url TEXT PRIMARY KEY,
  product_json JSONB NOT NULL,
  meta_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  cached_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_nike_product_detail_cache_expiry ON nike_product_detail_cache (expires_at);

-- Cached nearby Nike store locations by ZIP and requested radius.
CREATE TABLE IF NOT EXISTS nike_store_search_cache (
  zip_code CHAR(5) NOT NULL,
  radius_miles INTEGER NOT NULL,
  latitude DOUBLE PRECISION NOT NULL,
  longitude DOUBLE PRECISION NOT NULL,
  stores_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  cached_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (zip_code, radius_miles)
);


ALTER TABLE watched_products ADD COLUMN IF NOT EXISTS product_gender VARCHAR(16) NOT NULL DEFAULT 'Unknown';
ALTER TABLE watched_products ADD COLUMN IF NOT EXISTS product_category VARCHAR(24) NOT NULL DEFAULT 'Other';

-- Shared multi-retailer comparison and product-catalog discovery cache. Comparison records use a six-hour TTL; brand/type catalog records use a twelve-hour TTL.
CREATE TABLE IF NOT EXISTS retailer_search_cache (
  cache_key CHAR(64) PRIMARY KEY,
  query_text VARCHAR(160) NOT NULL,
  results_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  sources_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  cached_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_retailer_search_cache_expiry ON retailer_search_cache (expires_at);

-- Shared, conservative monthly request/credit ceilings for optional external retail APIs.
CREATE TABLE IF NOT EXISTS retailer_api_usage (
  provider VARCHAR(24) NOT NULL,
  usage_month DATE NOT NULL,
  units_reserved NUMERIC(12,2) NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (provider, usage_month)
);

-- Hashed-IP daily protection for uncached retailer comparisons.
CREATE TABLE IF NOT EXISTS marketplace_search_rate_limits (
  ip_hash CHAR(64) NOT NULL,
  usage_day DATE NOT NULL DEFAULT CURRENT_DATE,
  request_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (ip_hash, usage_day)
);

-- Multi-brand sneaker retailer locations; separate from the old Nike-only location cache.
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


-- Shared pacing gate: serializes PCKT requests across Vercel instances at the Free-plan 1 req/s limit.
CREATE TABLE IF NOT EXISTS retailer_provider_request_gate (
  provider VARCHAR(24) PRIMARY KEY,
  next_allowed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
