import type { AdapterChain } from '@/lib/protocols/core/types'

// Relative (not '@/…') so codegen.ts can load this module through jiti, which
// does not resolve the '@/' path alias for value imports. Matches the pattern in
// the sibling morpho/compound configs that codegen also imports.
import { adapterChains } from '../../core/toolkit/chain-slugs'

export const AAVE_V3_API_URL = 'https://api.v3.aave.com/graphql'

/**
 * Official Aave V3 subgraphs on The Graph's decentralized gateway, keyed by
 * PRODUCT NETWORK SLUG (see buildProductNetworkSlug), not by chainId: one
 * subgraph indexes exactly one Pool, and Ethereum hosts several pools that are
 * distinct networks in our catalogue (ethereum / ethereum-lido /
 * ethereum-etherfi / ethereum-horizon), all chainId 1.
 *
 * The unified Aave API (AAVE_V3_API_URL) exposes only supplyAPYHistory /
 * borrowAPYHistory — rates, no TVL and no utilization timeseries. The subgraph's
 * `reserveParamsHistoryItem` entity carries the market state per event, which is
 * the only source for historical supply/borrow amounts and utilization.
 *
 * Requires THEGRAPH_API_KEY (Bearer). Source of the ids:
 * https://github.com/aave/protocol-subgraphs (README, checked 2026-07-23).
 * ethereum-horizon has NO published subgraph (Aave Labs RWA market) — its
 * history stays rates-only until one exists.
 */
export const AAVE_V3_SUBGRAPH_URLS: Record<string, string> = {
  ethereum:
    'https://gateway.thegraph.com/api/subgraphs/id/Cd2gEDVeqnjBn1hSeqFMitw8Q1iiyV9FYUZkLNRcL87g',
  'ethereum-lido':
    'https://gateway.thegraph.com/api/subgraphs/id/5vxMbXRhG1oQr55MWC5j6qg78waWujx1wjeuEWDA6j3',
  'ethereum-etherfi':
    'https://gateway.thegraph.com/api/subgraphs/id/8o4HGApJkAqnvxAHShG4w5xiXihHyL7HkeDdQdRUYmqZ',
}

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
