import { arbitrum, base, mainnet, optimism, polygon } from 'viem/chains'

import type { AdapterChain } from '@/lib/protocols/core/types'

// Relative (not '@/…') so codegen.ts can load this module through jiti, which
// does not resolve the '@/' path alias for value imports. Matches the pattern in
// the sibling aave/morpho configs that codegen also imports.
import { CHAIN_SLUG_MAP } from '../../core/toolkit/chain-slugs'

/**
 * Compound V3 chain map — merges the old `compound/config.ts` + the flattened
 * `onchain/config.ts` into a single source of truth for the adapter.
 *
 * Each entry surfaces a top-level `slug` for the YieldAdapter contract while
 * retaining the fields the internal chain-override registry and per-chain client
 * modules read verbatim: `id`, `name`, and `custom.{slug,subgraphUrl,clientPath}`.
 * Values are replicated exactly from the legacy configs.
 */
type CompoundV3Chain = AdapterChain & {
  id: number
  name: string
  custom: {
    slug: string
    subgraphUrl: string
    clientPath: string
  }
}

export const COMPOUND_V3_CHAINS: Record<number, CompoundV3Chain> = {
  [mainnet.id]: {
    slug: CHAIN_SLUG_MAP[mainnet.id],
    id: mainnet.id,
    name: mainnet.name,
    custom: {
      slug: CHAIN_SLUG_MAP[mainnet.id],
      subgraphUrl:
        'https://gateway.thegraph.com/api/subgraphs/id/5nwMCSHaTqG3Kd2gHznbTXEnZ9QNWsssQfbHhDqQSQFp',
      // 'https://gateway.thegraph.com/api/subgraphs/id/AwoxEZbiWLvv6e3QdvdMZw4WDURdGbvPfHmZRc8Dpfz9', # MESSARI SUBGRAPH
      clientPath: 'ethereum',
    },
  },
  [polygon.id]: {
    slug: CHAIN_SLUG_MAP[polygon.id],
    id: polygon.id,
    name: polygon.name,
    custom: {
      slug: CHAIN_SLUG_MAP[polygon.id],
      subgraphUrl:
        'https://gateway.thegraph.com/api/subgraphs/id/AaFtUWKfFdj2x8nnE3RxTSJkHwGHvawH3VWFBykCGzLs',
      // 'https://gateway.thegraph.com/api/subgraphs/id/5wfoWBpfYv59b99wDxJmyFiKBu9brXESeqJAzw8WP5Cz', # MESSARI SUBGRAPH
      clientPath: 'polygon',
    },
  },
  [arbitrum.id]: {
    slug: CHAIN_SLUG_MAP[arbitrum.id],
    id: arbitrum.id,
    name: arbitrum.name,
    custom: {
      slug: CHAIN_SLUG_MAP[arbitrum.id],
      subgraphUrl:
        'https://gateway.thegraph.com/api/subgraphs/id/Ff7ha9ELmpmg81D6nYxy4t8aGP26dPztqD1LDJNPqjLS',
      // 'https://gateway.thegraph.com/api/subgraphs/id/5MjRndNWGhqvNX7chUYLQDnvEgc8DaH8eisEkcJt71SR', # MESSARI SUBGRAPH
      clientPath: 'arbitrum',
    },
  },
  [base.id]: {
    slug: CHAIN_SLUG_MAP[base.id],
    id: base.id,
    name: base.name,
    custom: {
      slug: CHAIN_SLUG_MAP[base.id],
      subgraphUrl:
        'https://gateway.thegraph.com/api/subgraphs/id/2hcXhs36pTBDVUmk5K2Zkr6N4UYGwaHuco2a6jyTsijo',
      // 'https://gateway.thegraph.com/api/subgraphs/id/99XPkR9F1exRDdCNyfXrCfEon4K34YoTDn6dgXKmxC72', # MESSARI SUBGRAPH
      clientPath: 'base',
    },
  },
  [optimism.id]: {
    slug: CHAIN_SLUG_MAP[optimism.id],
    id: optimism.id,
    name: optimism.name,
    custom: {
      slug: CHAIN_SLUG_MAP[optimism.id],
      subgraphUrl:
        'https://gateway.thegraph.com/api/subgraphs/id/FhHNkfh5z6Z2WCEBxB6V3s8RPxnJfWZ9zAfM5bVvbvbb',
      clientPath: 'optimism',
    },
  },
}

/**
 * Type for supported Compound V3 chain IDs.
 */
export type CompoundV3ChainId = keyof typeof COMPOUND_V3_CHAINS
