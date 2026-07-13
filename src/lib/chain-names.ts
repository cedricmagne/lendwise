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

/**
 * Canonical chainId → display-name lookup for server code.
 *
 * Deliberately NOT sourced from `@/config/chains` (ALL_CHAINS): that module
 * imports wagmi and throws at import time when NEXT_PUBLIC_INFURA_API_KEY is
 * unset, which is wrong to drag into a DB resolver. viem chain objects carry the
 * same canonical id/name without the client-side coupling.
 *
 * `products.chain_name` cannot be used for this: it is inconsistent across
 * adapters for the same chain (Aave writes "Ethereum", Morpho/Compound write
 * "ethereum" / "op mainnet"). Only chain_id is canonical.
 */
const CHAIN_NAMES: Record<number, string> = Object.fromEntries(
  [mainnet, optimism, polygon, base, arbitrum, avalanche, linea, bsc].map(
    (c) => [c.id, c.name]
  )
)

/** Display name for a chainId, falling back to the adapter-written name. */
export function chainName(chainId: number, fallback: string): string {
  return CHAIN_NAMES[chainId] ?? fallback
}
