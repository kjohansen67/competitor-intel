/**
 * Upsert scraped dealer + inventory data into the market_intel schema.
 *
 * Tables:
 *   market_intel.dealers   — one row per dealer (keyed by slug)
 *   market_intel.inventory — one row per unit (keyed by vin OR dealer_id+stock_number)
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { DealerConfig, InventoryItem } from '../schema/inventory-item.js'

let _client: SupabaseClient | null = null

function getClient(): SupabaseClient {
  if (_client) return _client

  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !key) {
    throw new Error(
      'Missing SUPABASE_URL and/or SUPABASE_SERVICE_ROLE_KEY env vars — skipping DB upsert'
    )
  }

  _client = createClient(url, key, {
    db: { schema: 'market_intel' },
  })
  return _client
}

// ── Dealer upsert ────────────────────────────────────────────────

export async function upsertDealer(dealer: DealerConfig): Promise<string> {
  const sb = getClient()

  // Check if dealer already exists
  const { data: existing, error: fetchErr } = await sb
    .from('dealers')
    .select('id')
    .eq('slug', dealer.slug)
    .maybeSingle()

  if (fetchErr) throw new Error(`Failed to fetch dealer: ${fetchErr.message}`)

  if (existing) return existing.id

  // Parse city/state from platformConfig or dealer name
  const city = (dealer.platformConfig?.city as string) ?? null
  const state = (dealer.platformConfig?.state as string) ?? null

  const { data: inserted, error: insertErr } = await sb
    .from('dealers')
    .insert({
      slug: dealer.slug,
      name: dealer.name,
      platform: dealer.platform,
      city,
      state,
    })
    .select('id')
    .single()

  if (insertErr) throw new Error(`Failed to insert dealer: ${insertErr.message}`)
  return inserted.id
}

// ── Inventory upsert ─────────────────────────────────────────────

const BATCH_SIZE = 500

export async function upsertInventory(
  dealerId: string,
  items: InventoryItem[]
): Promise<{ inserted: number; updated: number }> {
  const sb = getClient()
  let inserted = 0
  let updated = 0

  // Split items into VIN-based and stock-number-based
  const withVin: InventoryItem[] = []
  const withoutVin: InventoryItem[] = []

  for (const item of items) {
    if (item.vin && item.vin.trim()) {
      withVin.push(item)
    } else {
      withoutVin.push(item)
    }
  }

  // ── VIN-based upsert ──
  for (let i = 0; i < withVin.length; i += BATCH_SIZE) {
    const batch = withVin.slice(i, i + BATCH_SIZE)
    const result = await upsertByVin(sb, dealerId, batch)
    inserted += result.inserted
    updated += result.updated
  }

  // ── Stock-number-based upsert ──
  for (let i = 0; i < withoutVin.length; i += BATCH_SIZE) {
    const batch = withoutVin.slice(i, i + BATCH_SIZE)
    const result = await upsertByStockNumber(sb, dealerId, batch)
    inserted += result.inserted
    updated += result.updated
  }

  return { inserted, updated }
}

async function upsertByVin(
  sb: SupabaseClient,
  dealerId: string,
  items: InventoryItem[]
): Promise<{ inserted: number; updated: number }> {
  let inserted = 0
  let updated = 0

  for (const item of items) {
    const vin = item.vin!.trim()

    // Check if this VIN already exists for this dealer
    const { data: existing } = await sb
      .from('inventory')
      .select('id')
      .eq('dealer_id', dealerId)
      .eq('vin', vin)
      .maybeSingle()

    const row = toDbRow(dealerId, item)

    if (existing) {
      const { error } = await sb
        .from('inventory')
        .update({
          price: row.price,
          sale_price: row.sale_price,
          msrp: row.msrp,
          status: row.status,
          location: row.location,
          specs: row.specs,
          scraped_at: row.scraped_at,
          source_url: row.source_url,
          stock_number: row.stock_number,
          year: row.year,
          make: row.make,
          model: row.model,
          type: row.type,
          size: row.size,
          gvwr: row.gvwr,
        })
        .eq('id', existing.id)

      if (error) console.error(`  VIN update failed (${vin}): ${error.message}`)
      else updated++
    } else {
      const { error } = await sb.from('inventory').insert(row)
      if (error) console.error(`  VIN insert failed (${vin}): ${error.message}`)
      else inserted++
    }
  }

  return { inserted, updated }
}

async function upsertByStockNumber(
  sb: SupabaseClient,
  dealerId: string,
  items: InventoryItem[]
): Promise<{ inserted: number; updated: number }> {
  let inserted = 0
  let updated = 0

  for (const item of items) {
    const stockNumber = item.stockNumber

    if (!stockNumber || !stockNumber.trim()) {
      // No key at all — just insert
      const { error } = await sb.from('inventory').insert(toDbRow(dealerId, item))
      if (error) console.error(`  Insert failed (no key): ${error.message}`)
      else inserted++
      continue
    }

    // Check if this dealer+stock_number already exists
    const { data: existing } = await sb
      .from('inventory')
      .select('id')
      .eq('dealer_id', dealerId)
      .eq('stock_number', stockNumber)
      .maybeSingle()

    const row = toDbRow(dealerId, item)

    if (existing) {
      const { error } = await sb
        .from('inventory')
        .update({
          price: row.price,
          sale_price: row.sale_price,
          msrp: row.msrp,
          status: row.status,
          location: row.location,
          specs: row.specs,
          scraped_at: row.scraped_at,
          source_url: row.source_url,
          vin: row.vin,
          year: row.year,
          make: row.make,
          model: row.model,
          type: row.type,
          size: row.size,
          gvwr: row.gvwr,
        })
        .eq('id', existing.id)

      if (error) console.error(`  Stock# update failed (${stockNumber}): ${error.message}`)
      else updated++
    } else {
      const { error } = await sb.from('inventory').insert(row)
      if (error) console.error(`  Stock# insert failed (${stockNumber}): ${error.message}`)
      else inserted++
    }
  }

  return { inserted, updated }
}

// ── Row mapper ───────────────────────────────────────────────────

function toDbRow(dealerId: string, item: InventoryItem) {
  return {
    dealer_id: dealerId,
    vin: item.vin?.trim() || null,
    stock_number: item.stockNumber?.trim() || null,
    year: item.year,
    make: item.make,
    model: item.model,
    type: item.type,
    size: item.size,
    gvwr: item.gvwr,
    price: item.price,
    msrp: item.msrp,
    sale_price: item.salePrice,
    location: item.location,
    status: item.status,
    specs: item.specs ?? {},
    source_url: item.sourceUrl,
    scraped_at: item.scrapedAt,
  }
}

// ── Combined entry point ─────────────────────────────────────────

export async function upsertDealerAndInventory(
  dealer: DealerConfig,
  items: InventoryItem[]
): Promise<void> {
  try {
    const dealerId = await upsertDealer(dealer)
    console.log(`[${dealer.name}] Dealer ID: ${dealerId}`)

    const { inserted, updated } = await upsertInventory(dealerId, items)
    console.log(
      `[${dealer.name}] Supabase upsert complete — ${inserted} inserted, ${updated} updated`
    )
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`[${dealer.name}] Supabase upsert failed: ${msg}`)
  }
}
