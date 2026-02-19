/**
 * Base scraper class — all site-specific scrapers extend this.
 *
 * Provides: browser launch with stealth, rate limiting, error handling,
 * normalization, change detection, and Supabase persistence.
 */

import { chromium, type Browser, type Page } from 'playwright'
import { supabase } from '../lib/supabase.js'
import { normalizeType, normalizeMake, parsePrice, buildTitle } from '../lib/normalize.js'
import { detectChanges, writeChanges, upsertInventory } from '../lib/change-detection.js'
import type { RawInventoryItem, CleanInventoryItem } from '../types/database.js'

export interface ScrapeResult {
  competitorName: string
  itemsFound: number
  changesDetected: number
  newListings: number
  priceDrops: number
  priceIncreases: number
  removed: number
  durationMs: number
  error: string | null
}

export abstract class BaseScraper {
  abstract name: string
  abstract baseUrl: string

  /** Site-specific scraping logic — extract raw inventory from the page(s) */
  abstract scrapeInventory(page: Page): Promise<RawInventoryItem[]>

  /** Launch browser with stealth settings */
  protected async launchBrowser(): Promise<Browser> {
    return chromium.launch({
      headless: true,
      args: [
        '--disable-blink-features=AutomationControlled',
        '--no-sandbox',
      ],
    })
  }

  /** Random delay between requests to avoid detection */
  protected async delay(minMs = 2000, maxMs = 5000): Promise<void> {
    const ms = minMs + Math.random() * (maxMs - minMs)
    await new Promise(resolve => setTimeout(resolve, ms))
  }

  /** Clean raw scraped items into DB-ready format */
  protected cleanItems(
    companyId: string,
    competitorName: string,
    rawItems: RawInventoryItem[]
  ): CleanInventoryItem[] {
    const now = new Date().toISOString()

    return rawItems
      .filter(item => item.stock_number) // Must have stock number
      .map(item => ({
        company_id: companyId,
        competitor_name: competitorName,
        title: item.title || buildTitle(item),
        make: normalizeMake(item.make),
        model: item.model?.trim() || null,
        type: normalizeType(item.type),
        price: parsePrice(item.price),
        stock_number: item.stock_number.trim(),
        condition: item.condition?.trim() || null,
        status: 'Available',
        floor_length: item.floor_length?.trim() || null,
        gvwr: item.gvwr?.trim() || null,
        color: item.color?.trim() || null,
        pull_type: item.pull_type?.trim() || null,
        size: item.size?.trim() || null,
        url: item.url?.trim() || null,
        scraped_at: now,
        updated_at: now,
      }))
  }

  /**
   * Run the full scrape pipeline:
   * 1. Launch browser
   * 2. Scrape inventory (site-specific)
   * 3. Normalize data
   * 4. Detect changes
   * 5. Write to Supabase
   * 6. Log job result
   */
  async run(companyId: string, targetId?: string): Promise<ScrapeResult> {
    const startTime = Date.now()
    let browser: Browser | null = null

    // Create job record
    const { data: job } = await supabase
      .from('scrape_jobs')
      .insert({
        company_id: companyId,
        target_id: targetId || null,
        status: 'running',
      })
      .select('id')
      .single()

    try {
      console.log(`[${this.name}] Starting scrape...`)

      // 1. Launch browser
      browser = await this.launchBrowser()
      const page = await browser.newPage()

      // Set realistic viewport and user agent
      await page.setViewportSize({ width: 1920, height: 1080 })

      // 2. Scrape (site-specific)
      const rawItems = await this.scrapeInventory(page)
      console.log(`[${this.name}] Scraped ${rawItems.length} raw items`)

      // 3. Normalize
      const cleanItems = this.cleanItems(companyId, this.name, rawItems)
      console.log(`[${this.name}] Cleaned to ${cleanItems.length} valid items`)

      // 4. Change detection
      const detection = await detectChanges(companyId, this.name, cleanItems)
      console.log(
        `[${this.name}] Changes: ${detection.newCount} new, ` +
        `${detection.priceDropCount} drops, ${detection.priceIncreaseCount} increases, ` +
        `${detection.removedCount} removed`
      )

      // 5. Write changes
      await writeChanges(detection.changes)

      // 6. Upsert inventory
      const removedStocks = detection.changes
        .filter(c => c.change_type === 'REMOVED')
        .map(c => c.stock_number!)
        .filter(Boolean)
      await upsertInventory(companyId, this.name, cleanItems, removedStocks)

      // 7. Update scrape target's last_scraped_at
      if (targetId) {
        await supabase
          .from('scrape_targets')
          .update({ last_scraped_at: new Date().toISOString() })
          .eq('id', targetId)
      }

      // 8. Update job
      const totalChanges = detection.changes.length
      if (job?.id) {
        await supabase
          .from('scrape_jobs')
          .update({
            status: 'success',
            completed_at: new Date().toISOString(),
            items_found: cleanItems.length,
            changes_detected: totalChanges,
          })
          .eq('id', job.id)
      }

      const result: ScrapeResult = {
        competitorName: this.name,
        itemsFound: cleanItems.length,
        changesDetected: totalChanges,
        newListings: detection.newCount,
        priceDrops: detection.priceDropCount,
        priceIncreases: detection.priceIncreaseCount,
        removed: detection.removedCount,
        durationMs: Date.now() - startTime,
        error: null,
      }

      console.log(`[${this.name}] Done in ${result.durationMs}ms`)
      return result
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err)
      console.error(`[${this.name}] Error: ${errorMsg}`)

      if (job?.id) {
        await supabase
          .from('scrape_jobs')
          .update({
            status: 'failed',
            completed_at: new Date().toISOString(),
            error_message: errorMsg,
          })
          .eq('id', job.id)
      }

      return {
        competitorName: this.name,
        itemsFound: 0,
        changesDetected: 0,
        newListings: 0,
        priceDrops: 0,
        priceIncreases: 0,
        removed: 0,
        durationMs: Date.now() - startTime,
        error: errorMsg,
      }
    } finally {
      if (browser) await browser.close()
    }
  }
}
