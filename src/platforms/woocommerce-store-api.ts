/**
 * WooCommerce Store API adapter.
 *
 * Navigates to dealer site first, then fetches the Store API
 * from the page context (same-origin) to avoid CORS issues.
 * Paginates /wp-json/wc/store/v1/products?per_page=100&page=N.
 * Prices are in CENTS (string). Returns raw WcProduct[].
 *
 * Extracted from: src/scrapers/nc-trailers.ts
 */

import type { Page } from 'playwright'
import type { DealerConfig } from '../schema/inventory-item.js'

export interface WcProduct {
  id: number
  name: string
  sku: string
  permalink: string
  on_sale: boolean
  is_in_stock: boolean
  prices: {
    price: string
    regular_price: string
    sale_price: string
    currency_code: string
  }
  categories: Array<{ id: number; name: string; slug: string }>
  attributes: Array<{
    id: number
    name: string
    taxonomy: string
    has_variations: boolean
    terms: Array<{ id: number; name: string; slug: string }>
  }>
  short_description: string
  description: string
}

export async function scrape(
  page: Page,
  dealer: DealerConfig
): Promise<WcProduct[]> {
  const config = dealer.platformConfig || {}
  const perPage = (config.perPage as number) || 100
  const apiPath = (config.apiPath as string) || '/wp-json/wc/store/v1/products'

  // Navigate to base URL (lighter than full inventory page) for same-origin context
  console.log(`[${dealer.name}] Navigating to ${dealer.baseUrl} for same-origin context...`)
  await page.goto(dealer.baseUrl, { waitUntil: 'commit', timeout: 60_000 })
  await page.waitForTimeout(1000)

  // Paginate the Store API from page context
  console.log(`[${dealer.name}] Fetching via WooCommerce Store API (per_page=${perPage})...`)

  const items = await page.evaluate(
    async ({ apiPath, perPage }) => {
      const all: unknown[] = []
      let currentPage = 1
      let emptyPages = 0

      while (true) {
        try {
          const url = `${apiPath}?per_page=${perPage}&page=${currentPage}`
          const res = await fetch(url)

          if (!res.ok) break

          const products = await res.json()

          if (!products || products.length === 0) {
            emptyPages++
            if (emptyPages >= 2) break
            currentPage++
            continue
          }

          emptyPages = 0
          all.push(...products)

          if (products.length < perPage) break // Last page
          currentPage++

          // Brief rate limit
          await new Promise(r => setTimeout(r, 300))
        } catch {
          emptyPages++
          if (emptyPages >= 3) break
          currentPage++
        }
      }

      return { items: all, pages: currentPage }
    },
    { apiPath, perPage }
  )

  console.log(`[${dealer.name}] Fetched ${items.items.length} products across ${items.pages} pages`)
  return items.items as WcProduct[]
}
