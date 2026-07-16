import { arbitrum, base, mainnet, optimism, polygon } from 'viem/chains'

import type { Kind } from '@/lib/db/types'
import {
  CHAIN_SLUG_MAP,
  type RegisteredChainId,
} from '@/lib/protocols/core/toolkit'

// ─── Pool ID builder ──────────────────────────────────────────────────────────
export function buildProductId(
  marketId: string,
  chain: { id: number; name: string },
  kind: Kind
): string {
  // market prefix prevents collision — same token can exist on multiple Compound markets
  // on the same chain (e.g. different versions or deployments)
  const network = CHAIN_SLUG_MAP[chain.id as RegisteredChainId]
  if (!network)
    throw new Error(
      `No slug registered for chainId ${chain.id} — add it to chain-slugs.ts`
    )
  return `compoundcomet:v3:${network}:market:${marketId}:${kind}`
}

// ============================================================================
// Chain Name Mapping
// ============================================================================

/**
 * Maps Compound subgraph Network enum values to human-readable chain names.
 * Add entries as new chains are supported.
 */
export const SLUG_MAPPING: Record<number, string> = {
  [mainnet.id]: 'mainnet',
  [arbitrum.id]: 'arb',
  [polygon.id]: 'polygon',
  [base.id]: 'base',
  [optimism.id]: 'op',
}

export const BASE_INDEX_SCALE = 1e15 // Compound V3 constant
