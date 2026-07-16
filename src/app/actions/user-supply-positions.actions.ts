'use server'

import { cache } from 'react'

import { Address } from 'viem'

import { type ProtocolName } from '@/config/protocols-meta'
import { APP_ADAPTERS } from '@/config/protocols-server'
import type { AppAdapter } from '@/lib/protocols/core/types'
import { SupplyPosition } from '@/types'

// Generate return type dynamically from supported protocols
type ProtocolPositions = Record<ProtocolName, SupplyPosition[]>

export const loadUserSupplyPositions = cache(
  async function loadUserSupplyPositions(
    addresses: Address[]
  ): Promise<ProtocolPositions> {
    // All registered app adapters
    const entries = Object.entries(APP_ADAPTERS) as [
      ProtocolName,
      () => Promise<AppAdapter>,
    ][]

    // Create empty positions object for all supported protocols
    const emptyPositions = entries.reduce((acc, [protocolId]) => {
      acc[protocolId] = []
      return acc
    }, {} as ProtocolPositions)

    // Return empty positions if no addresses provided
    if (!addresses || addresses.length === 0) {
      return emptyPositions
    }

    try {
      // Dynamically load all app adapters and fetch positions
      const results = await Promise.allSettled(
        entries.map(async ([, load]) =>
          (await load()).getUserSupplyPositions({ addresses })
        )
      )

      // Build the result object from all protocol results
      const positions: ProtocolPositions = { ...emptyPositions }

      results.forEach((result, index) => {
        const protocolId = entries[index][0]

        if (result.status === 'fulfilled') {
          positions[protocolId] = result.value
        } else {
          console.error(`${protocolId} adapter failed:`, result.reason)
          positions[protocolId] = []
        }
      })

      return positions
    } catch (err) {
      console.error('Unexpected error in loadUserPositions:', err)
      return emptyPositions
    }
  }
)
