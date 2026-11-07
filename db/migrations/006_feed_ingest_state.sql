-- Outlet Radar v3.2: progress of the optional bulk feed ingestion (one row per advertiser catalog).
-- Additive and repeatable. Ingestion is off unless FEED_INGEST_ENABLED=true.

CREATE TABLE IF NOT EXISTS feed_ingest_state (
  catalog_id TEXT PRIMARY KEY,
  advertiser_name TEXT NOT NULL DEFAULT '',
  next_page INTEGER NOT NULL DEFAULT 1,
  num_pages INTEGER,
  items_seen BIGINT NOT NULL DEFAULT 0,
  products_saved BIGINT NOT NULL DEFAULT 0,
  cycles INTEGER NOT NULL DEFAULT 0,
  last_run_at TIMESTAMPTZ,
  last_error TEXT
);

COMMENT ON TABLE feed_ingest_state IS 'Where the scheduled feed ingestion resumes for each advertiser catalog.';
