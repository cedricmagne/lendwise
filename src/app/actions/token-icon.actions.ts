'use server'

import { unstable_cache } from 'next/cache'

import { getTokenIconBySymbol } from '@/lib/coingecko'

/**
 * Token icon URL lookup (formerly GET /api/token-icon).
 *
 * Two cache layers, both shared across instances:
 *  - `unstable_cache` on the symbol → URL resolution (24h, keyed by symbol) —
 *    replaces the old route's per-instance in-memory Map.
 *  - The Data Cache on the underlying CoinGecko fetches (coins/list 24h,
 *    coin details 7d) inside lib/coingecko.
 * The client adds localStorage on top (permanent per browser, see useTokenIcon).
 */

const ICON_NOT_FOUND = 'ICON_NOT_FOUND'

const cachedIconUrl = unstable_cache(
  async (symbol: string) => {
    const url = await getTokenIconBySymbol(symbol)
    // unstable_cache stores every resolved value, including null — and a null
    // here may be a transient upstream failure (lib/coingecko swallows fetch
    // errors into null), which must not be remembered for 24h. Throwing skips
    // the store; getTokenIcon maps it back to null.
    if (!url) throw new Error(ICON_NOT_FOUND)
    return url
  },
  ['token-icon'],
  { revalidate: 60 * 60 * 24 }
)

export async function getTokenIcon(symbol: string): Promise<string | null> {
  const normalized = symbol.trim().toLowerCase()
  if (!/^[a-z0-9+.$_-]{1,32}$/.test(normalized)) return null

  try {
    return await cachedIconUrl(normalized)
  } catch (error) {
    if (error instanceof Error && error.message === ICON_NOT_FOUND) return null
    throw error
  }
}
