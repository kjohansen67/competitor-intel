/**
 * LB's Trailers scraper — lbstrailer.com
 *
 * Uses the same Dealer Spike-style platform as Rigsbee (WordPress + Divi).
 * 219 units, 25 per page, URL pagination: ?page=N
 */

import { DealerSpikeScraper } from './dealer-spike-scraper.js'
import { registerScraper } from './registry.js'

export class LbsTrailersScraper extends DealerSpikeScraper {
  name = "LB's Trailers"
  baseUrl = 'https://www.lbstrailer.com'
  inventoryPath = '/all-inventory/'
}

registerScraper('lbs-trailers', () => new LbsTrailersScraper())
