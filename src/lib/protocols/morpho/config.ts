import { arbitrum, base, mainnet, optimism, polygon } from 'viem/chains'

import type { ProtocolConfig } from '@/config/protocols'

import { CHAIN_SLUG_MAP } from '../chain-slugs'

/**
 * Centralized configuration for all Morpho versions and chains.
 */
export const MORPHO_CONFIG: Record<string, ProtocolConfig> = {
  morpho_v1: {
    id: 'morpho_v1',
    name: 'Morpho v1',
    offchainApiUrl: 'https://api.morpho.org/graphql',
    ingestion: {
      // Morpho Blue is permissionless: anyone can deploy a market, and most are
      // never borrowed from at all. This floor keeps them out of the pipeline.
      // Vaults have no floor — a MetaMorpho vault's TVL is legitimately near zero
      // while it is being seeded, and its APY is meaningful long before it is big.
      minBorrowAssetsUsd: 10_000,
    },
    chains: {
      [mainnet.id]: {
        ...mainnet,
        custom: {
          slug: CHAIN_SLUG_MAP[mainnet.id],
          subgraphUrl:
            'https://gateway.thegraph.com/api/subgraphs/id/8Lz789DP5VKLXumTMTgygjU2xtuzx8AhbaacgN5PYCAs',
          clientPath: 'ethereum',
        },
      },
      [base.id]: {
        ...base,
        custom: {
          slug: CHAIN_SLUG_MAP[base.id],
          subgraphUrl:
            'https://gateway.thegraph.com/api/subgraphs/id/71ZTy1veF9twER9CLMnPWeLQ7GZcwKsjmygejrgKirqs',
          clientPath: 'base',
        },
      },
      [arbitrum.id]: {
        ...arbitrum,
        custom: {
          slug: CHAIN_SLUG_MAP[arbitrum.id],
          subgraphUrl:
            'https://gateway.thegraph.com/api/subgraphs/id/XsJn88DNCHJ1kgTqYeTgHMQSK4LuG1LR75339QVeQ26',
          clientPath: 'arbitrum',
        },
      },
      [polygon.id]: {
        ...polygon,
        custom: {
          slug: CHAIN_SLUG_MAP[polygon.id],
          subgraphUrl:
            'https://gateway.thegraph.com/api/subgraphs/id/EhFokmwryNs7qbvostceRqVdjc3petuD13mmdUiMBw8Y',
          clientPath: 'polygon',
        },
      },
      [optimism.id]: {
        ...optimism,
        custom: {
          slug: CHAIN_SLUG_MAP[optimism.id],
          subgraphUrl:
            'https://gateway.thegraph.com/api/subgraphs/id/5y8d3K3vVCR7r5YwANGCjupLc3hUge54XvhYMEq3Jmq1',
          clientPath: 'optimism',
        },
      },
      // [katana.id]: {
      //   ...katana,
      //   custom: {
      //     // subgraphUrl:
      //     //   'https://gateway.thegraph.com/api/subgraphs/id/5y8d3K3vVCR7r5YwANGCjupLc3hUge54XvhYMEq3Jmq1',
      //     // clientPath: 'katana',
      //   },
      // },
      // [unichain.id]: {
      //   ...unichain,
      //   custom: {
      //     subgraphUrl:
      //       'https://gateway.thegraph.com/api/subgraphs/id/ESbNRVHte3nwhcHveux9cK4FFAZK3TTLc5mKQNtpYgmu',
      //     clientPath: 'unichain',
      //   },
      // },
    },
  },
}
