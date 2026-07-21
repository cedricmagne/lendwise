'use server'

import { unstable_cache } from 'next/cache'

import { type ProtocolName } from '@/config/protocols-meta'
import { APP_ADAPTERS } from '@/config/protocols-server'
import { apyEnrichments, latestHourly } from '@/lib/db/repositories/apy'
import { listDisplayFlaggedIds } from '@/lib/db/repositories/display-flags'
import { ineligibilityReason } from '@/lib/display-eligibility'
import type { AppAdapter } from '@/lib/protocols/core/types'
import { BorrowProduct, SupplyProduct } from '@/types'

/** The minimum a product must carry for the display policy to judge it. */
type Judgeable = {
  productId?: string
  apy: number
  assetAmountUsd: number
}

/**
 * Drop pools that must not be ranked, in two layers.
 *
 * The persisted flags are the considered verdict, but they lag: a pool needs 3
 * bad hours before the hourly job hides it. So the freshly-enriched values are
 * ALSO judged directly — a market that empties out or starts quoting nonsense
 * disappears at the next 60-second cache refresh instead of topping the table for
 * three hours. The immediate check writes nothing; it cannot un-hide a flagged
 * pool, only hide an extra one.
 *
 * Runs before the sort, so an ineligible pool cannot distort the ordering it is
 * about to be excluded from.
 */
function eligibleForDisplay<T extends Judgeable>(
  items: T[],
  flagged: Set<string>
): T[] {
  return items.filter((p) => {
    if (p.productId && flagged.has(p.productId)) return false
    return (
      ineligibilityReason({ tvlUsd: p.assetAmountUsd, apyNet: p.apy }) === null
    )
  })
}

async function _loadSupplyProducts(): Promise<SupplyProduct[]> {
  const entries = Object.entries(APP_ADAPTERS) as [
    ProtocolName,
    () => Promise<AppAdapter>,
  ][]

  const results = await Promise.allSettled(
    entries.map(async ([, load]) => (await load()).getSupplyProducts())
  )

  const allSupplyProducts: SupplyProduct[] = []

  results.forEach((result, index) => {
    const protocolId = entries[index][0]
    if (result.status === 'fulfilled') {
      allSupplyProducts.push(...result.value)
    } else {
      console.error(`Adapter ${protocolId} failed:`, result.reason)
    }
  })

  // Enrich with APY data from Postgres (all horizons)
  const productIds = allSupplyProducts
    .map((p) => p.productId)
    .filter(Boolean) as string[]

  const [enrichments, latest, flagged] = await Promise.all([
    apyEnrichments(productIds),
    latestHourly(productIds),
    listDisplayFlaggedIds(),
  ])

  const enriched = allSupplyProducts.map((p) => {
    if (!p.productId) return p
    const e = enrichments.get(p.productId)
    const l = latest.get(p.productId)
    return {
      ...p,
      apy: l?.apyNet ?? p.apy,
      apyDaily: e?.apyDaily,
      apyMonthly: e?.apyMonthly,
      apyYearly: e?.apyYearly,
      apyRewards: l?.apyRewards,
      apyRewardsDaily: e?.apyRewardsDaily,
      apyRewardsMonthly: e?.apyRewardsMonthly,
      apyRewardsYearly: e?.apyRewardsYearly,
    }
  })

  return eligibleForDisplay(enriched, flagged).sort((a, b) => b.apy - a.apy)
}

export const loadSupplyProducts = unstable_cache(
  _loadSupplyProducts,
  ['supplying-markets'],
  { revalidate: 60, tags: ['supplying-markets'] }
)

async function _loadBorrowProducts(): Promise<BorrowProduct[]> {
  const entries = Object.entries(APP_ADAPTERS) as [
    ProtocolName,
    () => Promise<AppAdapter>,
  ][]

  const results = await Promise.allSettled(
    entries.map(async ([, load]) => (await load()).getBorrowProducts())
  )

  const allBorrowProducts: BorrowProduct[] = []

  results.forEach((result, index) => {
    const protocolId = entries[index][0]
    if (result.status === 'fulfilled') {
      allBorrowProducts.push(...result.value)
    } else {
      console.error(`Adapter ${protocolId} failed:`, result.reason)
    }
  })

  // Enrich with APY data from Postgres (all horizons)
  const productIds = allBorrowProducts
    .map((p) => p.productId)
    .filter(Boolean) as string[]

  const [enrichments, latest, flagged] = await Promise.all([
    apyEnrichments(productIds),
    latestHourly(productIds),
    listDisplayFlaggedIds(),
  ])

  const enriched = allBorrowProducts.map((p) => {
    if (!p.productId) return p
    const e = enrichments.get(p.productId)
    return {
      ...p,
      apy: latest.get(p.productId)?.apyNet ?? p.apy,
      apyDaily: e?.apyDaily,
      apyMonthly: e?.apyMonthly,
      apyYearly: e?.apyYearly,
    }
  })

  return eligibleForDisplay(enriched, flagged).sort((a, b) => b.apy - a.apy)
}

export const loadBorrowProducts = unstable_cache(
  _loadBorrowProducts,
  ['borrowProducts'],
  { revalidate: 60, tags: ['borrowProducts'] }
)
