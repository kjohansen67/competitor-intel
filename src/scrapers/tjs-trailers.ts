/**
 * TJ's Trailers scraper — tjstrailers.com
 *
 * Uses WordPress + Elementor + DealSector inventory plugin.
 * ~252 records, loaded via admin-ajax.php POST requests.
 *
 * Instead of clicking the "Load More" button (which DealSector hides/shows
 * unpredictably), we call the AJAX endpoint directly with increasing offsets
 * and inject the HTML responses into the DOM for extraction.
 *
 * DealSector AJAX endpoint:
 *   POST /wp-admin/admin-ajax.php
 *   action=dealsector_filter_inventorys&version=v2&product_type=1
 *   limit=50&start=0&template_id=143
 *
 * HTML structure per listing:
 *   - a[href*="view-detail-page"] → title + detail URL
 *   - Cash/Check Price: $xx,xxx in a <p> tag
 *   - figure.tb-details table → Year, Condition, Size, VIN
 *   - Stock # in a <strong><a> tag
 */

import type { Page } from 'playwright'
import type { RawInventoryItem } from '../types/database.js'
import { BaseScraper } from './base-scraper.js'
import { registerScraper } from './registry.js'

export class TjsTrailersScraper extends BaseScraper {
  name = "TJ's Trailers"
  baseUrl = 'https://tjstrailers.com'

  async scrapeInventory(page: Page): Promise<RawInventoryItem[]> {
    console.log(`[${this.name}] Navigating to inventory page...`)

    await page.goto(`${this.baseUrl}/inventory/`, {
      waitUntil: 'networkidle',
      timeout: 30000,
    })
    await page.waitForTimeout(3000)

    // Get total record count from the page
    const totalText = await page.evaluate(`
      (function() {
        var el = document.getElementById('record_total');
        return el ? el.textContent.trim() : '0';
      })()
    `) as string
    const totalRecords = parseInt(totalText, 10) || 0
    console.log(`[${this.name}] Total records: ${totalRecords}`)

    // Fetch ALL inventory via DealSector's admin-ajax.php endpoint directly,
    // parsing each response's HTML with DOMParser (avoids DealSector's live JS
    // removing injected content from the page DOM).
    const batchSize = 50
    const allItems: Array<{
      title: string; price: string; stock: string; url: string
      year: string; condition: string; size: string; vin: string
    }> = []

    for (let start = 0; start < totalRecords; start += batchSize) {
      console.log(`[${this.name}] Fetching batch start=${start}, limit=${batchSize}...`)

      const batchJson = await page.evaluate(`
        (function() {
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
              limit: '${batchSize}',
              start: '${start}',
              template_id: '143',
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
          .then(function(r) { return r.text(); })
          .then(function(html) {
            if (!html || !html.trim()) return JSON.stringify([]);

            // Parse the AJAX response HTML in an isolated document
            var parser = new DOMParser();
            var doc = parser.parseFromString(html, 'text/html');
            var tables = doc.querySelectorAll('.tb-details');
            var results = [];

            for (var i = 0; i < tables.length; i++) {
              var table = tables[i];

              // Extract details from table rows (Year, Condition, Size, VIN)
              var details = {};
              var rows = table.querySelectorAll('tr');
              for (var r = 0; r < rows.length; r++) {
                var th = rows[r].querySelector('th');
                var td = rows[r].querySelector('td');
                if (th && td) {
                  details[th.textContent.trim().replace(':', '')] = td.textContent.trim();
                }
              }

              // Stock # is in a <p> sibling after the table
              var stockEl = table.parentElement
                ? table.parentElement.querySelector('p.has-text-align-center strong')
                : null;
              var stockText = stockEl ? stockEl.textContent.trim() : '';
              var stockMatch = stockText.match(/Stock\\s*#\\s*(\\S+)/);
              var stock = stockMatch ? stockMatch[1] : '';

              // Walk up to the .wp-block-columns row containing this table
              var column = table.closest('.wp-block-column');
              var columnsRow = column ? column.closest('.wp-block-columns') : null;

              // Title and price are in the PREVIOUS .wp-block-columns sibling
              var titleRow = columnsRow ? columnsRow.previousElementSibling : null;
              while (titleRow && titleRow.tagName === 'HR') {
                titleRow = titleRow.previousElementSibling;
              }

              var title = '';
              var price = '';
              var url = '';
              if (titleRow) {
                var titleLink = titleRow.querySelector('a[href*="view-detail-page"]');
                title = titleLink ? titleLink.textContent.trim() : '';
                url = titleLink ? titleLink.getAttribute('href') || '' : '';

                var priceEl = titleRow.querySelector('.has-text-align-right strong span');
                price = priceEl ? priceEl.textContent.trim() : '';
              }

              results.push({
                title: title,
                price: price,
                stock: stock,
                url: url,
                year: details['Year'] || '',
                condition: details['Condition'] || '',
                size: details['Size'] || '',
                vin: details['VIN'] || '',
              });
            }

            return JSON.stringify(results);
          })
          .catch(function(e) {
            return JSON.stringify({ error: e.message });
          });
        })()
      `) as string

      let batchItems: typeof allItems
      try {
        const parsed = JSON.parse(batchJson)
        if (parsed.error) {
          console.log(`[${this.name}] AJAX error at start=${start}: ${parsed.error}`)
          break
        }
        batchItems = parsed
      } catch {
        console.log(`[${this.name}] Failed to parse batch response at start=${start}`)
        break
      }

      if (batchItems.length === 0) {
        console.log(`[${this.name}] Empty batch at start=${start}, stopping`)
        break
      }

      allItems.push(...batchItems)
      console.log(`[${this.name}] Batch: ${batchItems.length} items, total so far: ${allItems.length}`)

      // Brief delay between requests
      await this.delay(1000, 2000)
    }

    console.log(`[${this.name}] Fetched ${allItems.length} total listings via AJAX`)

    const parsed = allItems

    console.log(`[${this.name}] Extracted ${parsed.length} unique listings`)

    // Convert to RawInventoryItem
    const items: RawInventoryItem[] = []

    for (const listing of parsed) {
      if (!listing.stock) continue

      const titleParts = this.parseTitle(listing.title)

      items.push({
        stock_number: listing.stock,
        title: listing.title,
        make: titleParts.make,
        model: titleParts.model,
        type: titleParts.type,
        price: listing.price,
        condition: listing.condition || undefined,
        size: listing.size || undefined,
        floor_length: this.extractLength(listing.size),
        url: listing.url.startsWith('http')
          ? listing.url
          : `${this.baseUrl}${listing.url}`,
        year: listing.year || titleParts.year,
      })
    }

    return items
  }

