/**
 * TJ's Trailers scraper — tjstrailers.com
 *
 * Uses WordPress + Elementor + DealSector inventory plugin.
 * 252 records, 10 per page, "Load More" AJAX pagination.
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

    // Get total record count
    const totalText = await page.evaluate(`
      (function() {
        var el = document.getElementById('record_total');
        return el ? el.textContent.trim() : '0';
      })()
    `) as string
    const totalRecords = parseInt(totalText, 10) || 0
    console.log(`[${this.name}] Total records: ${totalRecords}`)

    // Click "Load More" until all items are loaded
    let loadMoreClicks = 0
    const maxClicks = Math.ceil(totalRecords / 10) + 5 // Safety margin

    while (loadMoreClicks < maxClicks) {
      const loadMoreBtn = page.locator('.loadMore_Wrapper')
      const isVisible = await loadMoreBtn.isVisible().catch(() => false)

      if (!isVisible) {
        console.log(`[${this.name}] No more "Load More" button — all items loaded`)
        break
      }

      await loadMoreBtn.click()
      loadMoreClicks++
      await this.delay(1500, 2500)

      if (loadMoreClicks % 5 === 0) {
        const currentCount = await page.locator('a[href*="view-detail-page"]').count()
        console.log(`[${this.name}] Loaded ${currentCount} items after ${loadMoreClicks} clicks`)
      }
    }

    // Extract all items from the fully loaded page.
    // Strategy: iterate .tb-details tables (one per listing), then walk
    // to the previous sibling .wp-block-columns row for title + price.
    const itemsJson = await page.evaluate(`
      (function() {
        var container = document.getElementById('dealsector_showresults');
        if (!container) return '[]';

        var tables = container.querySelectorAll('.tb-details');
        var results = [];

        for (var i = 0; i < tables.length; i++) {
          var table = tables[i];

          // Extract details from this table (Year, Condition, Size, VIN)
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
          var stockEl = table.parentElement.querySelector('p.has-text-align-center strong');
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
      })()
    `) as string

    const parsed = JSON.parse(itemsJson) as Array<{
      title: string
      price: string
      stock: string
      url: string
      year: string
      condition: string
      size: string
      vin: string
    }>

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

    // TJ's titles are often ALL CAPS
    const normalized = title.toUpperCase()

    // Type detection
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

    // Make: first word or two
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

  /** Extract length from size string like "40' x 102"" → "40" */
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
