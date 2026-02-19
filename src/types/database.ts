// Core types for the competitor-intel project

export interface Company {
  id: string
  name: string
  slug: string
  settings: Record<string, unknown>
  created_at: string
}

export interface ScrapeTarget {
  id: string
  company_id: string
  competitor_name: string
  website_url: string
  scraper_key: string
  config: Record<string, unknown>
  is_active: boolean
  last_scraped_at: string | null
  created_at: string
}

export interface InventoryItem {
  id: number
  company_id: string
  competitor_name: string
  title: string | null
  make: string | null
  model: string | null
  type: string | null
  price: number | null
  stock_number: string
  condition: string | null
  status: string
  floor_length: string | null
  gvwr: string | null
  color: string | null
  pull_type: string | null
  size: string | null
  url: string | null
  scraped_at: string
  created_at: string
  updated_at: string
}

export interface InventoryChange {
  id: number
  company_id: string
  competitor_name: string
  trailer_title: string | null
  stock_number: string | null
  change_type: 'NEW_LISTING' | 'PRICE_DROP' | 'PRICE_INCREASE' | 'REMOVED'
  old_price: number | null
  new_price: number | null
  detected_at: string
}

export interface ScrapeJob {
  id: string
  company_id: string
  target_id: string | null
  started_at: string
  completed_at: string | null
  status: 'running' | 'success' | 'failed'
  items_found: number | null
  changes_detected: number | null
  error_message: string | null
}

/** Raw item scraped from a website before normalization */
export interface RawInventoryItem {
  title?: string
  make?: string
  model?: string
  type?: string
  price?: string | number | null
  stock_number: string
  condition?: string
  floor_length?: string
  gvwr?: string
  color?: string
  pull_type?: string
  size?: string
  url?: string
  year?: string
}

/** Cleaned item ready for DB insertion */
export interface CleanInventoryItem {
  company_id: string
  competitor_name: string
  title: string | null
  make: string | null
  model: string | null
  type: string | null
  price: number | null
  stock_number: string
  condition: string | null
  status: string
  floor_length: string | null
  gvwr: string | null
  color: string | null
  pull_type: string | null
  size: string | null
  url: string | null
  scraped_at: string
  updated_at: string
}
