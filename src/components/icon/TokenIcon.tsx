'use client'

import { useEffect, useState } from 'react'

import Image from 'next/image'

import { useTokenIcon } from '@/hooks/useTokenIcon'

type TokenIconProps = {
  symbol?: string
  size?: number
  className?: string
}

// Native asset icons — stored in /public/icons/native/
// These are high-priority tokens that should load instantly
// IMPORTANT: Only add icons here if the SVG file actually exists in /public/icons/native/
// Otherwise, the component will try to load a non-existent file and show fallback instead of fetching from CoinGecko
const NATIVE_ICONS: Record<string, string> = {
  // Add your native icons here after placing SVG files in /public/icons/native/
  // Example:
  eth: '/icons/native/eth.svg',
  btc: '/icons/native/btc.svg',
  xlm: '/icons/native/xlm.svg',
}

export const TokenIcon = ({
  symbol = '',
  size = 20,
  className = '',
}: TokenIconProps) => {
  const iconUrl = useTokenIcon(symbol)
  const [src, setSrc] = useState<string | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    const lower = symbol.toLowerCase()

    // Priority 1: Local native icons (instant load)
    if (NATIVE_ICONS[lower]) {
      setSrc(NATIVE_ICONS[lower])
      setError(false)
      return
    }

    // Priority 2: Check localStorage cache
    const key = `token-icon-${lower}`
    const cached = localStorage.getItem(key)
    if (cached) {
      setSrc(cached)
      setError(false)
      return
    }

    // Priority 3: Fetched from CoinGecko via SWR
    if (iconUrl) {
      setSrc(iconUrl)
      setError(false)
    }
  }, [symbol, iconUrl])

  const handleError = () => {
    setError(true)
    setSrc(null)
  }

  // Loading state
  if (!src && !error) {
    return (
      <div
        className={`bg-muted animate-pulse rounded-full ${className}`}
        style={{ width: size, height: size }}
        title={symbol}
      />
    )
  }

  // Error state - show fallback with symbol initials
  if (error || !src) {
    return (
      <div
        className={`bg-muted border-border flex items-center justify-center rounded-full border ${className}`}
        style={{ width: size, height: size }}
        title={symbol}
      >
        <span
          className="text-foreground font-bold"
          style={{ fontSize: size * 0.55 }}
        >
          {symbol.charAt(0).toUpperCase()}
        </span>
      </div>
    )
  }

  // Success state - show image
  return (
    <Image
      src={src}
      alt={symbol}
      width={size}
      height={size}
      onError={handleError}
      className={`rounded-full ${className}`}
      unoptimized={src.startsWith('http')} // Don't optimize external images
    />
  )
}
