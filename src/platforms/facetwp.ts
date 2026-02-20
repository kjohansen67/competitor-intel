/**
 * FacetWP platform adapter.
 *
 * Used by WordPress sites with the FacetWP plugin for faceted filtering.
 * POSTs to /wp-json/facetwp/v1/refresh with facet filters,
 * paginates through results, and returns parsed HTML card data.
 *
 * platformConfig:
 *   locationId  — FacetWP location facet value (e.g. "257" for Concord, NC)
 *   perPage     — items per page (default: 11, set by FacetWP)
 *   template    — FacetWP template name (default: "inventory_results")
 */

import type { Page } from 'playwright'
import type { DealerConfig } from '../schema/inventory-item.js'

export interface FwpCard {
  title: string
  subtitle: string
  url: string
  msrp: string | null
  price: string | null
  condition: string | null
  location: string | null
  vin: string | null
  postId: string | null
  badges: string[]
}

export async function scrape(
  page: Page,
  dealer: DealerConfig
): Promise<FwpCard[]> {
  const config = dealer.platformConfig || {}
  const locationId = config.locationId as string | undefined
  const template = (config.template as string) || 'inventory_results'

  // 1. Navigate to inventory page (establishes same-origin context)
  const inventoryUrl = `${dealer.baseUrl}${dealer.inventoryPath}`
  console.log(`[${dealer.name}] Navigating to ${inventoryUrl}...`)
  await page.goto(inventoryUrl, { waitUntil: 'networkidle', timeout: 45_000 })
  await page.waitForTimeout(2000)

  // 2. Read FacetWP config from page to get facet names + total
  const fwpConfig = await page.evaluate(() => {
    const fwp = (window as any).FWP_JSON
    if (!fwp) return null
    return {
      ajaxurl: fwp.ajaxurl as string,
      facetNames: fwp.preload_data
        ? Object.keys(fwp.preload_data.facets || {})
        : [],
      totalRows: fwp.preload_data?.settings?.pager?.total_rows as number,
      perPage: fwp.preload_data?.settings?.pager?.per_page as number,
    }
  })

  if (!fwpConfig) {
    throw new Error('FWP_JSON not found on page — site may not use FacetWP')
  }

  console.log(`[${dealer.name}] FacetWP detected: ${fwpConfig.totalRows} total items, ${fwpConfig.facetNames.length} facets`)

  // 3. Build facets object with all facet names empty
  const facets: Record<string, string[] | string> = {}
  for (const name of fwpConfig.facetNames) {
    facets[name] = name === 'search' ? '' : []
  }

  // Apply location filter if configured
  if (locationId) {
    facets.location = [locationId]
    console.log(`[${dealer.name}] Filtering by location ID: ${locationId}`)
  }

  // 4. Fetch first page to get total
  const apiUrl = fwpConfig.ajaxurl
  console.log(`[${dealer.name}] Fetching page 1 from FacetWP API...`)

  const firstPage = await page.evaluate(
    async ({ apiUrl, facets, template }) => {
      const resp = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'facetwp_refresh',
          data: {
            facets,
            frozen_facets: { proximity: 'hard' },
            http_params: { get: {}, uri: 'inventory', url_vars: [] },
            template,
            extras: { selections: true, sort: 'default' },
            soft_refresh: 1,
            is_bfcache: 0,
            first_load: 0,
            paged: 1,
          },
        }),
      })
      if (!resp.ok) return { error: `HTTP ${resp.status}`, template: '', pager: null }
      const data = await resp.json()
      return {
        error: null,
        template: data.template || '',
        pager: data.settings?.pager || null,
      }
    },
    { apiUrl, facets, template }
  )

  if (firstPage.error) {
    throw new Error(`FacetWP API error: ${firstPage.error}`)
  }

  const pager = firstPage.pager as { total_rows: number; total_pages: number; per_page: number }
  if (!pager) {
    throw new Error('FacetWP response missing pager data')
  }

  console.log(`[${dealer.name}] Filtered results: ${pager.total_rows} items across ${pager.total_pages} pages`)

  // 5. Parse first page
  const allCards: FwpCard[] = parseCards(firstPage.template)
  console.log(`[${dealer.name}] Page 1: ${allCards.length} items`)

  // 6. Fetch remaining pages
  for (let pg = 2; pg <= pager.total_pages; pg++) {
    console.log(`[${dealer.name}] Fetching page ${pg}/${pager.total_pages}...`)

    const pageResult = await page.evaluate(
      async ({ apiUrl, facets, template, pageNum }) => {
        const resp = await fetch(apiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'facetwp_refresh',
            data: {
              facets,
              frozen_facets: { proximity: 'hard' },
              http_params: {
                get: { _paged: String(pageNum) },
                uri: 'inventory',
                url_vars: [],
              },
              template,
              extras: { selections: true, sort: 'default' },
              soft_refresh: 1,
              is_bfcache: 0,
              first_load: 0,
              paged: String(pageNum),
            },
          }),
        })
        if (!resp.ok) return { error: `HTTP ${resp.status}`, template: '' }
        const data = await resp.json()
        return { error: null, template: data.template || '' }
      },
      { apiUrl, facets, template, pageNum: pg }
    )

    if (pageResult.error) {
      console.warn(`[${dealer.name}] Page ${pg} failed: ${pageResult.error}`)
      continue
    }

    const pageCards = parseCards(pageResult.template)
    allCards.push(...pageCards)
    console.log(`[${dealer.name}] Page ${pg}: ${pageCards.length} items (total: ${allCards.length})`)
  }

  console.log(`[${dealer.name}] FacetWP adapter returned ${allCards.length} items`)
  return allCards
}

