/**
 * NC Trailers mapping — WooCommerce products → InventoryItem[].
 *
 * Extracted from: src/scrapers/nc-trailers.ts
 */

import type { DealerConfig, InventoryItem } from '../../src/schema/inventory-item.js'
import type { WcProduct } from '../../src/platforms/woocommerce-store-api.js'

/** Known trailer makes found on NC Trailers (longest first for greedy match) */
const KNOWN_MAKES = [
  'Superior Trailers Of GA, Inc',
  'Superior Trailers',
  'Quality Cargo',
  'Continental Cargo',
  'Rock Solid Cargo',
  'Quality Of Ohio',
  'Pace American',
  'Down 2 Earth',
  'Covered Wagon',
  'PJ Trailers',
  'Load Trail',
  'Diamond C',
  'Stehl Tow',
  'Cargo Pro',
  'Sure-Trac',
  'Carry-On',
  'Big Tex',
  'Maxx-D',
  'Air-Tow',
  'Nexhaul',
  'Cynergy',
  'Southland',
  'Nolan',
  'Bedrock',
  'Horizon',
  'Freedom',
  'Gatormade',
  'New River',
  'Kaufman',
  'Bravo',
  'Haulmark',
  'Spartan',
  'Caliber',
  'HOOPER',
  'Homemade',
  'Galvanized',
  'Look Trailers',
]

/** WooCommerce category → standard type */
const CATEGORY_MAP: Record<string, string> = {
  'enclosed trailers': 'Enclosed',
  'cargo / enclosed trailer': 'Enclosed',
  'car haulers': 'Car Hauler',
  'car hauler trailers': 'Car Hauler',
  'car / racing trailer': 'Car Hauler',
  'dump trailers': 'Dump',
  'utility trailers': 'Utility',
  'landscape / utility trailers': 'Utility',
  'landscape trailer': 'Utility',
  'equipment trailers': 'Equipment',
  'equipment trailer': 'Equipment',
  'flatbed trailers': 'Flatbed',
  'gooseneck trailers': 'Gooseneck',
  'truck beds': 'Truck Bed',
  'tilt trailers': 'Tilt',
  'tilt trailer': 'Tilt',
  'livestock trailers': 'Livestock',
  'horse trailer': 'Livestock',
  'stock / stock combo trailer': 'Livestock',
  'roll-off trailers': 'Roll-Off',
  'drop deck trailers': 'Drop Deck',
  'tow dolly': 'Tow Dolly',
  'specialty trailers': 'Specialty',
  'farm / ranch': 'Farm/Ranch',
  'used trailer': 'Used',
  'used trailers': 'Used',
}

/** Type keyword patterns for title fallback */
const TYPE_PATTERNS: [RegExp, string][] = [
  [/\benclosed\b/i, 'Enclosed'],
  [/\bcargo\b/i, 'Enclosed'],
  [/\butility\b/i, 'Utility'],
  [/\blandscape\b/i, 'Utility'],
  [/\bdump\b/i, 'Dump'],
  [/\bcar\s*hauler\b/i, 'Car Hauler'],
  [/\bequipment\b/i, 'Equipment'],
  [/\bflatbed\b/i, 'Flatbed'],
  [/\btilt\b/i, 'Tilt'],
  [/\bgooseneck\b/i, 'Gooseneck'],
  [/\bconcession\b/i, 'Enclosed'],
  [/\bvending\b/i, 'Enclosed'],
  [/\btruck\s*bed\b/i, 'Truck Bed'],
  [/\broll.off\b/i, 'Roll-Off'],
  [/\bdrop\s*deck\b/i, 'Drop Deck'],
  [/\btow\s*dolly\b/i, 'Tow Dolly'],
]

