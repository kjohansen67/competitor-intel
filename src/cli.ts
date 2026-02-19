#!/usr/bin/env tsx
/**
 * CLI runner for competitor-intel scrapers.
 *
 * Usage:
 *   npx tsx src/cli.ts scrape <scraper-key> --company <company-id>
 *   npx tsx src/cli.ts scrape-all --company <company-id>
 *   npx tsx src/cli.ts list
 */

import 'dotenv/config'

// Import all scrapers to trigger registration
import './scrapers/load-all.js'

import { getScraper, listScrapers } from './scrapers/registry.js'
import { supabase } from './lib/supabase.js'
import type { ScrapeResult } from './scrapers/base-scraper.js'

const args = process.argv.slice(2)
const command = args[0]

function getFlag(name: string): string | undefined {
  const idx = args.indexOf(`--${name}`)
  return idx >= 0 ? args[idx + 1] : undefined
}

async function main() {
  if (!command) {
    printUsage()
    process.exit(1)
  }

  if (command === 'list') {
    const keys = listScrapers()
    console.log('Available scrapers:')
    keys.forEach(k => console.log(`  - ${k}`))
    if (keys.length === 0) console.log('  (none registered yet)')
    process.exit(0)
  }

  if (command === 'scrape') {
    const scraperKey = args[1]
    const companyId = getFlag('company') || process.env.DEFAULT_COMPANY_ID

    if (!scraperKey) {
      console.error('Error: scraper key required. Usage: scrape <key> --company <id>')
      process.exit(1)
    }
    if (!companyId) {
      console.error('Error: --company <id> required (or set DEFAULT_COMPANY_ID in .env)')
      process.exit(1)
    }

    const scraper = getScraper(scraperKey)
    if (!scraper) {
      console.error(`Error: no scraper registered for key "${scraperKey}"`)
      console.error(`Available: ${listScrapers().join(', ') || 'none'}`)
      process.exit(1)
    }

    const result = await scraper.run(companyId)
    printResult(result)
    process.exit(result.error ? 1 : 0)
  }

  if (command === 'scrape-all') {
    const companyId = getFlag('company') || process.env.DEFAULT_COMPANY_ID

    if (!companyId) {
      console.error('Error: --company <id> required (or set DEFAULT_COMPANY_ID in .env)')
      process.exit(1)
    }

    // Get active scrape targets for this company
    const { data: targets, error } = await supabase
      .from('scrape_targets')
      .select('*')
      .eq('company_id', companyId)
      .eq('is_active', true)

    if (error) {
      console.error(`Error fetching targets: ${error.message}`)
      process.exit(1)
    }

    if (!targets || targets.length === 0) {
      console.log('No active scrape targets found for this company.')
      process.exit(0)
    }

    console.log(`Found ${targets.length} active scrape targets\n`)

    const results: ScrapeResult[] = []
    for (const target of targets) {
      const scraper = getScraper(target.scraper_key)
      if (!scraper) {
        console.error(`  Skipping "${target.competitor_name}" — no scraper for key "${target.scraper_key}"`)
        continue
      }

      console.log(`--- Scraping: ${target.competitor_name} ---`)
      const result = await scraper.run(companyId, target.id)
      results.push(result)
      printResult(result)
      console.log()
    }

    // Summary
    console.log('=== SUMMARY ===')
    const succeeded = results.filter(r => !r.error)
    const failed = results.filter(r => r.error)
    console.log(`  Succeeded: ${succeeded.length}`)
    console.log(`  Failed: ${failed.length}`)
    console.log(`  Total items: ${succeeded.reduce((s, r) => s + r.itemsFound, 0)}`)
    console.log(`  Total changes: ${succeeded.reduce((s, r) => s + r.changesDetected, 0)}`)

    process.exit(failed.length > 0 ? 1 : 0)
  }

  console.error(`Unknown command: ${command}`)
  printUsage()
  process.exit(1)
}

function printResult(r: ScrapeResult) {
  if (r.error) {
    console.log(`  FAILED: ${r.error}`)
  } else {
    console.log(`  Items found: ${r.itemsFound}`)
    console.log(`  Changes: ${r.changesDetected} (${r.newListings} new, ${r.priceDrops} drops, ${r.priceIncreases} increases, ${r.removed} removed)`)
    console.log(`  Duration: ${(r.durationMs / 1000).toFixed(1)}s`)
  }
}

function printUsage() {
  console.log(`
Usage:
  npx tsx src/cli.ts scrape <scraper-key> --company <company-id>
  npx tsx src/cli.ts scrape-all --company <company-id>
  npx tsx src/cli.ts list

Examples:
  npx tsx src/cli.ts list
  npx tsx src/cli.ts scrape nc-trailers --company abc-123
  npx tsx src/cli.ts scrape-all --company abc-123
`)
}

main().catch(err => {
  console.error('Fatal error:', err)
  process.exit(1)
})
