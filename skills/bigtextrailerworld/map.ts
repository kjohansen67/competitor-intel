/**
 * Big Tex Trailer World mapping — FacetWP HTML cards → InventoryItem[].
 *
 * Single location: Concord, NC (FacetWP location ID 257).
 * Title format: "Big Tex 70SR, Dump, 60″ x 10′, 7K, Double Rear Doors"
 *   → make: "Big Tex"  model: "70SR"  type: "Dump"  size from dims
 * Subtitle: "Tandem Axle Single Ram Dump" (model description)
 *
 * Also handles CM (CM Truck Beds) titles like "CM PL TB PL 14/101/34"
 */

import type { DealerConfig, InventoryItem } from '../../src/schema/inventory-item.js'
import type { FwpCard } from '../../src/platforms/facetwp.js'

const KNOWN_MAKES = [
  'Big Tex',
  'CM',
  'Maxxd',
  'Iron Bull',
  'East Texas',
  'Load Trail',
  'PJ Trailers',
  'Diamond C',
]

/** Type keywords found in Big Tex titles */
const TYPE_PATTERNS: [RegExp, string][] = [
  [/\bDump\b/i, 'Dump Trailer'],
  [/\bGooseneck\b/i, 'Gooseneck Trailer'],
  [/\bCar Hauler\b/i, 'Car Hauler'],
  [/\bEquipment\b/i, 'Equipment Trailer'],
  [/\bLandscape\b/i, 'Utility Trailer'],
  [/\bUtility\b/i, 'Utility Trailer'],
  [/\bTilt\b/i, 'Tilt Trailer'],
  [/\bFlatbed\b/i, 'Flatbed Trailer'],
  [/\bCargo\b/i, 'Cargo / Enclosed Trailer'],
  [/\bEnclosed\b/i, 'Cargo / Enclosed Trailer'],
  [/\bTB\b/, 'Truck Bed'],
  [/\bTruck Bed\b/i, 'Truck Bed'],
  [/\bSingle Axle Vanguard\b/i, 'Utility Trailer'],
  [/\bTandem Axle Vanguard\b/i, 'Utility Trailer'],
]

function parseDollar(s: string | null): number | null {
  if (!s) return null
  const num = parseFloat(s.replace(/[$,]/g, ''))
  return num > 0 ? num : null
}

function parseTitle(title: string): {
  make: string | null
  model: string | null
  type: string | null
  size: string | null
  gvwr: string | null
} {
  let make: string | null = null
  let model: string | null = null
  let type: string | null = null
  let size: string | null = null
  let gvwr: string | null = null

  // Extract make
  for (const m of KNOWN_MAKES) {
    if (title.startsWith(m + ' ')) {
      make = m
      break
    }
  }

  // Extract model (word after make, before comma)
  if (make) {
    const afterMake = title.slice(make.length).trim()
    const modelMatch = afterMake.match(/^([A-Z0-9]+(?:[-/][A-Z0-9]+)*)/)
    if (modelMatch) model = modelMatch[1]
  }

  // Extract type from title or subtitle
  for (const [pattern, typeName] of TYPE_PATTERNS) {
    if (pattern.test(title)) {
      type = typeName
      break
    }
  }

  // Extract size from dimensions like 83″ x 16′ or 60″ x 10′
  // Unicode: ″ = \u2033 (double prime), ′ = \u2032 (prime), also " and '
  const sizeMatch = title.match(/(\d+)[″"\u2033]\s*x\s*(\d+)[′'\u2032]/)
  if (sizeMatch) {
    const widthIn = parseInt(sizeMatch[1], 10)
    const lengthFt = parseInt(sizeMatch[2], 10)
    if (widthIn > 0 && lengthFt > 0) {
      const widthFt = Math.round((widthIn / 12) * 10) / 10
      size = `${widthFt}x${lengthFt}`
    }
  }

  // Extract GVWR from title like "7K" or "25.9K"
  const gvwrMatch = title.match(/(\d+(?:\.\d+)?)\s*K\b/)
  if (gvwrMatch) {
    const kVal = parseFloat(gvwrMatch[1])
    gvwr = `${Math.round(kVal * 1000)}`
  }

  return { make, model, type, size, gvwr }
}

export function mapRawItems(rawItems: unknown[], dealer: DealerConfig): InventoryItem[] {
  const now = new Date().toISOString()
  const cards = rawItems as FwpCard[]
  const result: InventoryItem[] = []

  for (const card of cards) {
    if (!card.title && !card.url) continue

    const parsed = parseTitle(card.title)

    // Use subtitle for type if title didn't have a match
    if (!parsed.type && card.subtitle) {
      for (const [pattern, typeName] of TYPE_PATTERNS) {
        if (pattern.test(card.subtitle)) {
          parsed.type = typeName
          break
        }
      }
    }

    // Build a stock number from URL slug or postId
    const urlSlug = card.url?.split('/').filter(Boolean).pop() || ''
    const stockNumber = card.postId || urlSlug

    const specs: Record<string, string> = {}
    if (card.subtitle) specs.description = card.subtitle
    if (card.badges.length > 0) specs.badges = card.badges.join(', ')

    result.push({
      dealerSlug: dealer.slug,
      sourceUrl: card.url || `${dealer.baseUrl}${dealer.inventoryPath}`,
      stockNumber,
      year: null, // Not in card listing
      condition: card.condition || 'New',
      make: parsed.make,
      model: parsed.model,
      type: parsed.type,
      size: parsed.size,
      price: parseDollar(card.price),
      msrp: parseDollar(card.msrp),
      salePrice: null,
      gvwr: parsed.gvwr,
      vin: card.vin || null,
      location: card.location || 'Concord, NC',
      status: 'Available',
      scrapedAt: now,
      specs,
    })
  }

  return result
}
