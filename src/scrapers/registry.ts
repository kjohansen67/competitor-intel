/**
 * Scraper registry — maps scraper keys to scraper classes.
 * Add new scrapers here as they are built.
 */

import type { BaseScraper } from './base-scraper.js'

type ScraperFactory = () => BaseScraper

const scrapers = new Map<string, ScraperFactory>()

export function registerScraper(key: string, factory: ScraperFactory): void {
  scrapers.set(key, factory)
}

export function getScraper(key: string): BaseScraper | null {
  const factory = scrapers.get(key)
  return factory ? factory() : null
}

export function listScrapers(): string[] {
  return [...scrapers.keys()]
}

// Auto-register scrapers as they are imported
// Each scraper file calls registerScraper() at module level
