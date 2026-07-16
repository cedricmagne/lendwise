import { base } from 'viem/chains'

import { COMPOUND_V3_CHAINS } from '../config'
import { createChainClient, registerChain } from '../positions'

const config = COMPOUND_V3_CHAINS[base.id]

/**
 * Base chain client for Compound V3.
 * Automatically registers itself with the onchain adapter.
 * Uses custom queries due to different subgraph schema.
 */
const baseClient = createChainClient(
  config.custom.subgraphUrl!,
  process.env.THEGRAPH_API_KEY
)

// Register this chain with the adapter (with custom queries)
registerChain({
  client: baseClient,
  chainId: config.id,
  chainName: config.name,
})
