/**
 * Shared InventoryItem schema — all platform adapters normalize into this.
 * This is the single output shape for CSV, summary.json, and future DB writes.
 */

export interface InventoryItem {
  dealerSlug: string
  sourceUrl: string
  stockNumber: string
  year: string | null
  condition: string | null
  make: string | null
  model: string | null
  type: string | null
  size: string | null
  price: number | null
  msrp: number | null
  salePrice: number | null
  gvwr: string | null
  vin: string | null
  location: string | null
  status: string
  scrapedAt: string
  specs: Record<string, string>
  rawPlatform?: unknown
}

export interface DealerConfig {
  slug: string
  name: string
  platform: 'woocommerce' | 'trailerfunnel' | 'dealsector' | 'dealerspike'
  baseUrl: string
  inventoryPath: string
  expectedMin?: number
  platformConfig?: Record<string, unknown>
}

/** Type for a dealer's map module — exported from each skills/<dealer>/map.ts */
export interface DealerMap {
  mapRawItems(rawItems: unknown[], dealer: DealerConfig): InventoryItem[]
}
