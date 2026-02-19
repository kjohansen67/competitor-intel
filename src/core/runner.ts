/**
 * Core runner — orchestrates: load dealer → launch browser → run adapter → map → output.
 *
 * No Supabase dependency. Outputs CSV + summary.json only.
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { chromium, type Browser, type Page } from 'playwright'
import type { DealerConfig, DealerMap, InventoryItem } from '../schema/inventory-item.js'
import { writeCsv } from './csv.js'
import { buildSummary, writeSummary, type Summary } from './summary.js'
import { saveDebugArtifacts } from './debug.js'

export interface RunResult {
  dealerSlug: string
  dealerName: string
  itemCount: number
  outputDir: string
  summary: Summary
  durationMs: number
  error: string | null
}

/** Platform adapter function signature */
export type PlatformAdapter = (page: Page, dealer: DealerConfig) => Promise<unknown[]>

/** Registry of platform adapters — populated by imports */
const adapters = new Map<string, () => Promise<{ scrape: PlatformAdapter }>>()

export function registerAdapter(platform: string, loader: () => Promise<{ scrape: PlatformAdapter }>) {
  adapters.set(platform, loader)
}

// Register known adapters (lazy-loaded)
registerAdapter('woocommerce', () => import('../platforms/woocommerce-store-api.js'))
registerAdapter('trailerfunnel', () => import('../platforms/trailerfunnel-api.js'))
registerAdapter('dealsector', () => import('../platforms/dealsector-ajax.js'))

/**
 * Run a full scrape for one dealer.
 */
export async function runDealer(
  dealer: DealerConfig,
  dealerMap: DealerMap,
  outputRoot: string
): Promise<RunResult> {
  const startTime = Date.now()
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const outputDir = join(outputRoot, dealer.slug, timestamp)
  let browser: Browser | null = null
  let page: Page | null = null

  try {
    // 1. Load platform adapter
    const adapterLoader = adapters.get(dealer.platform)
    if (!adapterLoader) {
      throw new Error(`No adapter registered for platform "${dealer.platform}"`)
    }
    const { scrape } = await adapterLoader()

    // 2. Launch browser
    console.log(`[${dealer.name}] Launching browser...`)
    browser = await chromium.launch({
      headless: true,
      args: ['--disable-blink-features=AutomationControlled', '--no-sandbox'],
    })
    page = await browser.newPage()
    await page.setViewportSize({ width: 1920, height: 1080 })

    // 3. Run platform adapter → raw items
    console.log(`[${dealer.name}] Running ${dealer.platform} adapter...`)
    const rawItems = await scrape(page, dealer)
    console.log(`[${dealer.name}] Adapter returned ${rawItems.length} raw items`)

    // 4. Map raw items → InventoryItem[]
    const items = dealerMap.mapRawItems(rawItems, dealer)
    console.log(`[${dealer.name}] Mapped to ${items.length} inventory items`)

    // 5. Validate count
    if (dealer.expectedMin && items.length < dealer.expectedMin) {
      console.warn(
        `[${dealer.name}] WARNING: Got ${items.length} items, expected at least ${dealer.expectedMin}`
      )
    }

    // 6. Write output
    mkdirSync(outputDir, { recursive: true })
    writeCsv(items, join(outputDir, 'inventory.csv'))
    const summary = buildSummary(items)
    writeSummary(summary, join(outputDir, 'summary.json'))

    // Write latest pointer
    const latestPath = join(outputRoot, dealer.slug, 'latest.txt')
    writeFileSync(latestPath, timestamp + '\n', 'utf-8')

    console.log(`[${dealer.name}] Output written to ${outputDir}`)

    return {
      dealerSlug: dealer.slug,
      dealerName: dealer.name,
      itemCount: items.length,
      outputDir,
      summary,
      durationMs: Date.now() - startTime,
      error: null,
    }
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err)
    console.error(`[${dealer.name}] ERROR: ${errorMsg}`)

    // Save debug artifacts
    mkdirSync(outputDir, { recursive: true })
    await saveDebugArtifacts(page, err, outputDir)

    return {
      dealerSlug: dealer.slug,
      dealerName: dealer.name,
      itemCount: 0,
      outputDir,
      summary: buildSummary([]),
      durationMs: Date.now() - startTime,
      error: errorMsg,
    }
  } finally {
    if (browser) await browser.close()
  }
}
