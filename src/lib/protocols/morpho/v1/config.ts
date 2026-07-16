import { arbitrum, base, mainnet, optimism, polygon } from 'viem/chains'

import type { AdapterChain, IngestionFloors } from '@/lib/protocols/core/types'

// Relative (not '@/…') so codegen.ts can load this module through jiti, which
// does not resolve the '@/' path alias for value imports. Matches the pattern in
// the sibling aave/compound configs that codegen also imports.
import { CHAIN_SLUG_MAP } from '../../core/toolkit/chain-slugs'

export const MORPHO_V1_API_URL = 'https://api.morpho.org/graphql'

/** Lightweight chain map — no more viem Chain spread. subgraphUrl extras died with onchain/. */
export const MORPHO_V1_CHAINS: Record<number, AdapterChain> =
  Object.fromEntries(
    [mainnet, base, arbitrum, polygon, optimism].map((c) => [
      c.id,
      { slug: CHAIN_SLUG_MAP[c.id] },
    ])
  )

/**
 * Moved verbatim from morpho/config.ts — the one irreversible filter. Keep LOW.
 *
 * Morpho Blue is permissionless: anyone can deploy a market, and most are never
 * borrowed from at all. This floor keeps them out of the pipeline. Vaults have no
 * floor — a MetaMorpho vault's TVL is legitimately near zero while it is being
 * seeded, and its APY is meaningful long before it is big.
 */
export const MORPHO_V1_INGESTION: IngestionFloors = {
  minBorrowAssetsUsd: 10_000,
}
