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


-- v2.1 normalized product, retailer offer, size variant and provider health tables.
-- Outlet Radar v2.1: normalized canonical products, retailer offers, size variants,
-- and provider reliability telemetry. Safe to run more than once.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- One row per canonical colorway/release (not merely a broad model family).
CREATE TABLE IF NOT EXISTS canonical_products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  identity_key CHAR(64) NOT NULL UNIQUE,
  brand_name VARCHAR(100) NOT NULL,
  category VARCHAR(24) NOT NULL,
  product_title VARCHAR(240) NOT NULL,
  style_code VARCHAR(100),
  release_year INTEGER,
  colorway VARCHAR(180),
  audience VARCHAR(16) NOT NULL DEFAULT 'Unknown',
  image_url TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_canonical_products_brand_category
  ON canonical_products (lower(brand_name), category);
CREATE INDEX IF NOT EXISTS idx_canonical_products_style_code
  ON canonical_products (lower(style_code)) WHERE style_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_canonical_products_title
  ON canonical_products (lower(product_title));
CREATE INDEX IF NOT EXISTS idx_canonical_products_last_seen
  ON canonical_products (last_seen_at DESC);

-- Each retailer URL is an individual offer, attached to one canonical colorway/release.
CREATE TABLE IF NOT EXISTS retailer_offers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES canonical_products(id) ON DELETE CASCADE,
  source VARCHAR(24) NOT NULL,
  retailer_name VARCHAR(120) NOT NULL,
  provider_product_id VARCHAR(160),
  listing_url TEXT NOT NULL,
  listing_title VARCHAR(300) NOT NULL,
  image_url TEXT,
  style_code VARCHAR(100),
  colorway VARCHAR(180),
  audience VARCHAR(16) NOT NULL DEFAULT 'Unknown',
  release_year INTEGER,
  price NUMERIC(12,2),
  original_price NUMERIC(12,2),
  currency VARCHAR(8) NOT NULL DEFAULT 'USD',
  condition_label VARCHAR(40) NOT NULL DEFAULT 'Unknown',
  availability_state VARCHAR(16) NOT NULL DEFAULT 'unknown',
  availability_label VARCHAR(300),
  source_updated_at TIMESTAMPTZ,
  last_checked_at TIMESTAMPTZ,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT retailer_offers_availability_state_check
    CHECK (availability_state IN ('available','unavailable','unknown','stale')),
  CONSTRAINT retailer_offers_source_url_unique UNIQUE (source, listing_url)
);
CREATE INDEX IF NOT EXISTS idx_retailer_offers_product
  ON retailer_offers (product_id, last_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_retailer_offers_provider_product
  ON retailer_offers (source, provider_product_id) WHERE provider_product_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_retailer_offers_price
  ON retailer_offers (price) WHERE price IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_retailer_offers_expiry
  ON retailer_offers (expires_at) WHERE expires_at IS NOT NULL;

-- A size label is not an availability claim unless a source explicitly reports it.
CREATE TABLE IF NOT EXISTS retailer_offer_sizes (
  id BIGSERIAL PRIMARY KEY,
  offer_id UUID NOT NULL REFERENCES retailer_offers(id) ON DELETE CASCADE,
  size_label VARCHAR(40) NOT NULL,
  normalized_size VARCHAR(40),
  size_system VARCHAR(16) NOT NULL DEFAULT 'unknown',
  availability_state VARCHAR(16) NOT NULL DEFAULT 'unknown',
  price NUMERIC(12,2),
  currency VARCHAR(8) NOT NULL DEFAULT 'USD',
  source_status VARCHAR(240),
  last_checked_at TIMESTAMPTZ,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT retailer_offer_sizes_state_check
    CHECK (availability_state IN ('available','unavailable','unknown','stale')),
  CONSTRAINT retailer_offer_sizes_system_check
    CHECK (size_system IN ('men','women','youth','toddler','infant','unisex','unknown')),
  CONSTRAINT retailer_offer_sizes_unique UNIQUE (offer_id, size_label, size_system)
);
CREATE INDEX IF NOT EXISTS idx_retailer_offer_sizes_lookup
  ON retailer_offer_sizes (offer_id, size_system, normalized_size);
CREATE INDEX IF NOT EXISTS idx_retailer_offer_sizes_availability
  ON retailer_offer_sizes (availability_state, expires_at);

-- Circuit-breaker and operational telemetry, one row per integration/provider.
CREATE TABLE IF NOT EXISTS provider_health (
  provider VARCHAR(32) PRIMARY KEY,
  last_attempt_at TIMESTAMPTZ,
  last_success_at TIMESTAMPTZ,
  last_error_at TIMESTAMPTZ,
  last_error_code VARCHAR(80),
  last_error_message VARCHAR(500),
  last_latency_ms INTEGER,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  disabled_until TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_provider_health_disabled_until
  ON provider_health (disabled_until);

COMMENT ON TABLE canonical_products IS 'Outlet Radar canonical product/colorway/release catalog. A record is not stock confirmation.';
COMMENT ON TABLE retailer_offers IS 'Individual retailer or marketplace listings tied to canonical products.';
COMMENT ON TABLE retailer_offer_sizes IS 'Normalized size variants; only explicit source signals can set available/unavailable.';
COMMENT ON TABLE provider_health IS 'Provider circuit-breaker and reliability telemetry; contains no API secrets.';
