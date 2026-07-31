'use server'

import { unstable_cache } from 'next/cache'

import type { ApyEnrichment } from '@/lib/db/repositories/apy'
import { latestForTable } from '@/lib/db/repositories/apy'
import type { CatalogueRow, Kind } from '@/lib/db/types'
import { toBorrowProduct, toSupplyProduct } from '@/lib/products/from-catalogue'
import { BorrowProduct, SupplyProduct } from '@/types'

/**
 * A table product, served straight from our own database — one query, no
 * adapter call. `latestForTable(kind)` already joins the 7d / 1M / 1y
 * `apy_daily` averages alongside the hourly observation (no second
 * `apyEnrichments` round trip keyed off returned ids), already scopes to the
 * catalogue via its `INNER JOIN` on `products`, and already orders by
 * `apyNet DESC NULLS LAST`. A protocol API incident no longer touches either
 * page — previously a Morpho timeout emptied `/supply`, the adapter's `catch`
 * returning an empty array.
 *
 * This function no longer re-judges display eligibility: that predicate now
 * lives once, as the shared filter registry (`src/lib/table-filters/`) — the
 * browser applies it client-side, and the API applies its own default via
 * `displayFilters()` in the repository. Keeping a second copy here would have
 * been a second truth that could drift from the first.
 *
 * `toProduct` is called as `(row) => toProduct(row)`, never `rows.map(toProduct)`
 * directly: `map` passes `(element, index, array)`, and `toSupplyProduct` /
 * `toBorrowProduct`'s optional second parameter is the enrichment, not an
 * index — `rows.map(toSupplyProduct)` would silently feed it the row's
 * position in the array.
 */
async function loadProducts<T>(
  kind: Kind,
  toProduct: (row: CatalogueRow, e?: ApyEnrichment) => T
): Promise<T[]> {
  const rows = await latestForTable(kind)
  return rows.map((r) => toProduct(r))
}

async function _loadSupplyProducts(): Promise<SupplyProduct[]> {
  return loadProducts('supply', toSupplyProduct)
}

export const loadSupplyProducts = unstable_cache(
  _loadSupplyProducts,
  ['supplying-markets'],
  { revalidate: 60, tags: ['supplying-markets'] }
)

async function _loadBorrowProducts(): Promise<BorrowProduct[]> {
  return loadProducts('borrow', toBorrowProduct)
}

export const loadBorrowProducts = unstable_cache(
  _loadBorrowProducts,
  ['borrowProducts'],
  { revalidate: 60, tags: ['borrowProducts'] }
)
