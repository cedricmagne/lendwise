'use client'

import { useState } from 'react'

import Image from 'next/image'

import { Coins } from 'lucide-react'

import { getStaticTokenIcon } from '@/lib/token-icons'

type CurrencyIconProps = {
  symbol?: string
  size?: number
  className?: string
}

export const CurrencyIcon = ({
  symbol = '',
  size = 20,
  className = '',
}: CurrencyIconProps) => {
  const [error, setError] = useState(false)

  if (!symbol) {
    return (
      <div
        className={`bg-muted flex items-center justify-center rounded-full ${className}`}
        style={{ width: size, height: size }}
      >
        <Coins
          className="text-muted-foreground"
          style={{ width: size * 0.6, height: size * 0.6 }}
        />
      </div>
    )
  }

  // Crypto codes (BTC, ETH, ...) live under /icons/tokens/, fiat under
  // /icons/fiat/ — check the token table first since it's the smaller set.
  const iconPath =
    getStaticTokenIcon(symbol) ?? `/icons/fiat/${symbol.toLowerCase()}.svg`

  // Error state - show fallback with symbol initials
  if (error) {
    return (
      <div
        className={`bg-muted flex items-center justify-center rounded-full ${className}`}
        style={{ width: size, height: size }}
        title={symbol}
      >
        <span
          className="text-muted-foreground font-bold"
          style={{ fontSize: size * 0.4 }}
        >
          {symbol.slice(0, 2).toUpperCase()}
        </span>
      </div>
    )
  }

  // Success state - show image
  return (
    <Image
      src={iconPath}
      alt={symbol}
      width={size}
      height={size}
      onError={() => setError(true)}
      className={`rounded-full ${className}`}
      unoptimized
    />
  )
}