/**
 * Parse FacetWP HTML template into structured card data.
 * Runs in Node context (not browser), so uses regex parsing.
 */
function parseCards(html: string): FwpCard[] {
  const cards: FwpCard[] = []
  if (!html) return cards

  // Split by inventory-card divs
  const cardRegex = /<div class="inventory-card">([\s\S]*?)(?=<div class="inventory-card">|$)/g
  let match: RegExpExecArray | null
  while ((match = cardRegex.exec(html)) !== null) {
    const cardHtml = match[1]

    // Title + URL
    const titleMatch = cardHtml.match(/<h3[^>]*>[\s\S]*?<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/)
    const title = titleMatch?.[2]?.replace(/<[^>]+>/g, '').trim() || ''
    const url = titleMatch?.[1]?.trim() || ''

    // Subtitle
    const subtitleMatch = cardHtml.match(/<h4[^>]*>([\s\S]*?)<\/h4>/)
    const subtitle = subtitleMatch?.[1]?.replace(/<[^>]+>/g, '').trim() || ''

    // MSRP
    const msrpMatch = cardHtml.match(/MSRP[\s\S]*?<p[^>]*>\$([\d,]+)/)
    const msrp = msrpMatch ? `$${msrpMatch[1]}` : null

    // Trailer World Price (sale price)
    const priceMatch = cardHtml.match(/Trailer World Price[\s\S]*?<p[^>]*>\$([\d,]+)/)
    const price = priceMatch ? `$${priceMatch[1]}` : null

    // Condition
    const condMatch = cardHtml.match(/Condition:<br><b>([^<]+)<\/b>/)
    const condition = condMatch?.[1]?.trim() || null

    // Location
    const locMatch = cardHtml.match(/Location:<br><b>([^<]+)<\/b>/)
    const location = locMatch?.[1]?.trim() || null

    // VIN from data-vin attribute
    const vinMatch = cardHtml.match(/data-vin="([^"]*)"/)
    const vin = vinMatch?.[1]?.trim() || null

    // Post ID from data-trailer attribute
    const postIdMatch = cardHtml.match(/data-trailer="([^"]*)"/)
    const postId = postIdMatch?.[1] || null

    // Badges
    const badges: string[] = []
    const badgeRegex = /<div class="badge[^"]*">([^<]+)<\/div>/g
    let badgeMatch: RegExpExecArray | null
    while ((badgeMatch = badgeRegex.exec(cardHtml)) !== null) {
      badges.push(badgeMatch[1].trim())
    }

    if (title || url) {
      cards.push({ title, subtitle, url, msrp, price, condition, location, vin, postId, badges })
    }
  }

  return cards
}
