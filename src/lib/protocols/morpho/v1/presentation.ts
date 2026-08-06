/**
 * Morpho's presentation overrides — see `core/presentation.ts` for the contract.
 *
 * Registered into `@/config/protocols-presentation`.
 */
import type { Address } from 'viem'

import type { ProtocolName } from '@/config/protocols-meta'
import type { ProductRow } from '@/lib/db/schema'
import {
  type PoolIdentity,
  type ProtocolPresentation,
  defaultPoolIdentity,
} from '@/lib/protocols/core/presentation'
import { chainSlugFor } from '@/lib/protocols/core/toolkit/chain-slugs'
import { generateSlug } from '@/lib/utils'

/**
 * A vault carries its own name (written into `meta` at sync time); a market is
 * named after its loan/collateral pair, since several markets share one loan
 * asset on one chain.
 */
function morphoPoolName(p: ProductRow): string {
  if (p.kind === 'supply') {
    return (p.meta as { name?: string }).name ?? p.assetName
  }
  const collateral = (p.collaterals as { symbol: string }[] | null)?.[0]?.symbol
  return collateral ? `${p.assetSymbol}/${collateral}` : p.assetSymbol
}

export const MORPHO_V1_PRESENTATION = {
  morpho_v1: {
    poolName: morphoPoolName,

    /**
     * A Morpho market is identified by its marketId, while its address is that
     * of the loaned asset. A vault is ordinary — the shared default applies.
     */
    poolIdentity: (p: ProductRow): PoolIdentity =>
      p.kind === 'borrow'
        ? {
            poolId: (p.meta as { id: string }).id,
            poolAddress: p.assetAddress as Address,
          }
        : defaultPoolIdentity(p),

    /**
     * `chainSlugFor()` rather than the throwing default, same reason as Aave: a
     * broken link must never fail the whole `/supply` load. And the slug rather
     * than `p.chainName`, which holds display names with spaces (`chain_id` 10
     * → "op mainnet", 42161 → "arbitrum one") that break the URL — 5 Morpho
     * products rendered a broken link before this was fixed.
     */
    productLink: (p: ProductRow) => {
      const slug = chainSlugFor(p.chainId)
      if (!slug) return ''
      return p.kind === 'supply'
        ? `https://app.morpho.org/${slug}/vault/${p.protocolAddress}/${generateSlug(morphoPoolName(p))}`
        : `https://app.morpho.org/${slug}/market/${(p.meta as { id: string }).id}`
    },
  },
} satisfies Partial<Record<ProtocolName, ProtocolPresentation>>
