'use client'

import { useCallback, useEffect, useState } from 'react'

import { getPrices } from '@/app/actions/prices.actions'
import { getCurrencyByCode } from '@/config/currencies'

/**
 * Exchange rate data structure
 * Maps target currency CoinGecko ID to its rate against USD
 */
export interface ExchangeRates {
  [coinGeckoId: string]: number
}

/**
 * Cache structure for exchange rates
 */
interface CacheEntry {
  rates: ExchangeRates
  timestamp: number
}

// Client-side cache to prevent duplicate requests
const ratesCache = new Map<string, CacheEntry>()
const CACHE_DURATION = 3600000 // 1 hour in milliseconds

// Request deduplication: track in-flight requests
const pendingRequests = new Map<string, Promise<ExchangeRates>>()

/**
 * Get cached exchange rates if still valid
 */
function getCachedRates(targetCurrency: string): ExchangeRates | null {
  const cached = ratesCache.get(targetCurrency)

  if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
    return cached.rates
  }

  return null
}

/**
 * Cache exchange rates
 */
function setCachedRates(targetCurrency: string, rates: ExchangeRates): void {
  ratesCache.set(targetCurrency, {
    rates,
    timestamp: Date.now(),
  })
}

/**
 * Hook to fetch and manage currency conversion rates from USD to target currency
 * Uses CoinGecko API via our proxy endpoint
 *
 * @param targetCurrencyCode - The currency code to convert to (e.g., 'EUR', 'BTC')
 * @returns Exchange rate, loading state, error, and conversion utilities
 */
export function useCurrencyConverter(targetCurrencyCode: string) {
  const [rate, setRate] = useState<number>(1) // Default to 1 (USD to USD)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Get currency config to find CoinGecko ID
  const targetCurrency = getCurrencyByCode(targetCurrencyCode)

  useEffect(() => {
    let mounted = true

    // If target is USD, no conversion needed
    if (targetCurrencyCode === 'USD') {
      setRate(1)
      setLoading(false)
      setError(null)
      return
    }

    // Validate currency exists
    if (!targetCurrency) {
      setError(`Unsupported currency: ${targetCurrencyCode}`)
      setLoading(false)
      return
    }

    const fetchRate = async () => {
      // Check cache first
      const cachedRates = getCachedRates(targetCurrencyCode)
      if (cachedRates && cachedRates[targetCurrency.coinGeckoId]) {
        setRate(cachedRates[targetCurrency.coinGeckoId])
        setLoading(false)
        return
      }

      // Check if there's already a pending request
      const pendingRequest = pendingRequests.get(targetCurrencyCode)
      if (pendingRequest) {
        try {
          const rates = await pendingRequest
          if (mounted && rates[targetCurrency.coinGeckoId]) {
            setRate(rates[targetCurrency.coinGeckoId])
            setLoading(false)
          }
        } catch (err) {
          if (mounted) {
            setError(
              err instanceof Error
                ? err.message
                : 'Failed to fetch exchange rate'
            )
            setLoading(false)
          }
        }
        return
      }

      // For crypto currencies, we need to get the price in the target crypto
      // For fiat currencies, we get USD price in that fiat
      const isCrypto = targetCurrency.type === 'crypto'

      // Create the fetch promise
      const fetchPromise = (async (): Promise<ExchangeRates> => {
        // For crypto: get the crypto's USD price and invert it (how much
        // crypto is 1 USD). For fiat: how many units of fiat = 1 USD, using
        // a stablecoin (USDT) as proxy for USD.
        const data = isCrypto
          ? await getPrices([targetCurrency.coinGeckoId], 'usd', false)
          : await getPrices(['tether'], targetCurrency.coinGeckoId, false)

        let exchangeRate: number

        if (isCrypto) {
          // For crypto: data = { bitcoin: { usd: 50000 } }
          // Rate = 1 / price (how much crypto equals 1 USD)
          const cryptoPrice = data[targetCurrency.coinGeckoId]?.usd
          if (!cryptoPrice) {
            throw new Error(`No price data for ${targetCurrency.coinGeckoId}`)
          }
          exchangeRate = 1 / cryptoPrice
        } else {
          // For fiat: data = { tether: { eur: 0.92 } }
          // Rate = direct value (how many fiat units = 1 USD)
          exchangeRate = data.tether?.[targetCurrency.coinGeckoId]
          if (!exchangeRate) {
            throw new Error(
              `No exchange rate for ${targetCurrency.coinGeckoId}`
            )
          }
        }

        const rates: ExchangeRates = {
          [targetCurrency.coinGeckoId]: exchangeRate,
        }

        // Cache the response
        setCachedRates(targetCurrencyCode, rates)
        return rates
      })()

      // Register this as a pending request
      pendingRequests.set(targetCurrencyCode, fetchPromise)

      try {
        setLoading(true)
        setError(null)

        const rates = await fetchPromise

        if (mounted && rates[targetCurrency.coinGeckoId]) {
          setRate(rates[targetCurrency.coinGeckoId])
          setLoading(false)
        }
      } catch (err) {
        console.error('Exchange rate fetch error:', err)

        if (mounted) {
          const errorMessage =
            err instanceof Error ? err.message : 'Failed to fetch exchange rate'
          setError(errorMessage)
          setLoading(false)
          // Fallback to 1:1 rate on error
          setRate(1)
        }
      } finally {
        // Clean up pending request
        pendingRequests.delete(targetCurrencyCode)
      }
    }

    fetchRate()

    return () => {
      mounted = false
    }
  }, [targetCurrencyCode, targetCurrency])

  /**
   * Convert a USD value to the target currency
   */
  const convertFromUSD = useCallback(
    (usdValue: number): number => {
      return usdValue * rate
    },
    [rate]
  )

  /**
   * Convert a value from target currency back to USD
   */
  const convertToUSD = useCallback(
    (targetValue: number): number => {
      return targetValue / rate
    },
    [rate]
  )

  return {
    rate,
    loading,
    error,
    convertFromUSD,
    convertToUSD,
    targetCurrency,
  }
}
