import { mainnet } from 'viem/chains'

import { COMPOUND_V3_CHAINS } from '../config'
import { createChainClient, registerChain } from '../positions'

const config = COMPOUND_V3_CHAINS[mainnet.id]

/**
 * Ethereum mainnet client for Compound V3.
 * Automatically registers itself with the onchain adapter.
 */
const ethereumClient = createChainClient(
  config.custom.subgraphUrl!,
  process.env.THEGRAPH_API_KEY
)

// Register this chain with the adapter
registerChain({
  client: ethereumClient,
  chainId: config.id,
  chainName: config.name,
})
