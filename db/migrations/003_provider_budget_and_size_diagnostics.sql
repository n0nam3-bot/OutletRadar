-- Outlet Radar v2.2: per-day budget guardrails and truthful provider size diagnostics.
-- Additive and safe to run more than once.

CREATE TABLE IF NOT EXISTS retailer_api_usage_daily (
  provider VARCHAR(24) NOT NULL,
  usage_day DATE NOT NULL DEFAULT CURRENT_DATE,
  units_reserved NUMERIC(12,2) NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (provider, usage_day)
);
CREATE INDEX IF NOT EXISTS idx_retailer_api_usage_daily_day
  ON retailer_api_usage_daily (usage_day DESC);

ALTER TABLE provider_health ADD COLUMN IF NOT EXISTS last_result_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE provider_health ADD COLUMN IF NOT EXISTS last_size_quote_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE provider_health ADD COLUMN IF NOT EXISTS last_size_matched_offers INTEGER NOT NULL DEFAULT 0;
ALTER TABLE provider_health ADD COLUMN IF NOT EXISTS last_size_persisted_variants INTEGER NOT NULL DEFAULT 0;
ALTER TABLE provider_health ADD COLUMN IF NOT EXISTS last_size_checked_at TIMESTAMPTZ;

-- Reserves daily and monthly budget in a single PostgreSQL transaction. If either
-- limit is reached, no usage is reserved. This prevents parallel requests from
-- racing past the remaining monthly allowance.
CREATE OR REPLACE FUNCTION reserve_retailer_api_budget(
  p_provider TEXT,
  p_units NUMERIC,
  p_monthly_limit NUMERIC,
  p_daily_limit NUMERIC
) RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
DECLARE
  v_day_reserved NUMERIC;
  v_month_reserved NUMERIC;
BEGIN
  IF p_units <= 0 THEN
    RETURN TRUE;
  END IF;

  INSERT INTO retailer_api_usage_daily (provider, usage_day, units_reserved)
  VALUES (p_provider, CURRENT_DATE, 0)
  ON CONFLICT (provider, usage_day) DO NOTHING;

  INSERT INTO retailer_api_usage (provider, usage_month, units_reserved)
  VALUES (p_provider, date_trunc('month', NOW())::date, 0)
  ON CONFLICT (provider, usage_month) DO NOTHING;

  UPDATE retailer_api_usage_daily
    SET units_reserved = units_reserved + p_units, updated_at = NOW()
    WHERE provider = p_provider
      AND usage_day = CURRENT_DATE
      AND units_reserved + p_units <= p_daily_limit
    RETURNING units_reserved INTO v_day_reserved;
  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;

  UPDATE retailer_api_usage
    SET units_reserved = units_reserved + p_units, updated_at = NOW()
    WHERE provider = p_provider
      AND usage_month = date_trunc('month', NOW())::date
      AND units_reserved + p_units <= p_monthly_limit
    RETURNING units_reserved INTO v_month_reserved;
  IF NOT FOUND THEN
    UPDATE retailer_api_usage_daily
      SET units_reserved = GREATEST(0, units_reserved - p_units), updated_at = NOW()
      WHERE provider = p_provider AND usage_day = CURRENT_DATE;
    RETURN FALSE;
  END IF;

  RETURN TRUE;
END;
$$;

COMMENT ON TABLE retailer_api_usage_daily IS 'Daily provider budget reservations used to prevent early-month quota exhaustion.';
COMMENT ON FUNCTION reserve_retailer_api_budget(TEXT, NUMERIC, NUMERIC, NUMERIC) IS 'Atomically reserves both daily and monthly provider usage before an external request.';
