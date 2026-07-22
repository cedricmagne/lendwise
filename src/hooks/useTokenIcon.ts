'use client'

import useSWR from 'swr'

import { getTokenIcon } from '@/app/actions/token-icon.actions'

/**
 * Fetcher function for SWR
 * Checks localStorage first, then resolves via the server action
 */
async function fetchCoinIcon(symbol: string): Promise<string | null> {
  const key = `token-icon-${symbol.toLowerCase()}`

  // Check localStorage cache
  const cached = localStorage.getItem(key)
  if (cached) return cached

  try {
    const url = await getTokenIcon(symbol)

    // Store in localStorage
    if (url) {
      localStorage.setItem(key, url)
    }

    return url
  } catch (error) {
    console.error('Error fetching token icon:', error)
    return null
  }
}

/**
 * Hook to fetch and cache token icon URLs
 * Uses SWR for data fetching and localStorage for persistence
 */
export function useTokenIcon(symbol?: string) {
  const { data: icon } = useSWR(
    symbol ? ['tokenIcon', symbol.toLowerCase()] : null,
    async ([, sym]) => fetchCoinIcon(sym),
    {
      revalidateOnFocus: false,
      dedupingInterval: 1000 * 60 * 60, // 1 hour
      revalidateOnMount: true,
    }
  )

  return icon
}
