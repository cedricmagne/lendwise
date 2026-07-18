/**
 * Canonical chain registry — the single source of chain IDENTITY.
 *
 * Three chain concerns, three owners:
 *
 *   identity   slug, chainId, name, caip2          → THIS FILE
 *   coverage   which chains a protocol ingests     → each adapter config
 *                                                    (AAVE_V3_CHAINS, MORPHO_V1_CHAINS, …)
 *   execution  viem Chain + RPC for wallet txs     → src/config/chains.ts (TX_CHAINS)
 *
 * Coverage and execution are independent: a chain can be ingested (view-only)
 * without being transactable, and vice versa. Both reference identity from here —
 * a slug or chainId that is not registered is a compile error, not a runtime drift.
 * Slugs feed productIds and the `network` field, so they must never change once
 * products exist for a chain.
 *
 * This module is imported relatively by adapter configs (jiti/codegen cannot
 * resolve the '@/' alias) and must stay dependency-free.
 */

export type ChainFamily = 'evm' | 'stellar'

const REGISTRY = [
  // ── EVM — chainId is the real eip155 id ─────────────────────────────────────
  { chainId: 1, slug: 'ethereum', name: 'Ethereum', family: 'evm' },
  { chainId: 10, slug: 'optimism', name: 'OP Mainnet', family: 'evm' },
  { chainId: 56, slug: 'bsc', name: 'BNB Smart Chain', family: 'evm' },
  { chainId: 100, slug: 'gnosis', name: 'Gnosis', family: 'evm' },
  { chainId: 130, slug: 'unichain', name: 'Unichain', family: 'evm' },
  { chainId: 137, slug: 'polygon', name: 'Polygon', family: 'evm' },
  { chainId: 143, slug: 'monad', name: 'Monad', family: 'evm' },
  { chainId: 146, slug: 'sonic', name: 'Sonic', family: 'evm' },
  { chainId: 196, slug: 'xlayer', name: 'X Layer', family: 'evm' },
  { chainId: 324, slug: 'zksync', name: 'ZKsync Era', family: 'evm' },
  { chainId: 480, slug: 'worldchain', name: 'World Chain', family: 'evm' },
  { chainId: 988, slug: 'stable', name: 'Stable', family: 'evm' },
  { chainId: 999, slug: 'hyperevm', name: 'HyperEVM', family: 'evm' },
  { chainId: 1088, slug: 'metis', name: 'Metis', family: 'evm' },
  { chainId: 1868, slug: 'soneium', name: 'Soneium', family: 'evm' },
  { chainId: 4217, slug: 'tempo', name: 'Tempo', family: 'evm' },
  { chainId: 4326, slug: 'megaeth', name: 'MegaETH', family: 'evm' },
  { chainId: 4663, slug: 'robinhood', name: 'Robinhood Chain', family: 'evm' },
  { chainId: 5000, slug: 'mantle', name: 'Mantle', family: 'evm' },
  { chainId: 5042, slug: 'arc', name: 'Arc', family: 'evm' },
  { chainId: 8453, slug: 'base', name: 'Base', family: 'evm' },
  { chainId: 9745, slug: 'plasma', name: 'Plasma', family: 'evm' },
  { chainId: 42161, slug: 'arbitrum', name: 'Arbitrum One', family: 'evm' },
  { chainId: 42220, slug: 'celo', name: 'Celo', family: 'evm' },
  { chainId: 43114, slug: 'avalanche', name: 'Avalanche', family: 'evm' },
  { chainId: 57073, slug: 'ink', name: 'Ink', family: 'evm' },
  { chainId: 59144, slug: 'linea', name: 'Linea', family: 'evm' },
  { chainId: 534352, slug: 'scroll', name: 'Scroll', family: 'evm' },
  { chainId: 747474, slug: 'katana', name: 'Katana', family: 'evm' },
  // ── Non-EVM — chainId is ASSIGNED, negative by convention ───────────────────
  // EVM chainIds are positive by construction, so negatives can never collide.
  // The number is a pure internal surrogate key (products.chain_id, GraphQL
  // chainId) — it never reaches productIds, URLs, display, or wallets.
  {
    chainId: -1,
    slug: 'stellar',
    name: 'Stellar',
    family: 'stellar',
    caip2: 'stellar:pubnet',
  },
] as const

export type RegisteredChainId = (typeof REGISTRY)[number]['chainId']
export type ChainSlug = (typeof REGISTRY)[number]['slug']

export interface RegisteredChain {
  chainId: RegisteredChainId
  slug: ChainSlug
  /** Canonical display name. */
  name: string
  family: ChainFamily
  /** CAIP-2 identifier (wallet interop standard, e.g. WalletConnect). */
  caip2: string
}

export const CHAIN_REGISTRY: readonly RegisteredChain[] = REGISTRY.map(
  (c) => ({
    ...c,
    caip2: 'caip2' in c ? c.caip2 : `eip155:${c.chainId}`,
  })
)

export const CHAIN_BY_SLUG = Object.fromEntries(
  CHAIN_REGISTRY.map((c) => [c.slug, c])
) as Record<ChainSlug, RegisteredChain>

/** Wide number key on purpose — lookups come from DB rows and API payloads. */
export const CHAIN_BY_ID: Record<number, RegisteredChain> = Object.fromEntries(
  CHAIN_REGISTRY.map((c) => [c.chainId, c])
)

export const CHAIN_SLUG_MAP = Object.fromEntries(
  CHAIN_REGISTRY.map((c) => [c.chainId, c.slug])
) as Record<RegisteredChainId, ChainSlug>

/** Build an adapter coverage map (chainId → { slug }) from registry slugs. */
export function adapterChains(
  slugs: readonly ChainSlug[]
): Record<number, { slug: ChainSlug }> {
  return Object.fromEntries(
    slugs.map((slug) => [CHAIN_BY_SLUG[slug].chainId, { slug }])
  )
}
