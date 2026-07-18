import type { AdapterChain } from '@/lib/protocols/core/types'

// Relative (not '@/…') so codegen.ts can load this module through jiti, which
// does not resolve the '@/' path alias for value imports. Matches the pattern in
// the sibling morpho/compound configs that codegen also imports.
import { adapterChains } from '../../core/toolkit/chain-slugs'

export const AAVE_V3_API_URL = 'https://api.v3.aave.com/graphql'

/**
 * Coverage — every mainnet the Aave V3 unified API serves (chains query,
 * July 2026). Identity (slug/chainId) lives in the registry; an unknown slug
 * here is a compile error. Adding a chain = one slug here + one registry row.
 *
 * All chains are ingested for data (view-only); whether a chain is also
 * transactable is decided independently in src/config/chains.ts (TX_CHAINS).
 */
export const AAVE_V3_CHAINS: Record<number, AdapterChain> = adapterChains([
  'ethereum',
  'polygon',
  'arbitrum',
  'base',
  'optimism',
  'linea',
  'avalanche',
  'bsc',
  'celo',
  'gnosis',
  'metis',
  'scroll',
  'soneium',
  'sonic',
  'zksync',
  'plasma',
  'ink',
  'mantle',
  'megaeth',
  'xlayer',
  'monad',
])
