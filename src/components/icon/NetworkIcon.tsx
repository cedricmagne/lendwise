'use client'

import { useState } from 'react'

import Image from 'next/image'

type NetworkIconProps = {
  networkSlug: string
  size?: number
  className?: string
}

/**
 * NetworkIcon component
 * Displays network logos from /public/icons/network/
 *
 * Usage:
 * <NetworkIcon networkSlug="ethereum" size={32} />
 * <NetworkIcon networkSlug="polygon" size={24} />
 */
export const NetworkIcon = ({
  networkSlug,
  size = 18,
  className = '',
}: NetworkIconProps) => {
  const [error, setError] = useState(false)

  // Normalize protocol name to lowercase for file matching
  const normalizedNetworkSlug = networkSlug.toLowerCase().replaceAll(' ', '-')
  const iconPath = `/icons/network/${normalizedNetworkSlug}.svg`

  const handleError = () => {
    setError(true)
  }

  // Error state - show fallback with protocol initials
  if (error) {
    return (
      <div
        className={`bg-muted flex items-center justify-center rounded-full ${className}`}
        style={{ width: size, height: size }}
        title={networkSlug}
      >
        <span
          className="text-muted-foreground font-bold uppercase"
          style={{ fontSize: size * 0.35 }}
        >
          {networkSlug.slice(0, 2)}
        </span>
      </div>
    )
  }

  // Success state - show chain logo
  return (
    <div
      className={`relative overflow-hidden ${className}`}
      style={{ width: size, height: size }}
      title={networkSlug}
    >
      <Image
        src={iconPath}
        alt={`${networkSlug} logo`}
        fill
        onError={handleError}
        className="object-cover"
      />
    </div>
  )
}
