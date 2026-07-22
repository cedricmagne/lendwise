import { useEffect, useState } from 'react'

import { getPrices } from '@/app/actions/prices.actions'

// Price data interface matching CoinGecko API response
// Mock data fallback for development/testing when API is unavailable
const MOCK_PRICE_DATA: PriceData = {
  ethereum: {
    usd: 2500,
    usd_24h_change: 2.5,
    eur: 2200,
    eur_24h_change: 2.3,
    btc: 0.05,
    btc_24h_change: 1.8,
    eth: 1,
    eth_24h_change: 0,
  },
}

// Client-side cache to prevent duplicate requests
interface CacheEntry {
  data: PriceData
  timestamp: number
}

const priceCache = new Map<string, CacheEntry>()
const CACHE_DURATION = 3600000 // 1 hour in milliseconds

// Request deduplication: track in-flight requests
const pendingRequests = new Map<string, Promise<PriceData>>()

function getCacheKey(coinIds: string[], currency: string): string {
  return `${coinIds.sort().join(',')}_${currency}`
}

function getCachedPrices(
  coinIds: string[],
  currency: string
): PriceData | null {
  const key = getCacheKey(coinIds, currency)
  const cached = priceCache.get(key)

  if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
    console.log('Using cached prices for:', key)
    return cached.data
  }

  return null
}

function setCachedPrices(
  coinIds: string[],
  currency: string,
  data: PriceData
): void {
  const key = getCacheKey(coinIds, currency)
  priceCache.set(key, {
    data,
    timestamp: Date.now(),
  })
}

function getPendingRequest(
  coinIds: string[],
  currency: string
): Promise<PriceData> | null {
  const key = getCacheKey(coinIds, currency)
  return pendingRequests.get(key) || null
}

function setPendingRequest(
  coinIds: string[],
  currency: string,
  promise: Promise<PriceData>
): void {
  const key = getCacheKey(coinIds, currency)
  pendingRequests.set(key, promise)

  // Clean up after the request completes
  promise.finally(() => {
    pendingRequests.delete(key)
  })
}

export interface CryptoPrice {
  [currency: string]: number | string
  // Dynamic properties based on requested currencies
  // e.g., usd: number, usd_24h_change: number, eur: number, eur_24h_change: number
}

export interface PriceData {
  [coinId: string]: CryptoPrice
}

// Supported currencies
export type Currency = 'usd' | 'eur' | 'btc' | 'eth'

export function useCryptoPrices(
  coinIds: string[] = ['ethereum'],
  currency: Currency = 'usd'
) {
  const [prices, setPrices] = useState<PriceData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [refetchTrigger, setRefetchTrigger] = useState(0)

  useEffect(() => {
    let mounted = true

    const fetchPrices = async () => {
      if (coinIds.length === 0) {
        setPrices({})
        setLoading(false)
        return
      }

      // Check cache first
      const cachedData = getCachedPrices(coinIds, currency)
      if (cachedData) {
        setPrices(cachedData)
        setLoading(false)
        return
      }

      // Check if there's already a pending request for this data
      const pendingRequest = getPendingRequest(coinIds, currency)
      if (pendingRequest) {
        console.log(
          'Waiting for existing request:',
          getCacheKey(coinIds, currency)
        )
        try {
          const data = await pendingRequest
          if (mounted) {
            setPrices(data)
            setLoading(false)
          }
        } catch (err) {
          if (mounted) {
            setError(
              err instanceof Error ? err.message : 'Failed to fetch prices'
            )
            setLoading(false)
          }
        }
        return
      }

      // Create the fetch promise
      const fetchPromise = (async () => {
        const data: PriceData = await getPrices(coinIds, currency, true)

        // Cache the response
        setCachedPrices(coinIds, currency, data)
        return data
      })()

      // Register this as a pending request
      setPendingRequest(coinIds, currency, fetchPromise)

      try {
        setLoading(true)
        setError(null)

        const data = await fetchPromise

        if (mounted) {
          setPrices(data)
          setLoading(false)
        }
      } catch (err) {
        console.error('Price fetch error:', err)

        if (mounted) {
          const errorMessage =
            err instanceof Error ? err.message : 'Failed to fetch prices'

          // Check for common CORS/network errors
          if (
            errorMessage.includes('Failed to fetch') ||
            errorMessage.includes('CORS')
          ) {
            setError(
              'Network error: API may be blocked by CORS policy or unavailable'
            )
          } else {
            setError(errorMessage)
          }
          setLoading(false)
        }
      }
    }

    // Fetch immediately
    fetchPrices()

    // Fallback to mock data after 10 seconds if API fails
    const fallbackTimer = setTimeout(() => {
      if (mounted && !prices) {
        console.log('Using fallback mock data due to API failure')
        setPrices(MOCK_PRICE_DATA)
        setError('Using fallback data - API unavailable')
        setLoading(false)
      }
    }, 10000)

    return () => {
      mounted = false
      clearTimeout(fallbackTimer)
    }
  }, [coinIds.join(','), currency, refetchTrigger])

  const refetch = () => {
    setRefetchTrigger((prev) => prev + 1)
  }

  return { prices, loading, error, refetch }
}

// Hook for single coin price
export function useCryptoPrice(
  coinId: string = 'ethereum',
  currency: Currency = 'usd'
) {
  const result = useCryptoPrices([coinId], currency)

  // Extract the specific currency price from the response
  const priceData = result.prices?.[coinId]
  const currentPrice = priceData ? (priceData[currency] as number) : undefined
  const priceChange = priceData
    ? (priceData[`${currency}_24h_change`] as number)
    : undefined

  return {
    price: currentPrice
      ? {
          current_price: currentPrice,
          price_change_24h: priceChange || 0,
          price_change_percentage_24h: priceChange || 0,
          last_updated: new Date().toISOString(),
        }
      : null,
    loading: result.loading,
    error: result.error,
    refetch: result.refetch,
  }
}

// Get ETH price in USD
export function useEthPrice(currency: Currency = 'usd') {
  const result = useCryptoPrice('ethereum', currency)
  return {
    price: result.price,
    loading: result.loading,
    error: result.error,
    refetch: result.refetch,
  }
}

// Get multiple coin prices in a specific currency
export function useMultiplePrices(
  coinIds: string[],
  currency: Currency = 'usd'
) {
  const { prices, loading, error } = useCryptoPrices(coinIds, currency)

  // Transform the raw price data into the expected format
  const formattedPrices: Record<
    string,
    {
      current_price: number
      price_change_24h: number
      price_change_percentage_24h: number
      last_updated: string
    }
  > = {}

  if (prices) {
    Object.keys(prices).forEach((coinId) => {
      const priceData = prices[coinId]
      const currentPrice = priceData[currency] as number
      const priceChange = priceData[`${currency}_24h_change`] as number

      formattedPrices[coinId] = {
        current_price: currentPrice,
        price_change_24h: priceChange || 0,
        price_change_percentage_24h: priceChange || 0,
        last_updated: new Date().toISOString(),
      }
    })
  }

  return {
    prices: formattedPrices,
    loading,
    error,
  }
}

// Hook for ETH price in multiple currencies
export function useEthPriceMultiCurrency() {
  const usdHook = useEthPrice('usd')
  const eurHook = useEthPrice('eur')
  const btcHook = useEthPrice('btc')

  return {
    usd: usdHook.price,
    eur: eurHook.price,
    btc: btcHook.price,
    loading: usdHook.loading || eurHook.loading || btcHook.loading,
    error: usdHook.error || eurHook.error || btcHook.error,
    refetch: usdHook.refetch, // Use any of the hooks' refetch function
  }
}
