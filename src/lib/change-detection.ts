/**
 * Change detection engine — compares freshly scraped inventory against
 * the database to detect NEW_LISTING, PRICE_DROP, PRICE_INCREASE, REMOVED.
 *
 * Ported from TruIntel's import-competitor-scrape.js.
 */

import { supabase } from './supabase.js'
import type { CleanInventoryItem, InventoryChange } from '../types/database.js'

interface ExistingRow {
  stock_number: string
  price: number | null
  title: string | null
  status: string | null
}

export interface ChangeDetectionResult {
  changes: Omit<InventoryChange, 'id' | 'detected_at'>[]
  newCount: number
  priceDropCount: number
  priceIncreaseCount: number
  removedCount: number
}

/**
 * Detect changes between scraped items and current DB state.
 */
export async function detectChanges(
  companyId: string,
  competitorName: string,
  scrapedItems: CleanInventoryItem[]
): Promise<ChangeDetectionResult> {
  // Fetch current inventory for this company + competitor
  const { data: existing, error } = await supabase
    .from('competitor_inventory')
    .select('stock_number, price, title, status')
    .eq('company_id', companyId)
    .eq('competitor_name', competitorName)
    .neq('status', 'Sold')

  if (error) throw new Error(`Failed to fetch existing inventory: ${error.message}`)

  const existingMap = new Map<string, ExistingRow>()
  ;(existing || []).forEach(r => existingMap.set(r.stock_number, r))

  const scrapedStocks = new Set(scrapedItems.map(i => i.stock_number))
  const changes: Omit<InventoryChange, 'id' | 'detected_at'>[] = []

  // Check each scraped item against DB
  for (const item of scrapedItems) {
    const prev = existingMap.get(item.stock_number)

    if (!prev) {
      // New listing
      changes.push({
        company_id: companyId,
        competitor_name: competitorName,
        trailer_title: item.title,
        stock_number: item.stock_number,
        change_type: 'NEW_LISTING',
        old_price: null,
        new_price: item.price,
      })
    } else if (prev.price != null && item.price != null) {
      if (item.price < prev.price) {
        changes.push({
          company_id: companyId,
          competitor_name: competitorName,
          trailer_title: item.title,
          stock_number: item.stock_number,
          change_type: 'PRICE_DROP',
          old_price: prev.price,
          new_price: item.price,
        })
      } else if (item.price > prev.price) {
        changes.push({
          company_id: companyId,
          competitor_name: competitorName,
          trailer_title: item.title,
          stock_number: item.stock_number,
          change_type: 'PRICE_INCREASE',
          old_price: prev.price,
          new_price: item.price,
        })
      }
    }
  }

  // Check for removed items (in DB but not in scrape)
  for (const [stockNumber, prev] of existingMap) {
    if (!scrapedStocks.has(stockNumber)) {
      changes.push({
        company_id: companyId,
        competitor_name: competitorName,
        trailer_title: prev.title,
        stock_number: stockNumber,
        change_type: 'REMOVED',
        old_price: prev.price,
        new_price: null,
      })
    }
  }

  return {
    changes,
    newCount: changes.filter(c => c.change_type === 'NEW_LISTING').length,
    priceDropCount: changes.filter(c => c.change_type === 'PRICE_DROP').length,
    priceIncreaseCount: changes.filter(c => c.change_type === 'PRICE_INCREASE').length,
    removedCount: changes.filter(c => c.change_type === 'REMOVED').length,
  }
}

/**
 * Write detected changes to the inventory_changes table.
 */
export async function writeChanges(
  changes: Omit<InventoryChange, 'id' | 'detected_at'>[]
): Promise<void> {
  if (changes.length === 0) return

  const { error } = await supabase
    .from('inventory_changes')
    .insert(changes)

  if (error) throw new Error(`Failed to write changes: ${error.message}`)
}

/**
 * Upsert scraped inventory and mark removed items as Sold.
 */
export async function upsertInventory(
  companyId: string,
  competitorName: string,
  items: CleanInventoryItem[],
  removedStockNumbers: string[]
): Promise<void> {
  // Deduplicate by stock_number (last occurrence wins)
  const byStock = new Map<string, CleanInventoryItem>()
  items.forEach(item => byStock.set(item.stock_number, item))
  const dedupedItems = [...byStock.values()]

  // Batch upsert (500 at a time)
  const BATCH_SIZE = 500
  for (let i = 0; i < dedupedItems.length; i += BATCH_SIZE) {
    const batch = dedupedItems.slice(i, i + BATCH_SIZE)
    const { error } = await supabase
      .from('competitor_inventory')
      .upsert(batch, {
        onConflict: 'company_id,competitor_name,stock_number',
        ignoreDuplicates: false,
      })
    if (error) throw new Error(`Upsert batch failed: ${error.message}`)
  }

  // Mark removed items as Sold
  if (removedStockNumbers.length > 0) {
    const { error } = await supabase
      .from('competitor_inventory')
      .update({ status: 'Sold', updated_at: new Date().toISOString() })
      .eq('company_id', companyId)
      .eq('competitor_name', competitorName)
      .in('stock_number', removedStockNumbers)

    if (error) throw new Error(`Failed to mark removed items: ${error.message}`)
  }
}
