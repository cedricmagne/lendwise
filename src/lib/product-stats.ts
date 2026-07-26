import { HORIZON_CONFIG, HorizonKey } from '@/config/horizon'
import { DISPLAY_POLICY } from '@/lib/display-eligibility'
import { BorrowProduct, SupplyProduct } from '@/types'

type Product = SupplyProduct | BorrowProduct

export interface RateStats<T> {
  count: number
  protocols: number
  networks: number
  assets: number
  /** Highest rate of the set — the top row when sorting the APY column desc. */
  highest: { value: number; item: T } | null
  /** Lowest rate of the set — the top row when sorting the APY column asc. */
  lowest: { value: number; item: T } | null
  median: number | null
  totalDepositsUsd: number
  totalLiquidityUsd: number
  /** Aggregate borrowed / deposited across the set, in percent. */
  utilizationPct: number | null
}

/**
 * Stats over a set of products at one horizon.
 *
 * `loadSupplyProducts` / `loadBorrowProducts` already drop display-ineligible
 * pools, but they judge the SPOT apy only. A pool can therefore pass ingestion
 * on a sane spot rate and still carry an absurd 7D/1M average, so the horizon
 * rate is re-checked against the same ceiling here — a headline "best rate" must
 * never point at a number no market can sustain.
 */
export const computeRateStats = <T extends Product>(
  items: T[],
  horizon: HorizonKey
): RateStats<T> => {
  const apyKey = HORIZON_CONFIG[horizon].apyKey
  const protocols = new Set<string>()
  const networks = new Set<string>()
  const assets = new Set<string>()

  let highest: { value: number; item: T } | null = null
  let lowest: { value: number; item: T } | null = null
  let totalDepositsUsd = 0
  let totalLiquidityUsd = 0
  const rates: number[] = []

  for (const item of items) {
    protocols.add(item.protocol)
    networks.add(item.network)
    assets.add(item.assetSymbol)
    totalDepositsUsd += item.assetAmountUsd
    totalLiquidityUsd += item.liquidityAmountUsd

    const value = item[apyKey] as number | undefined
    if (value === undefined || !Number.isFinite(value)) continue
    if (Math.abs(value) > DISPLAY_POLICY.maxAbsNetApy) continue
    rates.push(value)
    if (!highest || value > highest.value) highest = { value, item }
    if (!lowest || value < lowest.value) lowest = { value, item }
  }

  rates.sort((a, b) => a - b)
  const mid = Math.floor(rates.length / 2)
  const median =
    rates.length === 0
      ? null
      : rates.length % 2 === 0
        ? (rates[mid - 1] + rates[mid]) / 2
        : rates[mid]

  return {
    count: items.length,
    protocols: protocols.size,
    networks: networks.size,
    assets: assets.size,
    highest,
    lowest,
    median,
    totalDepositsUsd,
    totalLiquidityUsd,
    utilizationPct:
      totalDepositsUsd > 0
        ? Math.min(
            100,
            Math.max(
              0,
              ((totalDepositsUsd - totalLiquidityUsd) / totalDepositsUsd) * 100
            )
          )
        : null,
  }
}

/**
 * The rate the user is missing by filtering: the best market overall, when it is
 * better than the best one their filter lets them see. Null when their filter
 * already contains the best market — no filter, no nag.
 *
 * `better` is `highest` on supply (earn more) and `lowest` on borrow (pay less).
 */
export const findOpportunity = <T extends Product>(
  all: RateStats<T>,
  filtered: RateStats<T>,
  better: 'highest' | 'lowest'
): {
  item: T
  value: number
  filteredValue: number
  deltaPts: number
} | null => {
  const best = all[better]
  const mine = filtered[better]
  if (!best || !mine) return null

  const beats =
    better === 'highest' ? best.value > mine.value : best.value < mine.value
  if (!beats) return null

  return {
    item: best.item,
    value: best.value,
    filteredValue: mine.value,
    deltaPts: Math.abs(best.value - mine.value) * 100,
  }
}

export const pluralize = (count: number, singular: string) =>
  `${count} ${singular}${count === 1 ? '' : 's'}`

/**
 * The one place an APY becomes text. Every table cell, stat and modal calls it,
 * so a stat can never read differently from the row it points at.
 *
 * Rates go NEGATIVE and it is not an error: a borrow market whose rewards
 * outrun its base rate pays the user to borrow. The tables each carried their
 * own copy of this clamp written as `value < 0.0001`, which is true of every
 * negative — so a real -1.10% rendered as "<0.01%", a rate that pays you shown
 * as a rate too small to matter.
 *
 * A near-zero negative reads ">-0.01%", not "<-0.01%": it sits BETWEEN -0.01%
 * and zero, and a clamp must not assert the wrong side of its own bound.
 */
export const formatApy = (value: number | null | undefined) => {
  if (value === undefined || value === null || !Number.isFinite(value))
    return '-'
  if (Math.abs(value) < 0.0001) return value < 0 ? '>-0.01%' : '<0.01%'
  if (value > 10) return '>1000%'
  if (value < -10) return '<-1000%'
  return `${(value * 100).toFixed(2)}%`
}

/** "1.20% – 56.65%" — the span the APY column covers across all markets. */
export const formatRateRange = <T>(stats: RateStats<T>) =>
  stats.lowest && stats.highest
    ? `range ${formatApy(stats.lowest.value)} – ${formatApy(stats.highest.value)}`
    : undefined

export const formatMarketLabel = (
  item: Product | null | undefined,
  resolveProtocolName: (protocol: string) => string
) => {
  if (!item) return undefined
  const network = item.network.charAt(0).toUpperCase() + item.network.slice(1)
  return `${item.poolName} · ${resolveProtocolName(item.protocol)} · ${network}`
}
