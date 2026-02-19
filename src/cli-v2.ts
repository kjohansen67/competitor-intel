#!/usr/bin/env tsx
/**
 * CLI v2 — platform-adapter runner.
 *
 * Usage:
 *   pnpm scrape:v2 --dealer nctrailers
 *   pnpm scrape:v2 --all
 *   pnpm scrape:v2 --list
 *
 * Runs in parallel with the existing cli.ts — no conflicts.
 */

import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { DealerConfig, DealerMap } from './schema/inventory-item.js'
import { runDealer, type RunResult } from './core/runner.js'

const ROOT = resolve(import.meta.dirname, '..')
const SKILLS_DIR = join(ROOT, 'skills')
const OUTPUT_DIR = join(ROOT, 'output')

function getFlag(name: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`)
  return idx >= 0 ? process.argv[idx + 1] : undefined
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`)
}

/** Discover all dealer configs from skills/ folder */
function listDealers(): DealerConfig[] {
  if (!existsSync(SKILLS_DIR)) return []

  const dealers: DealerConfig[] = []
  for (const dir of readdirSync(SKILLS_DIR, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue
    const configPath = join(SKILLS_DIR, dir.name, 'dealer.json')
    if (!existsSync(configPath)) continue
    try {
      const config = JSON.parse(readFileSync(configPath, 'utf-8')) as DealerConfig
      dealers.push(config)
    } catch (err) {
      console.warn(`Warning: Failed to parse ${configPath}: ${err}`)
    }
  }
  return dealers
}

/** Load a dealer's map module */
async function loadDealerMap(slug: string): Promise<DealerMap> {
  const mapPath = join(SKILLS_DIR, slug, 'map.ts')
  if (!existsSync(mapPath)) {
    throw new Error(`No map.ts found for dealer "${slug}" at ${mapPath}`)
  }
  const mod = await import(pathToFileURL(mapPath).href)
  if (typeof mod.mapRawItems !== 'function') {
    throw new Error(`map.ts for "${slug}" must export a mapRawItems() function`)
  }
  return mod as DealerMap
}

function printResult(r: RunResult) {
  if (r.error) {
    console.log(`  FAILED: ${r.error}`)
    console.log(`  Debug artifacts: ${r.outputDir}/debug/`)
  } else {
    console.log(`  Items: ${r.itemCount}`)
    console.log(`  Output: ${r.outputDir}`)
    console.log(`  Duration: ${(r.durationMs / 1000).toFixed(1)}s`)
  }
}

async function main() {
  const dealerSlug = getFlag('dealer')
  const runAll = hasFlag('all')
  const showList = hasFlag('list')

  if (showList) {
    const dealers = listDealers()
    console.log('Available dealers:')
    for (const d of dealers) {
      console.log(`  ${d.slug.padEnd(16)} ${d.name.padEnd(20)} [${d.platform}]`)
    }
    if (dealers.length === 0) console.log('  (none — add dealer.json to skills/<slug>/)')
    process.exit(0)
  }

  if (!dealerSlug && !runAll) {
    console.log(`
Usage:
  pnpm scrape:v2 --dealer <slug>     Run one dealer
  pnpm scrape:v2 --all               Run all dealers
  pnpm scrape:v2 --list              List available dealers

Examples:
  pnpm scrape:v2 --dealer nctrailers
  pnpm scrape:v2 --all
`)
    process.exit(1)
  }

  const allDealers = listDealers()

  if (dealerSlug) {
    // Run single dealer
    const dealer = allDealers.find(d => d.slug === dealerSlug)
    if (!dealer) {
      console.error(`Error: no dealer config found for "${dealerSlug}"`)
      console.error(`Available: ${allDealers.map(d => d.slug).join(', ') || 'none'}`)
      process.exit(1)
    }

    console.log(`\n=== Scraping: ${dealer.name} (${dealer.platform}) ===\n`)
    const dealerMap = await loadDealerMap(dealer.slug)
    const result = await runDealer(dealer, dealerMap, OUTPUT_DIR)
    printResult(result)
    process.exit(result.error ? 1 : 0)
  }

  if (runAll) {
    if (allDealers.length === 0) {
      console.log('No dealers configured.')
      process.exit(0)
    }

    console.log(`Running ${allDealers.length} dealers...\n`)
    const results: RunResult[] = []

    for (const dealer of allDealers) {
      console.log(`\n--- ${dealer.name} (${dealer.platform}) ---`)
      const dealerMap = await loadDealerMap(dealer.slug)
      const result = await runDealer(dealer, dealerMap, OUTPUT_DIR)
      results.push(result)
      printResult(result)
    }

    // Summary
    const succeeded = results.filter(r => !r.error)
    const failed = results.filter(r => r.error)
    console.log('\n=== SUMMARY ===')
    console.log(`  Succeeded: ${succeeded.length}`)
    console.log(`  Failed: ${failed.length}`)
    console.log(`  Total items: ${succeeded.reduce((s, r) => s + r.itemCount, 0)}`)
    process.exit(failed.length > 0 ? 1 : 0)
  }
}

main().catch(err => {
  console.error('Fatal error:', err)
  process.exit(1)
})
