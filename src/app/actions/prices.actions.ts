'use server'

/**
 * Crypto price lookup (formerly GET /api/prices).
 *
 * Proxies CoinGecko simple/price so the client never talks to CoinGecko
 * directly (CORS, quota). The upstream call goes through the Next.js Data
 * Cache (`next.revalidate`) — one CoinGecko request per distinct
 * (ids, currencies) tuple per hour, shared across all users — which is the
 * layer that actually protects the CoinGecko quota. Callers keep their own
 * 1h client-side cache on top (see useCryptoPrices).
 */

const COINGECKO_URL = 'https://api.coingecko.com/api/v3/simple/price'

/** CoinGecko ids and currency codes: lowercase slugs, no URL metacharacters. */
const SLUG_RE = /^[a-z0-9-]{1,64}$/

export type PricesResult = Record<string, Record<string, number>>

export async function getPrices(
  coinIds: string[],
  vsCurrencies: string,
  include24hChange = true
): Promise<PricesResult> {
  const ids = coinIds.map((id) => id.trim().toLowerCase()).filter(Boolean)
  const vs = vsCurrencies.trim().toLowerCase()

  if (ids.length === 0 || ids.length > 50) {
    throw new Error('getPrices: between 1 and 50 coin ids required')
  }
  if (!ids.every((id) => SLUG_RE.test(id)) || !SLUG_RE.test(vs)) {
    throw new Error('getPrices: invalid coin id or currency')
  }

  const params = new URLSearchParams({
    ids: ids.join(','),
    vs_currencies: vs,
    include_24hr_change: String(include24hChange),
  })

  const response = await fetch(`${COINGECKO_URL}?${params}`, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'Lendwise/1.0',
    },
    next: { revalidate: 3600 },
  })

  if (!response.ok) {
    throw new Error(`CoinGecko API error: ${response.status}`)
  }

  return response.json()
}
