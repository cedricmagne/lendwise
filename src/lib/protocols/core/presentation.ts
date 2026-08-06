/**
 * How a catalogue row becomes what a table shows — owned by each protocol.
 *
 * A row of `products` describes a market in the pipeline's vocabulary; a table
 * needs a label, a network, an identity and a link. Turning one into the other
 * is protocol-specific — Aave presents Lido as its own "network", Morpho names
 * a vault after itself and a market after its loan/collateral pair, Blend names
 * the pool — and that knowledge belongs next to the adapter that produced the
 * row, not in a `switch` at the render site.
 *
 * Every hook is optional: an adapter declares only what differs from the
 * defaults below, and a protocol with nothing to say registers no fragment at
 * all. `src/lib/products/from-catalogue.ts` resolves hook-or-default and never
 * names a provider.
 *
 * The registry that collects the fragments is `@/config/protocols-presentation`.
 */
import type { Address } from 'viem'

import type { ProductRow } from '@/lib/db/schema'

import { chainSlugFor } from './toolkit/chain-slugs'

/** `poolId` + `poolAddress` — what identifies the market to the UI. */
export interface PoolIdentity {
  poolId: string
  poolAddress: Address
}

/** One protocol's overrides. Absent hook = the matching default below. */
export interface ProtocolPresentation {
  poolName?(p: ProductRow): string
  networkSlug?(p: ProductRow): string
  poolIdentity?(p: ProductRow): PoolIdentity
  productLink?(p: ProductRow): string
}

/**
 * The displayed name: the asset's own. Works wherever one asset means one
 * market per chain — Aave and Compound. A protocol that lists the same asset in
 * several markets on one chain (Blend, Morpho) must override, or its rows read
 * identically.
 */
export function defaultPoolName(p: ProductRow): string {
  return p.assetName
}

/**
 * The canonical chain slug, by chainId — never a display name.
 *
 * Throws on an unregistered chain, deliberately: `network` is a required field
 * of the table, and a chainId missing from `chain-slugs.ts` is a configuration
 * bug to fix, not a case to mask. A DECORATIVE use of the same lookup (a link)
 * must call `chainSlugFor()` and degrade instead — see the adapters.
 */
export function defaultNetworkSlug(p: ProductRow): string {
  const slug = chainSlugFor(p.chainId)
  if (!slug)
    throw new Error(
      `No slug registered for chainId ${p.chainId} — add it to chain-slugs.ts`
    )
  return slug
}

/** Identity = the protocol address, twice. True everywhere but a Morpho market. */
export function defaultPoolIdentity(p: ProductRow): PoolIdentity {
  return {
    poolId: p.protocolAddress,
    poolAddress: p.protocolAddress as Address,
  }
}

/** No link. A protocol with no app URL template renders no link at all. */
export function defaultProductLink(): string {
  return ''
}
