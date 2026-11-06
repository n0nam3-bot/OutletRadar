-- Outlet Radar v2.8: anonymous daily click counts on outbound offer links.
-- Stores only the day, source, store name, link host, product title and a count.
-- No IP address, cookie, user agent or full URL is stored. Additive and repeatable.

CREATE TABLE IF NOT EXISTS offer_click_daily (
  click_day DATE NOT NULL DEFAULT CURRENT_DATE,
  source VARCHAR(24) NOT NULL,
  retailer VARCHAR(80) NOT NULL,
  host VARCHAR(120) NOT NULL,
  product_title VARCHAR(160) NOT NULL,
  brand VARCHAR(40) NOT NULL DEFAULT '',
  clicks INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (click_day, source, retailer, host, product_title)
);

CREATE INDEX IF NOT EXISTS idx_offer_click_daily_day ON offer_click_daily (click_day);

COMMENT ON TABLE offer_click_daily IS 'Anonymous per-day outbound click counts by store and product.';
