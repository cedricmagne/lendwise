import { defineChain, http } from 'viem'
import type { Chain } from 'viem/chains'
import {
  arbitrum,
  avalanche,
  base,
  bsc,
  celo,
  linea,
  mainnet,
  mantle,
  optimism,
  polygon,
  scroll,
  unichain,
  zksync,
} from 'viem/chains'

import type { RegisteredChainId } from '@/lib/protocols/core/toolkit'

/**
 * Execution layer — the chains where Lendwise can drive a wallet (send a
 * transaction, wait for a receipt, read a native balance).
 *
 * Identity lives in the chain registry (core/toolkit/chain-slugs.ts) and data
 * coverage in each adapter config; both extend without touching this file. A
 * chain ingested for data but absent here is simply view-only in the UI —
 * `isTxSupported` is the one predicate consumers ask.
 *
 * Membership = the Infura project has the network enabled (checked live before
 * adding — an entry whose RPC 403s is worse than none). Remaining view-only
 * chains (gnosis, metis, soneium, sonic, plasma, ink, xlayer, katana, …) are
 * not served by Infura; adding one means finding it an RPC first.
 *
 * EVM-only by nature (wagmi). A future non-EVM execution stack (e.g. Stellar
 * wallets for Blend) gets its own module; it shares the registry, not this file.
 */

if (!process.env.NEXT_PUBLIC_INFURA_API_KEY) {
  throw new Error('NEXT_PUBLIC_INFURA_API_KEY is not defined')
}

const INFURA_API_KEY = process.env.NEXT_PUBLIC_INFURA_API_KEY

const infura = (subdomain: string) =>
  `https://${subdomain}.infura.io/v3/${INFURA_API_KEY}`

// Not in our viem version yet — minimal definitions, explorers can come later.
const hyperevm = defineChain({
  id: 999,
  name: 'HyperEVM',
  nativeCurrency: { name: 'Hyperliquid', symbol: 'HYPE', decimals: 18 },
  rpcUrls: { default: { http: [infura('hyperevm-mainnet')] } },
})

const megaeth = defineChain({
  id: 4326,
  name: 'MegaETH',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [infura('megaeth-mainnet')] } },
})

const monad = defineChain({
  id: 143,
  name: 'Monad',
  nativeCurrency: { name: 'Monad', symbol: 'MON', decimals: 18 },
  rpcUrls: { default: { http: [infura('monad-mainnet')] } },
})

export const TX_CHAINS = [
  { ...mainnet, rpc: infura('mainnet') },
  { ...arbitrum, rpc: infura('arbitrum-mainnet') },
  { ...optimism, rpc: infura('optimism-mainnet') },
  { ...polygon, rpc: infura('polygon-mainnet') },
  { ...base, rpc: infura('base-mainnet') },
  { ...linea, rpc: infura('linea-mainnet') },
  { ...avalanche, rpc: infura('avalanche-mainnet') },
  { ...bsc, rpc: infura('bsc-mainnet') },
  { ...celo, rpc: infura('celo-mainnet') },
  { ...zksync, rpc: infura('zksync-mainnet') },
  { ...mantle, rpc: infura('mantle-mainnet') },
  { ...scroll, rpc: infura('scroll-mainnet') },
  { ...unichain, rpc: infura('unichain-mainnet') },
  { ...hyperevm, rpc: infura('hyperevm-mainnet') },
  { ...megaeth, rpc: infura('megaeth-mainnet') },
  { ...monad, rpc: infura('monad-mainnet') },
] as const

/** Compile-time guard: every tx chain must exist in the chain registry. */
type AssertRegistered<T extends RegisteredChainId> = T
export type TxChainId = AssertRegistered<(typeof TX_CHAINS)[number]['id']>

const TX_CHAIN_IDS: ReadonlySet<number> = new Set(TX_CHAINS.map((c) => c.id))

/**
 * Execution count — chains with wallet support. The data/marketing count is
 * STANDARDIZED_CHAIN_COUNT in `@/config/chains-coverage`.
 */
export const TX_CHAIN_COUNT = TX_CHAINS.length

/** Can Lendwise drive a wallet on this chain? false = view-only in the UI. */
export function isTxSupported(chainId: number): boolean {
  return TX_CHAIN_IDS.has(chainId)
}

export const ALL_CHAINS = TX_CHAINS

export const CHAINS = {
  MAINNETS: TX_CHAINS,
  TESTNETS: [] as readonly Chain[],
} as const

export const CHAIN_TRANSPORTS = Object.fromEntries(
  TX_CHAINS.map((chain) => [chain.id, http(chain.rpc)])
)
