import { arbitrum } from 'viem/chains'

import { COMPOUND_V3_CHAINS } from '../config'
import { createChainClient, registerChain } from '../positions'

const config = COMPOUND_V3_CHAINS[arbitrum.id]

/**
 * Arbitrum One client for Compound V3.
 * Automatically registers itself with the onchain adapter.
 */
const arbitrumClient = createChainClient(
  config.custom.subgraphUrl!,
  process.env.THEGRAPH_API_KEY
)

// Register this chain with the adapter
registerChain({
  client: arbitrumClient,
  chainId: config.id,
  chainName: config.name,
  // Uses default queries from ../queries.ts
})
