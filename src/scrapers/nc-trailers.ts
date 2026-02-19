/**
 * NC Trailers scraper — nctrailers.com
 *
 * NC Trailers runs WooCommerce with a public Store API.
 * We hit the REST API directly (no browser needed) for reliable,
 * structured JSON data including SKU, price, categories, and attributes.
 *
 * API: /wp-json/wc/store/v1/products?per_page=10&page=N
 */

import type { Page } from 'playwright'
import type { RawInventoryItem } from '../types/database.js'
import { BaseScraper } from './base-scraper.js'
import { registerScraper } from './registry.js'

/** Shape of a product from WooCommerce Store API */
interface WcProduct {
  id: number
  name: string
  sku: string
  permalink: string
  on_sale: boolean
  is_in_stock: boolean
  prices: {
    price: string       // cents as string, e.g. "419700"
    regular_price: string
    sale_price: string
    currency_code: string
  }
  categories: Array<{ id: number; name: string; slug: string }>
  attributes: Array<{
    id: number
    name: string
    taxonomy: string
    has_variations: boolean
    terms: Array<{ id: number; name: string; slug: string }>
  }>
  short_description: string
  description: string
}

/** Known trailer makes found on NC Trailers */
const KNOWN_MAKES = [
  'Quality Cargo',
  'Big Tex',
  'Maxx-D',
  'Cynergy',
  'Southland',
  'Nolan',
  'Bedrock',
  'Horizon',
  'Superior Trailers Of GA, Inc',
  'Superior Trailers',
  'Freedom',
  'Gatormade',
  'Continental Cargo',
  'New River',
  'Kaufman',
  'Carry-On',
  'Bravo',
  'Haulmark',
  'Diamond C',
  'PJ Trailers',
  'Load Trail',
  'Sure-Trac',
  'Spartan',
  'Down 2 Earth',
  'Caliber',
  'Covered Wagon',
  'Rock Solid Cargo',
  'Pace American',
  'Nexhaul',
  'Air-Tow',
  'Stehl Tow',
  'HOOPER',
  'Homemade',
  'Cargo Pro',
  'Quality Of Ohio',
]

export class NcTrailersScraper extends BaseScraper {
  name = 'NC Trailers'
  baseUrl = 'https://www.nctrailers.com'

  private apiBase = `${this.baseUrl}/wp-json/wc/store/v1/products`
  private perPage = 10  // Server reliably returns 10 per page

  /**
   * Scrape inventory via WooCommerce Store API.
   * The page param is unused — NC Trailers has a public JSON API.
   */
  async scrapeInventory(_page: Page): Promise<RawInventoryItem[]> {
    const items: RawInventoryItem[] = []
    let currentPage = 1
    let emptyPages = 0

    console.log(`[${this.name}] Fetching inventory via WooCommerce API...`)

    while (true) {
      const url = `${this.apiBase}?per_page=${this.perPage}&page=${currentPage}`

      try {
        const res = await fetch(url)

        if (!res.ok) {
          console.warn(`[${this.name}] API returned ${res.status} on page ${currentPage}, stopping.`)
          break
        }

        const products = (await res.json()) as WcProduct[]

        if (!products || products.length === 0) {
          emptyPages++
          // Two consecutive empty pages = we're done
          if (emptyPages >= 2) break
          currentPage++
          continue
        }

        emptyPages = 0

        for (const product of products) {
          const item = this.parseProduct(product)
          if (item) items.push(item)
        }

        if (currentPage % 10 === 0) {
          console.log(`[${this.name}] Page ${currentPage}: ${items.length} items so far`)
        }

        currentPage++
        // Rate limit: 500-1000ms between requests
        await this.delay(500, 1000)

      } catch (err) {
        console.warn(`[${this.name}] Error on page ${currentPage}: ${err}`)
        // Skip and continue
        currentPage++
        emptyPages++
        if (emptyPages >= 3) break
      }
    }

    console.log(`[${this.name}] Fetched ${items.length} products across ${currentPage - 1} pages`)
    return items
  }

