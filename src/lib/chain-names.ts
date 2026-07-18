import { CHAIN_BY_ID } from '@/lib/protocols/core/toolkit'

/**
 * Canonical chainId → display-name lookup for server code.
 *
 * Sourced from the chain registry (core/toolkit/chain-slugs.ts), which is pure
 * data — deliberately NOT from `@/config/chains`: that module throws at import
 * time when NEXT_PUBLIC_INFURA_API_KEY is unset, which is wrong to drag into a
 * DB resolver.
 *
 * `products.chain_name` cannot be used for this: it is inconsistent across
 * adapters for the same chain (Aave writes "Ethereum", Morpho/Compound write
 * "ethereum" / "op mainnet"). Only chain_id is canonical.
 */

/** Display name for a chainId, falling back to the adapter-written name. */
export function chainName(chainId: number, fallback: string): string {
  return CHAIN_BY_ID[chainId]?.name ?? fallback
}
