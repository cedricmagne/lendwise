import { polygon } from 'viem/chains'

import { COMPOUND_V3_CHAINS } from '../config'
import { createChainClient, registerChain } from '../positions'

const config = COMPOUND_V3_CHAINS[polygon.id]

/**
 * Polygon chain client for Compound V3.
 * Automatically registers itself with the onchain adapter.
 */
const polygonClient = createChainClient(
  config.custom.subgraphUrl!,
  process.env.THEGRAPH_API_KEY
)

// Register this chain with the adapter
registerChain({
  client: polygonClient,
  chainId: config.id,
  chainName: config.name,
})
