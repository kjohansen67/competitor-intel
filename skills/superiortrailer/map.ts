/**
 * Superior Trailer mapping — TrailerFunnel API items → InventoryItem[].
 *
 * Same platform as LBS/Rumley. 4 locations across NC and VA.
 * Field mapping:
 *   manufacturer → make
 *   model_name → model
 *   item_category.name → type
 *   details.displayed_web_price → price
 *   details.floor_length (inches) → converted to ft
 *   dealership_location.name → location
 *   attributes.* → specs
 */

import type { DealerConfig, InventoryItem } from '../../src/schema/inventory-item.js'
import type { TfItem } from '../../src/platforms/trailerfunnel-api.js'

function titleCase(str: string): string {
  return str
    .toLowerCase()
    .split(' ')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

function inchesToFt(inches: string | number | null | undefined): string | null {
  if (!inches) return null
  const val = typeof inches === 'number' ? inches : parseInt(inches, 10)
  if (!val || val <= 0) return null
  return `${Math.round(val / 12)}ft`
}

export function mapRawItems(rawItems: unknown[], dealer: DealerConfig): InventoryItem[] {
  const now = new Date().toISOString()
  const items = rawItems as (TfItem & { dealership_location?: { name?: string } })[]
  const result: InventoryItem[] = []

  for (const item of items) {
    const stock = item.stock?.trim()
    if (!stock) continue

    const floorLengthFt = inchesToFt(item.details?.floor_length)
    const floorWidthIn = item.details?.floor_width
      ? (typeof item.details.floor_width === 'number'
          ? item.details.floor_width
          : parseInt(item.details.floor_width, 10))
      : null

    let size: string | null = null
    if (floorWidthIn && floorWidthIn > 0 && item.details?.floor_length) {
      const lenIn = typeof item.details.floor_length === 'number'
        ? item.details.floor_length
        : parseInt(item.details.floor_length, 10)
      if (lenIn > 0) {
        const wFt = Math.round((floorWidthIn / 12) * 10) / 10
        const lFt = Math.round(lenIn / 12)
        size = `${wFt}x${lFt}`
      }
    }

    const price = item.details?.displayed_web_price
    const msrp = item.details?.msrp
    const salesPrice = item.details?.sales_price
      ? parseFloat(String(item.details.sales_price))
      : null

    const specs: Record<string, string> = {}
    if (item.attributes?.pull_type) specs.pullType = item.attributes.pull_type
    if (item.attributes?.construction) specs.construction = item.attributes.construction
    if (item.attributes?.axles) specs.axles = item.attributes.axles
    if (item.attributes?.suspension_type) specs.suspensionType = item.attributes.suspension_type
    if (item.attributes?.ramps != null) specs.ramps = item.attributes.ramps ? 'Yes' : 'No'
    if (item.attributes?.color) specs.color = item.attributes.color
    if (item.details?.weight) specs.weight = String(item.details.weight)
    if (item.details?.payload_capacity) specs.payloadCapacity = String(item.details.payload_capacity)
    if (floorLengthFt) specs.floorLength = floorLengthFt
    if (floorWidthIn) specs.floorWidth = `${floorWidthIn}in`

    const location = item.dealership_location?.name || null

    result.push({
      dealerSlug: dealer.slug,
      sourceUrl: `${dealer.baseUrl}${dealer.inventoryPath}`,
      stockNumber: stock,
      year: item.year ? String(item.year) : null,
      condition: item.condition || null,
      make: item.manufacturer ? titleCase(item.manufacturer) : null,
      model: item.model_name?.trim() || null,
      type: item.item_category?.name || null,
      size,
      price: price && price > 0 ? price : null,
      msrp: msrp && Number(msrp) > 0 ? Number(msrp) : null,
      salePrice: salesPrice && salesPrice > 0 ? salesPrice : null,
      gvwr: item.details?.gvwr ? String(item.details.gvwr) : null,
      vin: item.vin || null,
      location,
      status: item.status || 'Available',
      scrapedAt: now,
      specs,
    })
  }

  return result
}
