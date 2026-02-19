/**
 * Debug artifact writer — saves screenshot + error details on failure.
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Page } from 'playwright'

export async function saveDebugArtifacts(
  page: Page | null,
  error: unknown,
  outputDir: string
): Promise<void> {
  const debugDir = join(outputDir, 'debug')
  mkdirSync(debugDir, { recursive: true })

  // Save error details
  const errorInfo = {
    message: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
    timestamp: new Date().toISOString(),
    url: null as string | null,
  }

  try {
    if (page) {
      errorInfo.url = page.url()
      await page.screenshot({ path: join(debugDir, 'screenshot.png'), fullPage: true })
      console.log(`  Debug screenshot saved to ${join(debugDir, 'screenshot.png')}`)
    }
  } catch {
    // Screenshot may fail if browser is closed
  }

  writeFileSync(join(debugDir, 'error.json'), JSON.stringify(errorInfo, null, 2) + '\n', 'utf-8')
  console.log(`  Debug error saved to ${join(debugDir, 'error.json')}`)
}
