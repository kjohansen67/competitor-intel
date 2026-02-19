/**
 * Summary builder — generates summary.json from InventoryItem[].
 */

import { writeFileSync } from 'node:fs'
import type { InventoryItem } from '../schema/inventory-item.js'

export interface Summary {
  totalCount: number
  byStatus: Record<string, number>
  byType: Record<string, number>
  byMake: Record<string, number>
  byLocation: Record<string, number>
  priceStats: {
    min: number | null
    max: number | null
    avg: number | null
    byType: Record<string, { min: number; max: number; avg: number; count: number }>
  }
  generatedAt: string
}

function countBy(items: InventoryItem[], key: keyof InventoryItem): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const item of items) {
    const val = (item[key] as string) || 'Unknown'
    counts[val] = (counts[val] || 0) + 1
  }
  // Sort by count descending
  return Object.fromEntries(
    Object.entries(counts).sort(([, a], [, b]) => b - a)
  )
}

export function buildSummary(items: InventoryItem[]): Summary {
  const priced = items.filter(i => i.price != null && i.price > 0)
  const prices = priced.map(i => i.price!)

  // Price stats by type
  const byTypePrice: Record<string, number[]> = {}
  for (const item of priced) {
    const t = item.type || 'Unknown'
    if (!byTypePrice[t]) byTypePrice[t] = []
    byTypePrice[t].push(item.price!)
  }

  const priceByType: Summary['priceStats']['byType'] = {}
  for (const [type, typePrices] of Object.entries(byTypePrice)) {
    priceByType[type] = {
      min: Math.min(...typePrices),
      max: Math.max(...typePrices),
      avg: Math.round(typePrices.reduce((s, p) => s + p, 0) / typePrices.length),
      count: typePrices.length,
    }
  }

  return {
    totalCount: items.length,
    byStatus: countBy(items, 'status'),
    byType: countBy(items, 'type'),
    byMake: countBy(items, 'make'),
    byLocation: countBy(items, 'location'),
    priceStats: {
      min: prices.length ? Math.min(...prices) : null,
      max: prices.length ? Math.max(...prices) : null,
      avg: prices.length ? Math.round(prices.reduce((s, p) => s + p, 0) / prices.length) : null,
      byType: priceByType,
    },
    generatedAt: new Date().toISOString(),
  }
}

export function writeSummary(summary: Summary, outputPath: string): void {
  writeFileSync(outputPath, JSON.stringify(summary, null, 2) + '\n', 'utf-8')
}
