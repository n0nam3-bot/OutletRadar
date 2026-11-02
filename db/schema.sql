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
