/**
 * GraphQL Code Generator Configuration
 *
 * This file generates TypeScript types from GraphQL schemas for all protocol adapters.
 *
 * IMPORTANT: All schema URLs are imported from protocol config files to maintain
 * a single source of truth. Never hardcode URLs here - update the config files instead:
 * - AAVE: src/lib/protocols/aave/v3/config.ts (AAVE_V3_API_URL)
 * - Morpho: src/lib/protocols/morpho/v1/config.ts (MORPHO_V1_API_URL)
 * - Compound: src/lib/protocols/compound/v3/config.ts (COMPOUND_V3_CHAINS[chainId].custom.subgraphUrl)
 */
import type { CodegenConfig } from '@graphql-codegen/cli'
import { config as loadEnv } from 'dotenv'
import { mainnet, optimism } from 'viem/chains'

import { COMPOUND_V3_CHAINS } from './src/lib/protocols/compound/v3/config'

// Load environment variables from .env file
loadEnv({ path: ['.env', '.env.local'] })

// Extract API URLs from configs (single source of truth)
const compoundV3EthereumSubgraphUrl =
  COMPOUND_V3_CHAINS[mainnet.id]?.custom?.subgraphUrl

const compoundV3OptimismSubgraphUrl =
  COMPOUND_V3_CHAINS[optimism.id]?.custom?.subgraphUrl

if (!compoundV3EthereumSubgraphUrl || !compoundV3OptimismSubgraphUrl) {
  throw new Error(
    'Compound V3 subgraph URL not found in config. Please update src/lib/protocols/compound/config.ts'
  )
}

const config: CodegenConfig = {
  overwrite: true,
  config: {
    // Ensure generated files have proper type annotations
    useTypeImports: true,
  },
  generates: {
    // AAVE V3 - Offchain (GraphQL API)
    // Schema URL is imported from src/lib/protocols/aave/v3/config.ts
    'src/lib/protocols/aave/v3/generated/': {
      schema: 'src/lib/protocols/aave/v3/schema.json',
      documents: 'src/lib/protocols/aave/v3/queries.ts',
      preset: 'client',
      presetConfig: {
        fragmentMasking: false,
      },
    },
    // COMPOUND V3 - Onchain (Subgraph)
    // Schema URL is imported from src/lib/protocols/compound/v3/config.ts
    'src/lib/protocols/compound/v3/generated/': {
      schema: [
        {
          [compoundV3EthereumSubgraphUrl]: {
            headers: process.env.THEGRAPH_API_KEY
              ? {
                  Authorization: `Bearer ${process.env.THEGRAPH_API_KEY}`,
                }
              : {},
          },
        },
      ],
      documents: 'src/lib/protocols/compound/v3/queries.ts',
      preset: 'client',
      presetConfig: {
        fragmentMasking: false,
      },
    },
    // MORPHO V1 - Offchain (GraphQL API)
    // Schema URL is imported from src/lib/protocols/morpho/v1/config.ts
    'src/lib/protocols/morpho/v1/generated/': {
      schema: 'src/lib/protocols/morpho/v1/schema.json',
      documents: 'src/lib/protocols/morpho/v1/queries.ts',
      preset: 'client',
      presetConfig: {
        fragmentMasking: false,
      },
      config: {
        namingConvention: {
          enumValues: 'keep',
        },
      },
    },
  },
}

export default config
