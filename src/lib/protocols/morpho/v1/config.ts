import type { AdapterChain, IngestionFloors } from '@/lib/protocols/core/types'

// Relative (not '@/…') so codegen.ts can load this module through jiti, which
// does not resolve the '@/' path alias for value imports. Matches the pattern in
// the sibling aave/compound configs that codegen also imports.
import { adapterChains } from '../../core/toolkit/chain-slugs'

export const MORPHO_V1_API_URL = 'https://api.morpho.org/graphql'

/**
 * Coverage — every Morpho API chain with at least one listed vault or market
 * above the ingestion floor (July 2026; World Chain and Arc had zero, add them
 * the day they do). Identity lives in the registry; an unknown slug here is a
 * compile error. Transactability is decided independently in src/config/chains.ts.
 */
export const MORPHO_V1_CHAINS: Record<number, AdapterChain> = adapterChains([
  'ethereum',
  'base',
  'arbitrum',
  'polygon',
  'optimism',
  'katana',
  'hyperevm',
  'unichain',
  'monad',
  'stable',
  'tempo',
  'robinhood',
])

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
