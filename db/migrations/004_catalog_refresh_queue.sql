-- Outlet Radar v2.3: refresh queue for searches that could not be served completely
-- (daily/monthly provider budget used up, provider paused or erroring, optional
-- sources skipped). The scheduled warm-up job completes them with leftover free-tier
-- credits. Additive and safe to run more than once.

CREATE TABLE IF NOT EXISTS catalog_refresh_queue (
  cache_key TEXT PRIMARY KEY,
  category VARCHAR(16) NOT NULL,
  brand VARCHAR(32) NOT NULL,
  gender VARCHAR(12) NOT NULL DEFAULT 'all',
  release_year INTEGER,
  query_text VARCHAR(100) NOT NULL,
  reason VARCHAR(32) NOT NULL DEFAULT 'degraded',
  request_count INTEGER NOT NULL DEFAULT 1,
  attempts INTEGER NOT NULL DEFAULT 0,
  first_requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_attempt_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_catalog_refresh_queue_pending
  ON catalog_refresh_queue (request_count DESC, first_requested_at ASC)
  WHERE completed_at IS NULL;

COMMENT ON TABLE catalog_refresh_queue IS 'Searches awaiting a complete provider refresh by the scheduled warm-up job.';