function titleCase(str: string): string {
  return str
    .toLowerCase()
    .split(' ')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

function parseTitle(title: string): {
  year?: string
  make?: string
  model?: string
  size?: string
  length?: string
  type?: string
  pullType?: string
} {
  if (!title) return {}

  // Year
  const yearMatch = title.match(/\b(19|20)\d{2}\b/)
  const year = yearMatch?.[0]
  let rest = year ? title.replace(year, '').trim() : title

  // Make (longest match first — array is pre-sorted)
  let make: string | undefined
  for (const knownMake of KNOWN_MAKES) {
    if (rest.toLowerCase().startsWith(knownMake.toLowerCase())) {
      make = knownMake
      rest = rest.slice(knownMake.length).trim()
      break
    }
  }

  // Size: WxL pattern
  const sizeMatch = rest.match(/\b(\d+(?:\.\d+)?)\s*[xX]\s*(\d+(?:\.\d+)?)\b/)
  const size = sizeMatch ? `${sizeMatch[1]}x${sizeMatch[2]}` : undefined
  const length = sizeMatch ? sizeMatch[2] : undefined

  // Model
  let model: string | undefined
  if (make && !sizeMatch) {
    const modelMatch = rest.match(/^([A-Z0-9][\w-]*(?:\s+[A-Z0-9][\w-]*)?)/)
    model = modelMatch?.[1]?.trim()
  } else if (sizeMatch) {
    const beforeSize = rest.slice(0, sizeMatch.index).trim()
    if (beforeSize && beforeSize.length < 30) model = beforeSize
  }

  // Type from keywords
  let type: string | undefined
  for (const [pat, val] of TYPE_PATTERNS) {
    if (pat.test(title)) { type = val; break }
  }

  // Pull type
  let pullType: string | undefined
  if (/\bgooseneck\b/i.test(title)) pullType = 'Gooseneck'
  else if (/\bbumper\s*pull\b/i.test(title)) pullType = 'Bumper Pull'

  return { year, make, model, size, length, type, pullType }
}

function extractGvwr(title: string): string | null {
  const match = title.match(/(\d+(?:\.\d+)?)\s*[kK]\s*(?:GVWR|gvwr)?/)
  if (!match) return null
  const num = parseFloat(match[1]) * 1000
  return num.toLocaleString()
}

function extractAttributes(attrs: WcProduct['attributes']): {
  condition?: string
  length?: string
  location?: string
} {
  const result: { condition?: string; length?: string; location?: string } = {}
  for (const attr of attrs || []) {
    const name = attr.name?.toLowerCase()
    const value = attr.terms?.[0]?.name
    if (!value) continue
    if (name === 'condition') result.condition = value
    else if (name === 'length') result.length = value
    else if (name === 'location') result.location = value
  }
  return result
}

function normalizeCategory(cat: string): string | null {
  if (!cat) return null
  return CATEGORY_MAP[cat.toLowerCase()] || null
}

/** Map raw WcProduct[] → InventoryItem[] */
export function mapRawItems(rawItems: unknown[], dealer: DealerConfig): InventoryItem[] {
  const now = new Date().toISOString()
  const products = rawItems as WcProduct[]
  const items: InventoryItem[] = []

  for (const product of products) {
    const sku = product.sku?.trim()
    if (!sku) continue

    const title = product.name?.trim() || ''
    const parsed = parseTitle(title)
    const attrs = extractAttributes(product.attributes)
    const category = product.categories?.[0]?.name || ''

    // Price (cents → dollars)
    const priceStr = product.prices?.sale_price || product.prices?.price
    const price = priceStr ? parseInt(priceStr, 10) / 100 : null
    const regularStr = product.prices?.regular_price
    const msrp = regularStr ? parseInt(regularStr, 10) / 100 : null
    const salePrice = product.on_sale && product.prices?.sale_price
      ? parseInt(product.prices.sale_price, 10) / 100
      : null

    const type = normalizeCategory(category) || parsed.type || null
    const gvwr = extractGvwr(title)

    items.push({
      dealerSlug: dealer.slug,
      sourceUrl: product.permalink || `${dealer.baseUrl}/?p=${product.id}`,
      stockNumber: sku,
      year: parsed.year || null,
      condition: attrs.condition || null,
      make: parsed.make ? titleCase(parsed.make) : null,
      model: parsed.model?.trim() || null,
      type,
      size: parsed.size || null,
      price: price && price > 0 ? price : null,
      msrp: msrp && msrp > 0 ? msrp : null,
      salePrice: salePrice && salePrice > 0 ? salePrice : null,
      gvwr: gvwr || null,
      vin: null,
      location: attrs.location || null,
      status: 'Available',
      scrapedAt: now,
      specs: {
        ...(parsed.pullType ? { pullType: parsed.pullType } : {}),
        ...(parsed.length ? { length: parsed.length } : {}),
        ...(attrs.length ? { floorLength: attrs.length } : {}),
      },
    })
  }

  return items
}
