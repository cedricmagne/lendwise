import { Version } from '@blend-capital/blend-sdk'

import type { BorrowProduct, Collateral, SupplyProduct } from '@/lib/db/types'
import type { FetchOpts } from '@/lib/protocols/core/types'

import {
  getPool,
  getTokenMetadata,
  isRpcRefusal,
  primeTokenMetadata,
} from '../common/api'
import { BLEND_PROVIDER } from '../common/config'
import { buildProductId } from '../common/utils'
import { blendPoolIds } from '../listing'
import { BLEND_V2_CHAINS } from './config'

/**
 * Fetch static pool metadata for every Blend V2 pool.
 * Returns SupplyProduct and BorrowProduct — one reserve → two documents.
 * Called by the daily pools sync job.
 *
 * The pool set comes from `./listing` — `opts.poolIds` (the `products`
 * catalogue, injected by the pipeline) unioned with a fresh factory Deploy scan.
 */
export async function fetchBlendV2Products(
  opts?: FetchOpts
): Promise<(SupplyProduct | BorrowProduct)[]> {
  // No `opts.chainIds` handling: Blend is single-chain (Stellar, id -1), so the
  // filter is a no-op here. `apy-spot.ts` still threads it for a log line only.
  const poolIds = await blendPoolIds('v2', opts, 'catalogue')
  if (poolIds.length === 0) {
    console.warn('[pools:blend_v2] no pool ids resolved — skipping')
    return []
  }
  console.log(`[pools:blend_v2] ${poolIds.length} pools`)

  const products: (SupplyProduct | BorrowProduct)[] = []
  let borrowProductsCount = 0
  let vaultProductsCount = 0
  const now = new Date()

  for (const poolId of poolIds) {
    try {
      const pool = await getPool({ version: Version.V2, poolId })

      // Hubble surfaces every historical `Deploy`, including superseded
      // redeployments still in `status: Setup` with no positions; skip them.
      // Do NOT filter statuses 4/5: pools frozen post-hack still hold real
      // user funds and must stay listed.
      if (pool.metadata?.status === 6) {
        console.log(
          `[pools:blend_v2] pool ${poolId} skipped: status 6 (setup / not launched)`
        )
        continue
      }

      const name = pool.metadata?.name ?? poolId
      console.log(
        `■ Pool "${name}" (${poolId}) — ${pool.reserves.size} reserves`
      )

      // One request for the pool's token metadata instead of one per reserve.
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
          _id: buildProductId({
            poolId,
            assetId,
            kind: 'supply',
            version: Version.V2,
          }),
          kind: 'supply',
          protocol: {
            provider: BLEND_PROVIDER,
            type: 'reserve',
            version: Version.V2.toLowerCase(),
            subgraphUrl: '',
            name,
            chain: {
              id: -1,
              name: BLEND_V2_CHAINS[-1].slug,
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
          _id: buildProductId({
            poolId,
            assetId,
            kind: 'borrow',
            version: Version.V2,
          }),
          kind: 'borrow',
          protocol: {
            provider: BLEND_PROVIDER,
            type: 'reserve',
            version: Version.V2.toLowerCase(),
            subgraphUrl: '',
            name,
            chain: {
              id: -1,
              name: BLEND_V2_CHAINS[-1].slug,
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
    } catch (err) {
      if (isRpcRefusal(err)) throw err // 500 → QStash replays
      console.error(
        `[pools:blend_v2] pool ${poolId} skipped: ${
          err instanceof Error ? err.message : err
        }`
      )
    }
  }

  console.log(`[pools:blend] Fetched ${products.length} product documents`)
  console.log(
    `[pools:blend] Breakdown: ${borrowProductsCount} borrow markets + ${vaultProductsCount} vault supplies`
  )
  return products
}
