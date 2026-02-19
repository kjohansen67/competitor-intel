/**
 * TrailerFunnel REST API adapter.
 *
 * Navigates to dealer page, extracts apiToken from inline script,
 * then fetches https://inventory.trailerfunnel.com/api/v1/items
 * with Bearer token from page context (CORS allowed from dealer site).
 *
 * NO hardcoded tokens — extracted dynamically every run.
 */

import type { Page } from 'playwright'
import type { DealerConfig } from '../schema/inventory-item.js'

export interface TfItem {
  title: string
  condition: string
  status: string
  year: number
  stock: string
  vin: string | null
  manufacturer: string
  model_name: string
  item_category: { name: string } | null
  item_type: { name: string } | null
  details: {
    displayed_web_price: number | null
    msrp: number | null
    sales_price: string | null
    gvwr: string | null
    weight: string | null
    payload_capacity: string | null
    floor_length: string | null
    floor_width: string | null
    savings: number | null
  } | null
  attributes: {
    color: string | null
    pull_type: string | null
    construction: string | null
    suspension_type: string | null
    axles: string | null
    ramps: boolean | null
  } | null
}

export async function scrape(
  page: Page,
  dealer: DealerConfig
): Promise<TfItem[]> {
  const config = dealer.platformConfig || {}
  const apiUrl = (config.apiUrl as string) || 'https://inventory.trailerfunnel.com/api/v1/items'
  const limit = (config.limit as number) || 250
  const locationFilter = (config.locationFilter as Record<string, string>) || {}

  // 1. Navigate to inventory page
  const inventoryUrl = `${dealer.baseUrl}${dealer.inventoryPath}`
  console.log(`[${dealer.name}] Navigating to ${inventoryUrl}...`)
  await page.goto(inventoryUrl, { waitUntil: 'networkidle', timeout: 30_000 })
  await page.waitForTimeout(2000)

  // 2. Extract apiToken dynamically
  console.log(`[${dealer.name}] Extracting API token...`)
  const token = await page.evaluate(() => {
    const scripts = [...document.querySelectorAll('script:not([src])')]
    for (const s of scripts) {
      const match = s.textContent?.match(/apiToken\s*=\s*"([^"]+)"/)
      if (match) return match[1]
    }
    return null
  })

  if (!token) {
    throw new Error(
      'Failed to extract TrailerFunnel API token from page. ' +
      'Token may have changed or page structure updated.'
    )
  }
  console.log(`[${dealer.name}] Token extracted (${token.slice(0, 10)}...)`)

  // 3. Build query string
  const params: Record<string, string> = {
    page: '1',
    limit: String(limit),
    sort: 'relevance',
    with_filters: '1',
    ...locationFilter,
  }
  const qs = Object.entries(params).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&')
  const fetchUrl = `${apiUrl}?${qs}`

  // 4. Fetch from page context
  console.log(`[${dealer.name}] Fetching API...`)
  const result = await page.evaluate(
    async ({ url, bearerToken }) => {
      const resp = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${bearerToken}`,
          'Accept': 'application/json',
        },
      })
      if (!resp.ok) {
        return { error: `HTTP ${resp.status}: ${resp.statusText}`, data: [] }
      }
      const json = await resp.json()
      return { error: null, data: json.data || [] }
    },
    { url: fetchUrl, bearerToken: token }
  )

  if (result.error) {
    throw new Error(`TrailerFunnel API error: ${result.error}`)
  }

  console.log(`[${dealer.name}] API returned ${result.data.length} items`)
  return result.data as TfItem[]
}