  /** Parse TJ's title format: "DIAMOND C 8X35+5 GOOSENECK EQUIPMENT TRAILER" */
  private parseTitle(title: string): {
    year?: string
    make?: string
    model?: string
    type?: string
  } {
    if (!title) return {}

    const normalized = title.toUpperCase()

    const typePatterns: [RegExp, string][] = [
      [/\bUTILITY\b/i, 'Utility'],
      [/\bLANDSCAPE\b/i, 'Utility'],
      [/\bENCLOSED\b/i, 'Enclosed'],
      [/\bCARGO\b/i, 'Enclosed'],
      [/\bDUMP\b/i, 'Dump'],
      [/\bCAR\s*HAULER\b/i, 'Car Hauler'],
      [/\bEQUIPMENT\b/i, 'Equipment'],
      [/\bFLATBED\b/i, 'Flatbed'],
      [/\bTILT\b/i, 'Tilt'],
      [/\bGOOSENECK\b/i, 'Gooseneck'],
      [/\bCONCESSION\b/i, 'Enclosed'],
      [/\bALUMINUM\b/i, 'Aluminum'],
      [/\bGOLF\s*CART\b/i, 'Golf Cart'],
      [/\bATV\b/i, 'ATV'],
    ]

    let type: string | undefined
    for (const [pat, val] of typePatterns) {
      if (pat.test(normalized)) { type = val; break }
    }

    const words = title.split(/\s+/).filter(Boolean)
    let make: string | undefined
    let model: string | undefined

    if (words.length >= 2) {
      const twoWord = `${words[0]} ${words[1]}`
      if (/^(DIAMOND C|BIG TEX|LOAD TRAIL|DOWN 2|SURE.TRAC|IRON BULL|TOP HAT)/i.test(twoWord)) {
        make = this.titleCase(twoWord)
        model = words.slice(2, 4).join(' ')
      } else {
        make = this.titleCase(words[0])
        model = words.slice(1, 3).join(' ')
      }
    } else if (words.length === 1) {
      make = this.titleCase(words[0])
    }

    return { make, model, type }
  }

  private extractLength(size: string | undefined): string | undefined {
    if (!size) return undefined
    const match = size.match(/(\d+)'/)
    return match ? `${match[1]}ft` : undefined
  }

  private titleCase(str: string): string {
    return str
      .toLowerCase()
      .split(' ')
      .map(w => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ')
  }
}

registerScraper('tjs-trailers', () => new TjsTrailersScraper())
