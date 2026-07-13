import type { Assign, Chain, Prettify } from 'viem'

import { AAVE_CONFIG } from '@/lib/protocols/aave'
import { COMPOUND_CONFIG } from '@/lib/protocols/compound'
import { MORPHO_CONFIG } from '@/lib/protocols/morpho'
import type { ProtocolAdapter } from '@/lib/protocols/types'

// ============================================================================
// PROTOCOL CONFIG INTERFACE
// ============================================================================

/**
 * Extended Chain type with custom markets property
 */
export type ProtocolChain = Prettify<
  Assign<
    Chain<undefined>,
    Chain & {
      custom: {
        /** Canonical slug used in productId (e.g. 'ethereum', 'polygon'). Must match CHAIN_SLUG_MAP. */
        slug: string
        subgraphUrl?: string
        /**
         * Optional path to the chain client module for automatic registration.
         * When provided, the system will automatically import and register this chain.
         * Path should be relative to the adapter's onchain folder.
         * @example 'ethereum' or 'base'
         */
        clientPath?: string
      }
    }
  >
>

/**
 * The floors applied AT INGESTION — in the protocol's own query, so a pool below
 * them is never even fetched.
 *
 * These are the only filters allowed in a `where` clause, and they exist for one
 * purpose: not collecting literal dust. Keep them LOW.
 *
 * They are the single irreversible decision in the pipeline. A pool we do not
 * collect has no history, and can never be given one: a market sitting at $80k that
 * grows to $500k next quarter arrives with no 30-day mean, no 180-day stddev, and
 * nothing the MCP can say about whether it is stable. Raising a floor here throws
 * away a future you cannot buy back.
 *
 * Everything else — "is this market big enough to show?", "is this rate absurd?" —
 * is decided on the READ side, in `lib/display-eligibility`, from the data we
 * stored. Change a number THERE and it takes effect everywhere, instantly,
 * retroactively, with the full history intact. That is the whole reason the two
 * layers are separate.
 *
 * Whatever is set here is honoured by every job: the 10-minute collector, the
 * hourly catalogue sync, and the heal job all read the protocol's listing rule from
 * one place — its `listing.ts` — which reads it from here.
 */
export interface IngestionFloors {
  /**
   * Morpho Blue markets: minimum borrowed USD. Morpho lists thousands of
   * permissionless markets, most of which never see a single borrow.
   */
  minBorrowAssetsUsd?: number
  /** Minimum supplied/total USD. Unset = collect everything the protocol lists. */
  minTvlUsd?: number
}

export interface ProtocolConfig {
  id: string
  name: string
  offchainApiUrl?: string
  chains: Record<number, ProtocolChain>
  /** See IngestionFloors — the one irreversible filter. Absent = no floor. */
  ingestion?: IngestionFloors
}

// ============================================================================
// PROTOCOL REGISTRY - SINGLE SOURCE OF TRUTH
// ============================================================================
// This registry is the ONLY place you need to modify to enable/disable protocols.
//
// HOW TO ADD A NEW PROTOCOL:
// 1. Create adapter folder in @/lib/protocols/[protocol] with config and adapter
// 2. Import the config at the top of this file
// 3. Add entry to PROTOCOL_REGISTRY below
//
// HOW TO DISABLE A PROTOCOL:
// - Simply comment out the entry in PROTOCOL_REGISTRY
//
// The ProtocolName type and all helper functions are auto-generated from this registry.
//
// NOTE: The config now uses the centralized structure (e.g., AAVE_CONFIG.v3.chains)
// ============================================================================

export const PROTOCOL_REGISTRY = {
  aave: {
    displayName: 'Aave',
    config: AAVE_CONFIG,
    adapter: () => import('@/lib/protocols/aave').then((m) => m.AaveAdapter),
  },
  morpho: {
    displayName: 'Morpho',
    config: MORPHO_CONFIG,
    adapter: () =>
      import('@/lib/protocols/morpho').then((m) => m.MorphoAdapter),
  },
  compound: {
    displayName: 'Compound',
    config: COMPOUND_CONFIG,
    adapter: () =>
      import('@/lib/protocols/compound').then((m) => m.CompoundAdapter),
  },
} as const

// ============================================================================
// AUTO-GENERATED TYPES AND HELPERS
// ============================================================================
// Everything below is automatically derived from PROTOCOL_REGISTRY

/**
 * Extract all protocol version IDs from the registry configs.
 * This creates a union type of all version-specific protocol IDs.
 * Example: 'morpho_v1' | 'aave_v3' | 'compound_v3'
 */
export type ProtocolName = {
  [K in keyof typeof PROTOCOL_REGISTRY]: keyof (typeof PROTOCOL_REGISTRY)[K]['config']
}[keyof typeof PROTOCOL_REGISTRY]

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Get a specific protocol config by its version ID.
 *
 * @param protocolId The version-specific protocol ID (e.g., 'morpho_v1', 'aave_v3')
 * @returns The protocol config or undefined if not found
 *
 * @example
 * ```typescript
 * const config = getProtocolConfig('morpho_v1')
 * // { id: 'morpho_v1', name: 'Morpho V1', chains: {...} }
 * ```
 */
export function getProtocolConfig(
  protocolId: ProtocolName
): ProtocolConfig | undefined {
  for (const entry of Object.values(PROTOCOL_REGISTRY)) {
    const config = entry.config[protocolId]
    if (config) {
      return config
    }
  }
  return undefined
}

/**
 * Get all protocol IDs from the registry.
 * Returns an array of all version-specific protocol IDs.
 *
 * @example
 * ```typescript
 * const ids = getProtocolIds()
 * // ['aave_v3', 'morpho_v1']
 * ```
 */
export function getProtocolIds(): ProtocolName[] {
  return Object.values(PROTOCOL_REGISTRY).flatMap((entry) =>
    Object.keys(entry.config)
  ) as ProtocolName[]
}

/**
 * Get the adapter loader function for a specific protocol ID.
 *
 * @param protocolId The version-specific protocol ID (e.g., 'morpho_v1', 'aave_v3')
 * @returns The adapter loader function or undefined if not found
 *
 * @example
 * ```typescript
 * const adapterLoader = getProtocolAdapter('morpho_v1')
 * if (adapterLoader) {
 *   const adapter = await adapterLoader()
 *   const positions = await adapter.getUserBorrowPositions({ addresses })
 * }
 * ```
 */
export function getProtocolAdapter(
  protocolId: ProtocolName
): (() => Promise<ProtocolAdapter>) | undefined {
  for (const entry of Object.values(PROTOCOL_REGISTRY)) {
    if (protocolId in entry.config) {
      return entry.adapter
    }
  }
  return undefined
}

export function getProtocolGlobalNameById(id: string): string | undefined {
  const prefix = id.split('_')[0]
  return PROTOCOL_REGISTRY[prefix as keyof typeof PROTOCOL_REGISTRY].displayName
}

export function getProtocolVersionNameById(id: string): string {
  const prefix = id.split('_')[0]
  return (
    PROTOCOL_REGISTRY[prefix as keyof typeof PROTOCOL_REGISTRY].config[id]
      .name ?? 'n/a'
  )
}
