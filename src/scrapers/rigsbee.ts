/**
 * Rigsbee Trailers scraper — rigsbeetrailers.com
 *
 * Uses the Dealer Spike-style platform (WordPress + Divi).
 * 332 units, 25 per page, URL pagination: ?page=N
 */

import { DealerSpikeScraper } from './dealer-spike-scraper.js'
import { registerScraper } from './registry.js'

export class RigsbeeScraper extends DealerSpikeScraper {
  name = 'Rigsbee Trailers'
  baseUrl = 'https://www.rigsbeetrailers.com'
  inventoryPath = '/all-inventory/'
}

registerScraper('rigsbee', () => new RigsbeeScraper())
