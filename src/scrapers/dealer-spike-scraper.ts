/**
 * Shared base scraper for Dealer Spike-style sites.
 *
 * Both Rigsbee Trailers and LB's Trailers use the same WordPress + Divi
 * inventory platform with identical HTML structure:
 *   - div.item-info (listing card)
 *   - span.prefix (condition)
 *   - span.label (title)
 *   - div.price > span (price)
 *   - div.stock > span:nth-child(2) (stock number)
 *   - div.specs-first > div (spec key/value pairs)
 *
 * Loads via infinite scroll (25 items per batch).
 * The ?page=N URL parameter is ignored by these sites.
 */

import type { Page } from 'playwright'
import type { RawInventoryItem } from '../types/database.js'
import { BaseScraper } from './base-scraper.js'

export abstract class DealerSpikeScraper extends BaseScraper {
  abstract inventoryPath: string

  async scrapeInventory(page: Page): Promise<RawInventoryItem[]> {
    const url = `${this.baseUrl}${this.inventoryPath}`
    console.log(`[${this.name}] Navigating to ${url}`)

    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 })
    await page.waitForTimeout(3000)

    // Scroll to bottom repeatedly to load all items via infinite scroll
    let prevCount = 0
    let stableRounds = 0
    const maxScrolls = 100 // safety cap

    for (let i = 0; i < maxScrolls; i++) {
      const currentCount = await page.locator('.item-info').count()

      if (currentCount === prevCount) {
        stableRounds++
        if (stableRounds >= 3) {
          console.log(`[${this.name}] No new items after 3 scrolls — all ${currentCount} loaded`)
          break
        }
      } else {
        stableRounds = 0
        if (i % 3 === 0 || currentCount !== prevCount) {
          console.log(`[${this.name}] Scroll ${i + 1}: ${currentCount} items loaded`)
        }
      }

      prevCount = currentCount
      await page.evaluate('window.scrollTo(0, document.body.scrollHeight)')
      await page.waitForTimeout(2000)
    }

    const totalCards = await page.locator('.item-info').count()
    console.log(`[${this.name}] Extracting data from ${totalCards} cards...`)

    // Extract all items from the fully loaded page
    const pageItems = await page.evaluate(`
      (function() {
        var cards = document.querySelectorAll('.item-info');
        var results = [];

        for (var i = 0; i < cards.length; i++) {
          var card = cards[i];

          // Title: span.prefix (condition) + span.label
          var prefix = card.querySelector('.title .prefix');
          var label = card.querySelector('.title .label');
          var condition = prefix ? prefix.textContent.trim() : '';
          var fullTitle = label ? label.textContent.trim() : '';

          // Price
          var priceEl = card.querySelector('.price span');
          var priceText = priceEl ? priceEl.textContent.trim() : '';

          // MSRP
          var msrpEl = card.querySelector('.msrp span');
          var msrpText = msrpEl ? msrpEl.textContent.trim() : '';

          // Stock number
          var stockSpans = card.querySelectorAll('.stock span');
          var stockNum = stockSpans.length >= 2 ? stockSpans[1].textContent.trim() : '';

          // Specs (key-value pairs in div.specs-first > div)
          var specs = {};
          var specDivs = card.querySelectorAll('.specs-first > div');
          for (var j = 0; j < specDivs.length; j++) {
            var spans = specDivs[j].querySelectorAll('span');
            if (spans.length >= 2) {
              var key = spans[0].textContent.trim().toLowerCase();
              var val = spans[1].textContent.trim();
              specs[key] = val;
            }
          }

          // Banners (sale, sold, etc)
          var banners = [];
          var bannerEls = card.querySelectorAll('.banners .banner');
          for (var k = 0; k < bannerEls.length; k++) {
            banners.push(bannerEls[k].textContent.trim().toLowerCase());
          }

          // Detail URL from view-details button's parent link, or from the card's link
          var detailLink = card.closest('a') || card.querySelector('a[href]');
          var detailUrl = detailLink ? detailLink.getAttribute('href') : '';

          results.push({
            condition: condition,
            title: fullTitle,
            price: priceText,
            msrp: msrpText,
            stockNumber: stockNum,
            specs: specs,
            banners: banners,
            url: detailUrl,
          });
        }

        return JSON.stringify(results);
      })()
    `) as string

    const parsed = JSON.parse(pageItems) as Array<{
      condition: string
      title: string
      price: string
      msrp: string
      stockNumber: string
      specs: Record<string, string>
      banners: string[]
      url: string
    }>

    const items: RawInventoryItem[] = []
    const seenStocks = new Set<string>()

    for (const listing of parsed) {
      if (!listing.stockNumber) continue
      if (seenStocks.has(listing.stockNumber)) continue
      seenStocks.add(listing.stockNumber)

      // Skip sold items
      if (listing.banners.includes('sold')) continue

      const titleParts = this.parseListingTitle(listing.title)

      items.push({
        stock_number: listing.stockNumber,
        title: `${listing.condition} ${listing.title}`.trim(),
        make: titleParts.make,
        model: titleParts.model,
        type: titleParts.type,
        price: listing.price,
        condition: listing.condition || undefined,
        floor_length: listing.specs['floor length'] || undefined,
        gvwr: listing.specs['gvwr'] || undefined,
        color: listing.specs['color'] || undefined,
        pull_type: listing.specs['pull type'] || undefined,
        size: listing.specs['width']
          ? `${listing.specs['width']}x${listing.specs['floor length'] || ''}`
          : undefined,
        url: listing.url
          ? (listing.url.startsWith('http') ? listing.url : `${this.baseUrl}${listing.url}`)
          : undefined,
        year: titleParts.year,
      })
    }

    console.log(`[${this.name}] Total scraped: ${items.length} unique items`)
    return items
  }

  /** Parse "2026 Diamond T 8318SUCH Utility Trailer" into parts */
  private parseListingTitle(title: string): {
    year?: string
    make?: string
    model?: string
    type?: string
  } {
    if (!title) return {}

    // Year
    const yearMatch = title.match(/\b(19|20)\d{2}\b/)
    const year = yearMatch?.[0]

    let rest = year ? title.replace(year, '').trim() : title

    // Type: check end of title for common types
    const typePatterns: [RegExp, string][] = [
      [/\butility\s*trailer\b/i, 'Utility'],
      [/\blandscape\s*trailer\b/i, 'Utility'],
      [/\benclosed\s*trailer\b/i, 'Enclosed'],
      [/\bcargo\s*trailer\b/i, 'Enclosed'],
      [/\bdump\s*trailer\b/i, 'Dump'],
      [/\bcar\s*hauler\b/i, 'Car Hauler'],
      [/\bequipment\s*trailer\b/i, 'Equipment'],
      [/\bflatbed\s*trailer\b/i, 'Flatbed'],
      [/\btilt\s*trailer\b/i, 'Tilt'],
      [/\bgooseneck\s*trailer\b/i, 'Gooseneck'],
      [/\bhorse\s*trailer\b/i, 'Livestock'],
      [/\blivestock\s*trailer\b/i, 'Livestock'],
      [/\bdeckover\s*trailer\b/i, 'Flatbed'],
      [/\btruck\s*bed\b/i, 'Truck Bed'],
      [/\bpaving\s*trailer\b/i, 'Equipment'],
      [/\bconcession\s*trailer\b/i, 'Enclosed'],
    ]

    let type: string | undefined
    for (const [pat, val] of typePatterns) {
      if (pat.test(title)) {
        type = val
        rest = rest.replace(pat, '').trim()
        break
      }
    }

    // Make and model: what remains after removing year and type
    // First word(s) are typically the make, rest is model
    const parts = rest.split(/\s+/).filter(Boolean)
    let make: string | undefined
    let model: string | undefined

    if (parts.length >= 2) {
      // Check if first two words are a known multi-word make
      const twoWord = `${parts[0]} ${parts[1]}`
      if (/^(diamond [tc]|big tex|carry[ -]on|iron bull|load trail|down 2|sure[ -]trac|trails west|top hat)/i.test(twoWord)) {
        make = twoWord
        model = parts.slice(2).join(' ') || undefined
      } else {
        make = parts[0]
        model = parts.slice(1).join(' ') || undefined
      }
    } else if (parts.length === 1) {
      make = parts[0]
    }

    return { year, make, model, type }
  }
}