  /** Parse a WooCommerce product into a RawInventoryItem */
  private parseProduct(product: WcProduct): RawInventoryItem | null {
    const sku = product.sku?.trim()
    if (!sku) return null  // Must have SKU

    const title = product.name?.trim() || ''
    const parsed = this.parseTitle(title)
    const attrs = this.extractAttributes(product.attributes)
    const category = product.categories?.[0]?.name || ''

    // Price is in cents as a string (e.g. "419700" = $4,197.00)
    const priceStr = product.prices?.sale_price || product.prices?.price
    const priceNum = priceStr ? parseInt(priceStr, 10) / 100 : null

    // Type: prefer category from API, fall back to title parse
    const type = this.normalizeCategory(category) || parsed.type || null

    // GVWR from title (e.g. "3K GVWR" → "3,000", "10K GVWR" → "10,000")
    const gvwr = this.extractGvwr(title)

    return {
      stock_number: sku,
      title,
      make: parsed.make || undefined,
      model: parsed.model || undefined,
      type: type || undefined,
      price: priceNum,
      condition: attrs.condition || undefined,
      floor_length: attrs.length || parsed.length || undefined,
      gvwr: gvwr || undefined,
      size: parsed.size || undefined,
      url: product.permalink || undefined,
      year: parsed.year || undefined,
      pull_type: parsed.pullType || undefined,
    }
  }

  /** Parse the product title to extract year, make, size, model, etc. */
  private parseTitle(title: string): {
    year?: string
    make?: string
    model?: string
    size?: string
    length?: string
    type?: string
    pullType?: string
  } {
    if (!title) return {}

    // Year: first 4-digit number starting with 19 or 20
    const yearMatch = title.match(/\b(19|20)\d{2}\b/)
    const year = yearMatch?.[0]

    // Remove year from title for further parsing
    let rest = year ? title.replace(year, '').trim() : title

    // Make: match against known makes (longest match first)
    let make: string | undefined
    const sortedMakes = [...KNOWN_MAKES].sort((a, b) => b.length - a.length)
    for (const knownMake of sortedMakes) {
      if (rest.toLowerCase().startsWith(knownMake.toLowerCase())) {
        make = knownMake
        rest = rest.slice(knownMake.length).trim()
        break
      }
    }

    // Size/dimensions: WxL pattern like "6x12", "8.5x16", "7x20"
    const sizeMatch = rest.match(/\b(\d+(?:\.\d+)?)\s*[xX]\s*(\d+(?:\.\d+)?)\b/)
    const size = sizeMatch ? `${sizeMatch[1]}x${sizeMatch[2]}` : undefined
    const length = sizeMatch ? sizeMatch[2] : undefined

    // Model: text between make/size and the first category keyword
    let model: string | undefined
    if (make && !sizeMatch) {
      // No size found — the rest might start with a model number
      const modelMatch = rest.match(/^([A-Z0-9][\w-]*(?:\s+[A-Z0-9][\w-]*)?)/)
      model = modelMatch?.[1]?.trim()
    } else if (sizeMatch) {
      // Text before the size (after make was removed) could be model
      const beforeSize = rest.slice(0, sizeMatch.index).trim()
      if (beforeSize && beforeSize.length < 30) {
        model = beforeSize
      }
    }

    // Type: look for common type keywords in the rest of the title
    const typePats: [RegExp, string][] = [
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
    let type: string | undefined
    for (const [pat, val] of typePats) {
      if (pat.test(title)) { type = val; break }
    }

    // Pull type
    let pullType: string | undefined
    if (/\bgooseneck\b/i.test(title)) pullType = 'Gooseneck'
    else if (/\bbumper\s*pull\b/i.test(title)) pullType = 'Bumper Pull'

    return { year, make, model, size, length, type, pullType }
  }

  /** Extract known attributes from WooCommerce attributes array */
  private extractAttributes(attrs: WcProduct['attributes']): {
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

  /** Normalize WooCommerce category name to standard type */
  private normalizeCategory(cat: string): string | null {
    if (!cat) return null

    const map: Record<string, string> = {
      'enclosed trailers': 'Enclosed',
      'car haulers': 'Car Hauler',
      'dump trailers': 'Dump',
      'utility trailers': 'Utility',
      'equipment trailers': 'Equipment',
      'flatbed trailers': 'Flatbed',
      'gooseneck trailers': 'Gooseneck',
      'truck beds': 'Truck Bed',
      'tilt trailers': 'Tilt',
      'livestock trailers': 'Livestock',
      'roll-off trailers': 'Roll-Off',
      'drop deck trailers': 'Drop Deck',
      'tow dolly': 'Tow Dolly',
      'used trailer': 'Used',
      'used trailers': 'Used',
    }

    return map[cat.toLowerCase()] || null
  }

  /** Extract GVWR from title (e.g. "3K GVWR" → "3,000") */
  private extractGvwr(title: string): string | null {
    const match = title.match(/(\d+(?:\.\d+)?)\s*[kK]\s*(?:GVWR|gvwr)?/)
    if (!match) return null

    const num = parseFloat(match[1]) * 1000
    return num.toLocaleString()
  }
}

// Self-register
registerScraper('nc-trailers', () => new NcTrailersScraper())
