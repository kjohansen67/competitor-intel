/**
 * DealSector admin-ajax.php adapter.
 *
 * Single POST to /wp-admin/admin-ajax.php with limit=1000 to get all items.
 * Parses HTML response with DOMParser using Stock # anchor strategy.
 *
 * Extracted from: src/scrapers/tjs-trailers.ts
 */

import type { Page } from 'playwright'
import type { DealerConfig } from '../schema/inventory-item.js'

export interface DsListing {
  title: string
  price: string
  stock: string
  url: string
  year: string
  condition: string
  size: string
  vin: string
}

export async function scrape(
  page: Page,
  dealer: DealerConfig
): Promise<DsListing[]> {
  const config = dealer.platformConfig || {}
  const templateId = (config.templateId as string) || '143'
  const limit = (config.limit as number) || 1000

  // 1. Navigate to inventory page
  const inventoryUrl = `${dealer.baseUrl}${dealer.inventoryPath}`
  console.log(`[${dealer.name}] Navigating to ${inventoryUrl}...`)
  await page.goto(inventoryUrl, { waitUntil: 'networkidle', timeout: 60_000 })
  await page.waitForTimeout(3000)

  // 2. Get total record count for validation
  const totalRecords = await page.evaluate(() => {
    const el = document.getElementById('record_total')
    return el ? parseInt(el.textContent?.trim() || '0', 10) : 0
  })
  console.log(`[${dealer.name}] Page reports ${totalRecords} total records`)

  // 3. Single fetch with limit=1000 to get everything at once
  console.log(`[${dealer.name}] Fetching all items (limit=${limit})...`)

  const rawJson = await page.evaluate(
    ({ limit, templateId }) => {
      return fetch('/wp-admin/admin-ajax.php', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
          'X-Requested-With': 'XMLHttpRequest',
        },
        body: new URLSearchParams({
          action: 'dealsector_filter_inventorys',
          version: 'v2',
          product_type: '1',
          limit: String(limit),
          start: '0',
          template_id: templateId,
          isslider: '0',
          isRental: 'false',
          detail_page_link: 'view-detail-page',
          dealerLoginStatus: 'off',
          allfields: 'modelYear,condition,lengthFtIn,widthFtIn,vin',
          stockNo: '',
          search: '',
          price_sort: '',
          price_range: '',
          condition: '',
          category: '',
          make: '',
        }).toString(),
      })
        .then(r => r.text())
        .then(html => {
          if (!html || !html.trim()) return JSON.stringify([])

          const parser = new DOMParser()
          const doc = parser.parseFromString(html, 'text/html')

          // Stock # anchor strategy: find all Stock # elements, walk up to extract context
          const results: Array<Record<string, string>> = []
          const stockEls = doc.querySelectorAll('p.has-text-align-center strong')

          for (let i = 0; i < stockEls.length; i++) {
            const stockEl = stockEls[i]
            const stockText = stockEl.textContent?.trim() || ''
            const stockMatch = stockText.match(/Stock\s*#\s*(\S+)/)
            if (!stockMatch) continue
            const stock = stockMatch[1]

            // Walk up to find the .tb-details table (sibling or nearby)
            const container = stockEl.closest('.wp-block-column')
            const table = container?.querySelector('.tb-details')

            const details: Record<string, string> = {}
            if (table) {
              const rows = table.querySelectorAll('tr')
              for (let r = 0; r < rows.length; r++) {
                const th = rows[r].querySelector('th')
                const td = rows[r].querySelector('td')
                if (th && td) {
                  details[th.textContent!.trim().replace(':', '')] = td.textContent!.trim()
                }
              }
            }

            // Walk up to .wp-block-columns, then previous sibling for title/price
            const columnsRow = container?.closest('.wp-block-columns')
            let titleRow = columnsRow?.previousElementSibling || null
            while (titleRow && titleRow.tagName === 'HR') {
              titleRow = titleRow.previousElementSibling
            }

            let title = ''
            let price = ''
            let url = ''
            if (titleRow) {
              const titleLink = titleRow.querySelector('a[href*="view-detail-page"]')
              title = titleLink ? titleLink.textContent!.trim() : ''
              url = titleLink ? titleLink.getAttribute('href') || '' : ''
              const priceEl = titleRow.querySelector('.has-text-align-right strong span')
              price = priceEl ? priceEl.textContent!.trim() : ''
            }

            results.push({
              title, price, stock, url,
              year: details['Year'] || '',
              condition: details['Condition'] || '',
              size: details['Size'] || '',
              vin: details['VIN'] || '',
            })
          }

          return JSON.stringify(results)
        })
        .catch(e => JSON.stringify({ error: (e as Error).message }))
    },
    { limit, templateId }
  )

  let items: DsListing[]
  try {
    const parsed = JSON.parse(rawJson as string)
    if (parsed.error) {
      throw new Error(`DealSector AJAX error: ${parsed.error}`)
    }
    items = parsed
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('DealSector')) throw err
    throw new Error(`Failed to parse DealSector response`)
  }

  console.log(`[${dealer.name}] Parsed ${items.length} listings (page reported ${totalRecords})`)

  if (totalRecords > 0 && items.length < totalRecords * 0.9) {
    console.warn(
      `[${dealer.name}] WARNING: Got ${items.length} but page reports ${totalRecords}. ` +
      `May need batched fetching if endpoint caps results.`
    )
  }

  return items
}
