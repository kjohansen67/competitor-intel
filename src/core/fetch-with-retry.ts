/**
 * Fetch wrapper with retries, timeout, and exponential backoff.
 */

export interface FetchOptions extends RequestInit {
  timeoutMs?: number
  maxRetries?: number
}

export async function fetchWithRetry(
  url: string,
  options: FetchOptions = {}
): Promise<Response> {
  const { timeoutMs = 30_000, maxRetries = 2, ...fetchOpts } = options

  let lastError: Error | null = null

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), timeoutMs)

      const res = await fetch(url, {
        ...fetchOpts,
        signal: controller.signal,
      })

      clearTimeout(timer)

      if (!res.ok && attempt < maxRetries) {
        lastError = new Error(`HTTP ${res.status}: ${res.statusText}`)
        const delay = 1000 * Math.pow(2, attempt)
        console.warn(`[fetch] ${url} returned ${res.status}, retrying in ${delay}ms...`)
        await new Promise(r => setTimeout(r, delay))
        continue
      }

      return res
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err))

      if (attempt < maxRetries) {
        const delay = 1000 * Math.pow(2, attempt)
        console.warn(`[fetch] ${url} failed: ${lastError.message}, retrying in ${delay}ms...`)
        await new Promise(r => setTimeout(r, delay))
      }
    }
  }

  throw lastError || new Error(`fetchWithRetry failed for ${url}`)
}
