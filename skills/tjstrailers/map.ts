/**
 * TJ's Trailers mapping — DealSector listings → InventoryItem[].
 *
 * Title format: "DIAMOND C 8X35+5 GOOSENECK EQUIPMENT TRAILER"
 * No year in title — year comes from the details table.
 *
 * Extracted from: src/scrapers/tjs-trailers.ts
 */

import type { DealerConfig, InventoryItem } from '../../src/schema/inventory-item.js'
import type { DsListing } from '../../src/platforms/dealsector-ajax.js'

/** Multi-word makes (checked first) */
const MULTI_WORD_MAKES = /^(DIAMOND C|BIG TEX|LOAD TRAIL|DOWN 2|SURE.TRAC|IRON BULL|TOP HAT)/i

/** Type keyword patterns */
const TYPE_PATTERNS: [RegExp, string][] = [
  [/\bUTILITY\b/i, 'Utility'],
  [/\bLANDSCAPE\b/i, 'Utility'],
  [/\bENCLOSED\b/i, 'Enclosed'],
  [/\bCARGO\b/i, 'Enclosed'],
  [/\bDUMP\b/i, 'Dump'],
  [/\bCAR\s*HAULER\b/i, 'Car Hauler'],
  [/\bEQUIPMENT\b/i, 'Equipment'],
  [/\bFLATBED\b/i, 'Flatbed'],
  [/\bTILT\b/i, 'Tilt'],
  [/\bGOOSENECK\b/i, 'Gooseneck'],
  [/\bCONCESSION\b/i, 'Enclosed'],
  [/\bALUMINUM\b/i, 'Aluminum'],
  [/\bGOLF\s*CART\b/i, 'Golf Cart'],
  [/\bATV\b/i, 'ATV'],
]

function titleCase(str: string): string {
  return str
    .toLowerCase()
    .split(' ')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

function parseTitle(title: string): {
  make?: string
  model?: string
  type?: string
} {
  if (!title) return {}

  // Type
  let type: string | undefined
  for (const [pat, val] of TYPE_PATTERNS) {
    if (pat.test(title)) { type = val; break }
  }

  // Make + model
  const words = title.split(/\s+/).filter(Boolean)
  let make: string | undefined
  let model: string | undefined

  if (words.length >= 2) {
    const twoWord = `${words[0]} ${words[1]}`
    if (MULTI_WORD_MAKES.test(twoWord)) {
      make = titleCase(twoWord)
      model = words.slice(2, 4).join(' ')
    } else {
      make = titleCase(words[0])
      model = words.slice(1, 3).join(' ')
    }
  } else if (words.length === 1) {
    make = titleCase(words[0])
  }

  return { make, model, type }
}

function extractLength(size: string | undefined): string | null {
  if (!size) return null
  const match = size.match(/(\d+)'/)
  return match ? `${match[1]}ft` : null
}

function parsePrice(raw: string): number | null {
  if (!raw) return null
  const cleaned = raw.replace(/[$,\s]/g, '')
  const num = parseFloat(cleaned)
  return isNaN(num) || num <= 0 ? null : num
}

export function mapRawItems(rawItems: unknown[], dealer: DealerConfig): InventoryItem[] {
  const now = new Date().toISOString()
  const listings = rawItems as DsListing[]
  const result: InventoryItem[] = []
  const seen = new Set<string>()

  for (const listing of listings) {
    if (!listing.stock) continue
    if (seen.has(listing.stock)) continue
    seen.add(listing.stock)

    const parsed = parseTitle(listing.title)
    const floorLength = extractLength(listing.size)

    result.push({
      dealerSlug: dealer.slug,
      sourceUrl: listing.url.startsWith('http')
        ? listing.url
        : `${dealer.baseUrl}${listing.url}`,
      stockNumber: listing.stock,
      year: listing.year || null,
      condition: listing.condition || null,
      make: parsed.make || null,
      model: parsed.model || null,
      type: parsed.type || null,
      size: listing.size || null,
      price: parsePrice(listing.price),
      msrp: null,
      salePrice: null,
      gvwr: null,
      vin: listing.vin || null,
      location: null,
      status: 'Available',
      scrapedAt: now,
      specs: {
        ...(floorLength ? { floorLength } : {}),
      },
    })
  }

  return result
}
