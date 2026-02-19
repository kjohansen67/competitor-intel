-- Competitor Intel — Multi-tenant schema
-- Run this on a NEW Supabase project

-- Companies (clients using the product)
CREATE TABLE companies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  settings JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Competitor sites to scrape (per company)
CREATE TABLE scrape_targets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  competitor_name TEXT NOT NULL,
  website_url TEXT NOT NULL,
  scraper_key TEXT NOT NULL,
  config JSONB DEFAULT '{}',
  is_active BOOLEAN DEFAULT true,
  last_scraped_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (company_id, competitor_name)
);

-- Scraped inventory
CREATE TABLE competitor_inventory (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES companies(id),
  competitor_name TEXT NOT NULL,
  title TEXT,
  make TEXT,
  model TEXT,
  type TEXT,
  price NUMERIC,
  stock_number TEXT NOT NULL,
  condition TEXT,
  status TEXT DEFAULT 'Available',
  floor_length TEXT,
  gvwr TEXT,
  color TEXT,
  pull_type TEXT,
  size TEXT,
  url TEXT,
  scraped_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (company_id, competitor_name, stock_number)
);

-- Change log
CREATE TABLE inventory_changes (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES companies(id),
  competitor_name TEXT NOT NULL,
  trailer_title TEXT,
  stock_number TEXT,
  change_type TEXT NOT NULL,
  old_price NUMERIC,
  new_price NUMERIC,
  detected_at TIMESTAMPTZ DEFAULT now()
);

-- Scrape job log
CREATE TABLE scrape_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  target_id UUID REFERENCES scrape_targets(id),
  started_at TIMESTAMPTZ DEFAULT now(),
  completed_at TIMESTAMPTZ,
  status TEXT DEFAULT 'running',
  items_found INT,
  changes_detected INT,
  error_message TEXT
);

-- Alerts (future)
CREATE TABLE competitor_alerts (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES companies(id),
  alert_name TEXT NOT NULL,
  alert_type TEXT NOT NULL,
  conditions JSONB,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes
CREATE INDEX idx_inventory_company ON competitor_inventory(company_id);
CREATE INDEX idx_inventory_competitor ON competitor_inventory(company_id, competitor_name);
CREATE INDEX idx_inventory_status ON competitor_inventory(company_id, status);
CREATE INDEX idx_inventory_type ON competitor_inventory(company_id, type);
CREATE INDEX idx_inventory_make ON competitor_inventory(company_id, make);
CREATE INDEX idx_changes_company ON inventory_changes(company_id);
CREATE INDEX idx_changes_detected ON inventory_changes(company_id, detected_at DESC);
CREATE INDEX idx_changes_type ON inventory_changes(company_id, change_type);
CREATE INDEX idx_targets_company ON scrape_targets(company_id);
CREATE INDEX idx_jobs_company ON scrape_jobs(company_id);

-- Aggregation views
CREATE VIEW competitor_inventory_summary AS
SELECT company_id, competitor_name, COUNT(*) as unit_count, MAX(scraped_at) as last_scraped
FROM competitor_inventory WHERE status = 'Available'
GROUP BY company_id, competitor_name
ORDER BY unit_count DESC;

CREATE VIEW competitor_price_summary AS
SELECT company_id, competitor_name, type,
  ROUND(AVG(price))::int as avg_price,
  MIN(price)::int as min_price,
  MAX(price)::int as max_price,
  COUNT(*) as unit_count
FROM competitor_inventory
WHERE status = 'Available' AND price > 0 AND type IS NOT NULL AND price IS NOT NULL
GROUP BY company_id, competitor_name, type;

CREATE VIEW competitor_brand_counts AS
SELECT company_id, make, competitor_name, COUNT(*) as unit_count
FROM competitor_inventory
WHERE status = 'Available' AND make IS NOT NULL
GROUP BY company_id, make, competitor_name;
