import {
  arbitrum,
  avalanche,
  base,
  bsc,
  linea,
  mainnet,
  optimism,
  polygon,
} from 'viem/chains'

import type { AdapterChain } from '@/lib/protocols/core/types'

// Relative (not '@/…') so codegen.ts can load this module through jiti, which
// does not resolve the '@/' path alias for value imports. Matches the pattern in
// the sibling morpho/compound configs that codegen also imports.
import { CHAIN_SLUG_MAP } from '../../core/toolkit/chain-slugs'

export const AAVE_V3_API_URL = 'https://api.v3.aave.com/graphql'

/** Lightweight chain map — no more viem Chain spread. subgraphUrl extras died with onchain/. */
export const AAVE_V3_CHAINS: Record<number, AdapterChain> = Object.fromEntries(
  [mainnet, polygon, arbitrum, base, optimism, linea, avalanche, bsc].map(
    (c) => [c.id, { slug: CHAIN_SLUG_MAP[c.id] }]
  )
)
