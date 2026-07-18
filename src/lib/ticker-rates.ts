import { queryLatestApy } from '@/lib/db/repositories/apy'
import { CHAIN_BY_ID } from '@/lib/protocols/core/toolkit'

export interface TickerRate {
  protocol: string
  chain: string
  rate: string
  tag: string
}

const PROVIDERS = ['aave', 'morpho', 'compound'] as const

const PROVIDER_LABEL: Record<string, string> = {
  aave: 'Aave v3',
  morpho: 'Morpho',
  compound: 'Compound v3',
}

/** Thin markets are APY noise — same spirit as the tables' display floors. */
const MIN_TVL_USD = 250_000

/**
 * Diversity rules — a marquee of twelve Morpho-Ethereum vaults reads like a
 * bug, not a market. Queried per provider so every protocol shows up even when
 * one dominates the top of the APY board, then capped per provider×chain.
 */
const MAX_PER_PROVIDER = 4
const MAX_PER_PROVIDER_CHAIN = 2

interface Candidate {
  item: TickerRate
  apy: number
  provider: string
  chainId: number
}

function toCandidate(
  r: Awaited<ReturnType<typeof queryLatestApy>>['rows'][number],
  tag: 'supply' | 'borrow'
): Candidate {
  return {
    item: {
      protocol: PROVIDER_LABEL[r.product.provider] ?? r.product.provider,
      chain: (
        CHAIN_BY_ID[r.product.chainId]?.slug ?? r.product.chainName
      ).toUpperCase(),
      rate: `${(r.row.apyNet * 100).toFixed(2)}%`,
      tag,
    },
    apy: r.row.apyNet,
    provider: r.product.provider,
    chainId: r.product.chainId,
  }
}

/** Apply the caps, preserving the input order (already best-first). */
function diversify(candidates: Candidate[], take: number): Candidate[] {
  const perProvider = new Map<string, number>()
  const perProviderChain = new Map<string, number>()
  const picked: Candidate[] = []

  for (const c of candidates) {
    if (picked.length >= take) break
    const chainKey = `${c.provider}:${c.chainId}`
    if ((perProvider.get(c.provider) ?? 0) >= MAX_PER_PROVIDER) continue
    if ((perProviderChain.get(chainKey) ?? 0) >= MAX_PER_PROVIDER_CHAIN)
      continue
    picked.push(c)
    perProvider.set(c.provider, (perProvider.get(c.provider) ?? 0) + 1)
    perProviderChain.set(chainKey, (perProviderChain.get(chainKey) ?? 0) + 1)
  }
  return picked
}

async function fetchKind(
  kind: 'supply' | 'borrow',
  orderDir: 'asc' | 'desc',
  perProvider: number,
  take: number
): Promise<Candidate[]> {
  const results = await Promise.allSettled(
    PROVIDERS.map((protocol) =>
      queryLatestApy(
        { kind, protocol, minTvlUsd: MIN_TVL_USD },
        { first: perProvider, skip: 0, orderBy: 'apyNet', orderDir }
      )
    )
  )

  const candidates = results
    .flatMap((r) => (r.status === 'fulfilled' ? r.value.rows : []))
    .map((r) => toCandidate(r, kind))
    .sort((a, b) => (orderDir === 'desc' ? b.apy - a.apy : a.apy - b.apy))

  return diversify(candidates, take)
}

/**
 * Real rates for the landing marquee — the best current supply APYs and the
 * cheapest borrow rates, one entry per market, interleaved. Reads the same
 * latest-hourly path as the product tables (display-ineligible pools already
 * filtered), so the marquee can never advertise a rate the app itself would
 * refuse to show.
 *
 * Null on failure — the caller keeps its static fallback and the landing never
 * 500s over a marquee.
 */
export async function tickerRatesSafe(): Promise<TickerRate[] | null> {
  try {
    const [supply, borrow] = await Promise.all([
      fetchKind('supply', 'desc', 8, 9),
      fetchKind('borrow', 'asc', 4, 5),
    ])
    if (supply.length === 0) return null

    // Interleave: one borrow rate after every other supply rate.
    const mixed: TickerRate[] = []
    let b = 0
    for (const [i, s] of supply.entries()) {
      mixed.push(s.item)
      if (i % 2 === 1 && b < borrow.length) mixed.push(borrow[b++].item)
    }
    mixed.push(...borrow.slice(b).map((c) => c.item))

    return mixed
  } catch (err) {
    console.error('[ticker-rates] falling back to demo rates:', err)
    return null
  }
}
