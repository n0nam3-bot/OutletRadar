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
