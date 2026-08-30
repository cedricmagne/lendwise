import { getCoinGeckoId } from '@/lib/crypto-mapping'

const COINGECKO_API = 'https://api.coingecko.com/api/v3'

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * CoinGecko's free tier rate-limits aggressively (429). Retry a couple of
 * times with backoff before giving up, same pattern as lib/defillama.ts.
 */
async function fetchWithRetry(
  url: string,
  init: RequestInit,
  attempt = 0
): Promise<Response> {
  const res = await fetch(url, init)
  if ((res.status === 429 || res.status >= 500) && attempt < 2) {
    await sleep(attempt === 0 ? 1000 : 3000)
    return fetchWithRetry(url, init, attempt + 1)
  }
  return res
}

export type CoinGeckoCoin = {
  id: string
  symbol: string
  name: string
}

export type CoinGeckoDetail = {
  id: string
  symbol: string
  name: string
  image: {
    thumb: string
    small: string
    large: string
  }
}

/**
 * Search for a coin by its symbol
 * Returns the CoinGecko ID if found
 */
export async function searchCoinBySymbol(
  symbol: string
): Promise<string | null> {
  // Known symbols skip the coins/list scan (a full-catalog payload) entirely.
  const knownId = getCoinGeckoId(symbol)
  if (knownId) return knownId

  try {
    const res = await fetchWithRetry(
      `${COINGECKO_API}/coins/list?include_platform=false`,
      {
        next: { revalidate: 60 * 60 * 24 }, // 24h cache for coin list
      }
    )

    if (!res.ok) {
      console.error('CoinGecko API error:', res.status, res.statusText)
      return null
    }

    const list: CoinGeckoCoin[] = await res.json()

    // Try exact match first
    const exactMatch = list.find(
      (c) => c.symbol.toLowerCase() === symbol.toLowerCase()
    )
    if (exactMatch) return exactMatch.id

    // Fallback: find first match (some symbols have multiple coins)
    const coin = list.find((c) =>
      c.symbol.toLowerCase().includes(symbol.toLowerCase())
    )
    return coin?.id || null
  } catch (error) {
    console.error('Error searching coin by symbol:', error)
    return null
  }
}

/**
 * Get coin icon URL from CoinGecko
 * Returns small image URL (64x64)
 */
export async function getCoinIconUrl(id: string): Promise<string | null> {
  try {
    const res = await fetchWithRetry(`${COINGECKO_API}/coins/${id}`, {
      next: { revalidate: 60 * 60 * 24 * 7 }, // 7 days cache for coin details
    })

    if (!res.ok) {
      console.error('CoinGecko API error:', res.status, res.statusText)
      return null
    }

    const data: CoinGeckoDetail = await res.json()
    return data?.image?.small || data?.image?.thumb || null
  } catch (error) {
    console.error('Error fetching coin icon:', error)
    return null
  }
}

/**
 * Combined function to get icon URL by symbol
 * This is the main function to use
 */
export async function getTokenIconBySymbol(
  symbol: string
): Promise<string | null> {
  const id = await searchCoinBySymbol(symbol)
  if (!id) return null
  return getCoinIconUrl(id)
}
