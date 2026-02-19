/**
 * CSV writer — writes InventoryItem[] to a CSV file.
 */

import { writeFileSync } from 'node:fs'
import type { InventoryItem } from '../schema/inventory-item.js'

const COLUMNS = [
  'dealerSlug',
  'stockNumber',
  'condition',
  'year',
  'make',
  'model',
  'type',
  'size',
  'price',
  'msrp',
  'salePrice',
  'gvwr',
  'vin',
  'location',
  'status',
  'sourceUrl',
  'scrapedAt',
] as const

/** Escape a value for CSV (RFC 4180) */
function esc(val: unknown): string {
  const str = val == null ? '' : String(val)
  if (str.includes('"') || str.includes(',') || str.includes('\n')) {
    return '"' + str.replace(/"/g, '""') + '"'
  }
  return str
}

/** Write inventory items to a CSV file */
export function writeCsv(items: InventoryItem[], outputPath: string): void {
  const header = COLUMNS.join(',')
  const rows = items.map(item =>
    COLUMNS.map(col => esc(item[col])).join(',')
  )
  const csv = header + '\n' + rows.join('\n') + '\n'
  writeFileSync(outputPath, csv, 'utf-8')
}
