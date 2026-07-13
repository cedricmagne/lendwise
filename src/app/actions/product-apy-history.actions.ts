'use server'

import { cache } from 'react'

import type { Period } from '@/lib/chart-availability'
import { productApyHistory } from '@/lib/db/repositories/apy'
import { listAvailabilityPeriods } from '@/lib/db/repositories/products'
import type { RewardItem } from '@/lib/db/types'
import { TIMEFRAME_OPTIONS, type TimeframeLabel } from '@/types'

/**
 * One slot of a product's history, flattened for the client charts.
 * APY fields are fractions (0–1); `utilization` is a fraction; USD fields raw.
 */
export interface ProductHistoryPoint {
  timestamp: number
  base: number
  rewards: number
  fees: number
  net: number
  supplyAssetsUsd: number | null
  borrowAssetsUsd: number | null
  collateralAssetsUsd: number | null
  utilization: number | null
  priceUsd: number | null
  rewardItems: RewardItem[]
}

export interface LoadProductHistoryParams {
  productId: string
  interval: TimeframeLabel
  fromTimestamp: number
}

/**
 * Load a single product's full APY + market-state series from our pipeline
 * tables. 24h uses hourly grain; everything else uses daily. Returns [] on
 * error or when the product has no stored history (caller may fall back).
 */
export const loadProductApyHistory = cache(async function loadProductApyHistory(
  params: LoadProductHistoryParams
): Promise<ProductHistoryPoint[]> {
  const option = TIMEFRAME_OPTIONS.find((o) => o.label === params.interval)
  const grain = option?.interval === 'HOUR' ? 'hourly' : 'daily'

  try {
    const from = params.fromTimestamp
      ? new Date(params.fromTimestamp * 1000)
      : undefined
    const rows = await productApyHistory(params.productId, grain, from)

    return rows.map((r) => ({
      timestamp: Math.floor(r.t.getTime() / 1000),
      base: r.base,
      rewards: r.rewards,
      fees: r.fees,
      net: r.net,
      supplyAssetsUsd: r.supplyAssetsUsd,
      borrowAssetsUsd: r.borrowAssetsUsd,
      collateralAssetsUsd: r.collateralAssetsUsd,
      utilization: r.utilizationRate,
      priceUsd: r.assetPriceUsd,
      rewardItems: r.rewardItems,
    }))
  } catch (err) {
    console.error('Failed to load product apy history:', err)
    return []
  }
})

/**
 * When the pool was listed — so the chart knows where to CUT its line rather than
 * drawing one across a stretch in which the market did not exist.
 *
 * Returns [] on error, and [] is the safe value: `deadStretches` reads an empty
 * history as "we don't know", not as "it was never listed", so a failure here
 * degrades to today's behaviour instead of shading the whole chart grey.
 */
export const loadProductAvailability = cache(
  async function loadProductAvailability(productId: string): Promise<Period[]> {
    try {
      const periods = await listAvailabilityPeriods(productId)
      return periods.map((p) => ({
        activatedAt: Math.floor(p.activatedAt.getTime() / 1000),
        deactivatedAt: p.deactivatedAt
          ? Math.floor(p.deactivatedAt.getTime() / 1000)
          : null,
      }))
    } catch (err) {
      console.error('Failed to load product availability:', err)
      return []
    }
  }
)
