'use server'

import { unstable_cache } from 'next/cache'

import type { ApyEnrichment } from '@/lib/db/repositories/apy'
import { latestForTable } from '@/lib/db/repositories/apy'
import type { CatalogueRow, Kind } from '@/lib/db/types'
import { ineligibilityReason } from '@/lib/display-eligibility'
import { toBorrowProduct, toSupplyProduct } from '@/lib/products/from-catalogue'
import { BorrowProduct, SupplyProduct } from '@/types'

/**
 * A table product, served straight from our own database — one query, no
 * adapter call. `latestForTable(kind)` already joins the 7d / 1M / 1y
 * `apy_daily` averages alongside the hourly observation (no second
 * `apyEnrichments` round trip keyed off returned ids) and already applies
 * `productConds()`'s persisted display-flag predicate in SQL. A protocol API
 * incident no longer touches either page — previously a Morpho timeout
 * emptied `/supply`, the adapter's `catch` returning an empty array.
 *
 * The one thing SQL does NOT yet cover: `productConds()`'s flag only acts
 * after `flagHours` (3) consecutive bad hours, so a pool that drains below
 * `minTvlUsd` or starts quoting an absurd APY mid-hour would otherwise sit
 * atop the descending-APY sort for up to three hours instead of disappearing
 * at the next 60s cache refresh. This re-judges the freshly-read values
 * directly — it writes nothing, so it can only hide a pool earlier than the
 * persisted flag would, never un-hide one the flag already caught. The plan
 * `2026-07-27-display-filters-replace-eligibility.md` removes this layer once
 * it moves the predicate into SQL — don't remove it before that (it closes a
 * real gap), and don't keep it after (it would become a second truth that can
 * drift from the first).
 *
 * `toProduct` is called as `(row) => toProduct(row)`, never `rows.map(toProduct)`
 * directly: `map` passes `(element, index, array)`, and `toSupplyProduct` /
 * `toBorrowProduct`'s optional second parameter is the enrichment, not an
 * index — `rows.map(toSupplyProduct)` would silently feed it the row's
 * position in the array.
 */
async function loadEligibleProducts<
  T extends { apy: number; assetAmountUsd: number },
>(kind: Kind, toProduct: (row: CatalogueRow, e?: ApyEnrichment) => T) {
  const rows = await latestForTable(kind)
  const items = rows.map((r) => toProduct(r))
  return items.filter(
    (p) =>
      ineligibilityReason({ tvlUsd: p.assetAmountUsd, apyNet: p.apy }) === null
  )
}

async function _loadSupplyProducts(): Promise<SupplyProduct[]> {
  return loadEligibleProducts('supply', toSupplyProduct)
}

export const loadSupplyProducts = unstable_cache(
  _loadSupplyProducts,
  ['supplying-markets'],
  { revalidate: 60, tags: ['supplying-markets'] }
)

async function _loadBorrowProducts(): Promise<BorrowProduct[]> {
  return loadEligibleProducts('borrow', toBorrowProduct)
}

export const loadBorrowProducts = unstable_cache(
  _loadBorrowProducts,
  ['borrowProducts'],
  { revalidate: 60, tags: ['borrowProducts'] }
)
