import { Version } from '@blend-capital/blend-sdk'

import type { BorrowProduct, Collateral, SupplyProduct } from '@/lib/db/types'
import type { FetchOpts } from '@/lib/protocols/core/types'

import {
  getBackstop,
  getPool,
  getTokenMetadata,
  primeTokenMetadata,
} from '../common/api'
import { BLEND_PROVIDER } from '../common/config'
import { buildProductId } from '../common/utils'
import { BLEND_V1_CHAINS } from './config'

/**
 * Fetch static pool metadata for all active Morpho Blue markets.
 * Returns SupplyPool and BorrowPool.
 * One market → two documents (supply + borrow).
 * Called by the daily pools sync job.
 */
export async function fetchBlendV1Products(
  opts?: FetchOpts
): Promise<(SupplyProduct | BorrowProduct)[]> {
  let chainIds = Object.keys(BLEND_V1_CHAINS).map(Number)
  if (opts?.chainIds?.length) {
    chainIds = chainIds.filter((id) => opts.chainIds!.includes(id))
  }

  const backstop = await getBackstop({ version: Version.V1 })
  const poolIds = backstop.config?.rewardZone ?? []

  console.log(`Discovered ${poolIds.length} pools in the Backstop reward zone.`)
  console.log(`Reading ${poolIds.length} pool(s)…\n`)

  console.log('chainIds', chainIds)

  const products: (SupplyProduct | BorrowProduct)[] = []
  let borrowProductsCount = 0
  let vaultProductsCount = 0
  const now = new Date()

  for (const poolId of poolIds) {
    const pool = await getPool({ version: Version.V1, poolId })
    const name = pool.metadata?.name ?? poolId
    console.log(`■ Pool "${name}" (${poolId}) — ${pool.reserves.size} reserves`)

    // One request for the pool.s token metadata instead of one per reserve.
    await primeTokenMetadata([...pool.reserves.keys()])

    // ─── Build collateral list for this pool ────────────────────────────
    // All reserves usable as collateral in this pool — Blend pools are
    // multi-collateral, like AAVE (unlike Morpho's isolated pairs).
    const poolCollaterals: Collateral[] = []
    for (const [assetId, reserve] of pool.reserves) {
      const collateralFactor = reserve.getCollateralFactor()
      if (collateralFactor <= 0) continue

      const token = await getTokenMetadata(assetId)

      poolCollaterals.push({
        symbol: token.symbol,
        name: token.name,
        address: assetId,
        decimals: token.decimals,
        ltv: null, // Blend exposes a single collateral factor, no separate max-LTV
        lltv: collateralFactor,
        canBeCollateral: true,
      })
    }

    for (const assetId of pool.reserves.keys()) {
      const token = await getTokenMetadata(assetId)

      const supplyProduct: SupplyProduct = {
        _id: buildProductId({ poolId, assetId, kind: 'supply' }),
        kind: 'supply',
        protocol: {
          provider: BLEND_PROVIDER,
          type: 'reserve',
          version: Version.V1.toLowerCase(),
          subgraphUrl: '',
          name,
          chain: {
            id: -1,
            name: BLEND_V1_CHAINS[-1].slug,
          },
          address: poolId,
          meta: {
            wasmHash: pool.metadata?.wasmHash ?? '',
            admin: pool.metadata?.admin ?? '',
            name: pool.metadata?.name ?? '',
            backstop: pool.metadata?.backstop ?? '',
            backstopRate: pool.metadata?.backstopRate ?? 0,
            maxPositions: pool.metadata?.maxPositions ?? 0,
            minCollateral: (pool.metadata?.minCollateral ?? 0n).toString(),
            oracle: pool.metadata?.oracle ?? '',
            status: pool.metadata?.status ?? 0,
            reserveList: pool.metadata?.reserveList ?? [],
            latestLedger: pool.metadata?.latestLedger ?? 0,
          },
        },
        asset: {
          symbol: token.symbol,
          name: token.name,
          address: assetId,
          decimals: token.decimals,
        },
        active: true,
        createdAt: now,
        updatedAt: now,
      }
      products.push(supplyProduct)
      vaultProductsCount++

      const borrowProduct: BorrowProduct = {
        _id: buildProductId({ poolId, assetId, kind: 'borrow' }),
        kind: 'borrow',
        protocol: {
          provider: BLEND_PROVIDER,
          type: 'reserve',
          version: Version.V1.toLowerCase(),
          subgraphUrl: '',
          name,
          chain: {
            id: -1,
            name: BLEND_V1_CHAINS[-1].slug,
          },
          address: poolId,
          meta: {
            wasmHash: pool.metadata?.wasmHash ?? '',
            admin: pool.metadata?.admin ?? '',
            name: pool.metadata?.name ?? '',
            backstop: pool.metadata?.backstop ?? '',
            backstopRate: pool.metadata?.backstopRate ?? 0,
            maxPositions: pool.metadata?.maxPositions ?? 0,
            minCollateral: (pool.metadata?.minCollateral ?? 0n).toString(),
            oracle: pool.metadata?.oracle ?? '',
            status: pool.metadata?.status ?? 0,
            reserveList: pool.metadata?.reserveList ?? [],
            latestLedger: pool.metadata?.latestLedger ?? 0,
          },
        },
        asset: {
          symbol: token.symbol,
          name: token.name,
          address: assetId,
          decimals: token.decimals,
        },
        collaterals: poolCollaterals,
        active: true,
        createdAt: now,
        updatedAt: now,
      }
      products.push(borrowProduct)
      borrowProductsCount++
    }
  }

  console.log(`[pools:blend] Fetched ${products.length} product documents`)
  console.log(
    `[pools:blend] Breakdown: ${borrowProductsCount} borrow markets + ${vaultProductsCount} vault supplies`
  )
  return products
}
