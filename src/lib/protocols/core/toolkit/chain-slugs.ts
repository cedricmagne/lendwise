import {
  arbitrum,
  avalanche,
  base,
  bsc,
  linea,
  mainnet,
  optimism,
  polygon,
} from 'viem/chains'

const PROTOCOL_CHAINS = [
  { chain: mainnet, slug: 'ethereum' },
  { chain: polygon, slug: 'polygon' },
  { chain: arbitrum, slug: 'arbitrum' },
  { chain: base, slug: 'base' },
  { chain: optimism, slug: 'optimism' },
  { chain: linea, slug: 'linea' },
  { chain: avalanche, slug: 'avalanche' },
  { chain: bsc, slug: 'bsc' },
] as const

export type RegisteredChainId = (typeof PROTOCOL_CHAINS)[number]['chain']['id']

export const CHAIN_SLUG_MAP = Object.fromEntries(
  PROTOCOL_CHAINS.map(({ chain, slug }) => [chain.id, slug])
) as Record<RegisteredChainId, string>
