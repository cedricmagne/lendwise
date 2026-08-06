import type { BorrowProduct, Collateral, SupplyProduct } from '@/lib/db/types'
import type { MarketsApyQuery } from '@/lib/protocols/aave/v3/generated/graphql'
import { MARKETS_APY } from '@/lib/protocols/aave/v3/queries'
import { createGraphQLClient } from '@/lib/protocols/core/toolkit'
import type { FetchOpts } from '@/lib/protocols/core/types'

import { AAVE_PROVIDER } from '../common/config'
import { AAVE_V3_API_URL, AAVE_V3_CHAINS } from './config'
import { listsBorrow } from './listing'
import type { AaveBorrowMeta, AaveSupplyMeta } from './types'
import { buildProductId } from './utils'

/**
 * Fetch static pool metadata for all active AAVE v3 markets.
 * Returns SupplyPool and BorrowPool objects.
 *
 * One reserve → two objects (supply + borrow).
 * Borrow pool collaterals are built from all reserves in the same market
 * where canBeCollateral = true.
 * Reuses MARKETS_APY query — aToken/vToken fields must be present.
 */
export async function fetchAaveV3Products(
  opts?: FetchOpts
): Promise<(SupplyProduct | BorrowProduct)[]> {
  const client = createGraphQLClient(AAVE_V3_API_URL)

  let chainIds = Object.keys(AAVE_V3_CHAINS).map(Number)
  const filterChainIds = opts?.chainIds
  if (filterChainIds?.length) {
    chainIds = chainIds.filter((id) => filterChainIds.includes(id))
  }

  const { data, error } = await client
    .query<MarketsApyQuery>(MARKETS_APY, { request: { chainIds } })
    .toPromise()

  if (error) {
    console.error('[products:aave] Failed to fetch markets:', error.message)
    return []
  }

  if (!data?.markets) return []

  const products: (SupplyProduct | BorrowProduct)[] = []
  const now = new Date()

  for (const market of data.markets) {
    // ─── Build collateral list for this market ──────────────────────────────
    // All reserves that can be used as collateral across this market.
    // Each borrow pool gets this full list — AAVE is multi-collateral.
    const marketCollaterals: Collateral[] = market.reserves
      .filter((r) => r.supplyInfo?.canBeCollateral === true)
      .map((r) => ({
        symbol: r.underlyingToken.symbol,
        name: r.underlyingToken.name,
        address: r.underlyingToken.address,
        decimals: r.underlyingToken.decimals,
        ltv: Number(r.supplyInfo?.maxLTV?.value ?? 0),
        lltv: Number(r.supplyInfo?.liquidationThreshold?.value ?? 0),
        canBeCollateral: true,
      }))

    for (const reserve of market.reserves) {
      const asset = {
        symbol: reserve.underlyingToken.symbol,
        name: reserve.underlyingToken.name,
        address: reserve.underlyingToken.address,
        decimals: reserve.underlyingToken.decimals,
      }

      const supplyId = buildProductId(reserve, 'supply')
      const borrowId = buildProductId(reserve, 'borrow')

      // ─── Supply product ─────────────────────────────────────────────────────────────────────────

      const supplyProduct: SupplyProduct<AaveSupplyMeta> = {
        _id: supplyId,
        kind: 'supply',
        protocol: {
          provider: AAVE_PROVIDER,
          type: 'reserve',
          version: 'v3',
          subgraphUrl: AAVE_V3_API_URL,
          name: reserve.market.name,
          chain: {
            id: reserve.market.chain.chainId,
            name: reserve.market.chain.name,
          },
          address: reserve.market.address,
          meta: {
            underlyingToken: reserve.underlyingToken.address,
            aTokenSymbol: reserve.aToken?.symbol ?? '',
            maxLTV: Number(reserve.supplyInfo?.maxLTV?.value ?? 0),
            liquidationThreshold: Number(
              reserve.supplyInfo?.liquidationThreshold?.value ?? 0
            ),
          },
        },
        asset,
        active: true,
        createdAt: now,
        updatedAt: now,
      }

      products.push(supplyProduct)

      // ─── Borrow product ─────────────────────────────────────────────────────────────────────────
      // The shared listing rule — the APY collector applies the same one, so the
      // two enumerations cannot drift (see ./listing.ts).
      if (listsBorrow(reserve)) {
        const borrowProduct: BorrowProduct<AaveBorrowMeta> = {
          _id: borrowId,
          kind: 'borrow',
          protocol: {
            provider: AAVE_PROVIDER,
            type: 'reserve',
            version: 'v3',
            subgraphUrl: AAVE_V3_API_URL,
            name: reserve.market.name,
            chain: {
              id: reserve.market.chain.chainId,
              name: reserve.market.chain.name,
            },
            address: reserve.market.address,
            meta: {
              underlyingToken: reserve.underlyingToken.address,
              vTokenSymbol: reserve.vToken?.symbol ?? '',
              variableRateSlope1: Number(
                reserve.borrowInfo?.variableRateSlope1?.value ?? 0
              ),
              variableRateSlope2: Number(
                reserve.borrowInfo?.variableRateSlope2?.value ?? 0
              ),
              optimalUsageRate: Number(
                reserve.borrowInfo?.optimalUsageRate?.value ?? 0
              ),
              baseVariableBorrowRate: Number(
                reserve.borrowInfo?.baseVariableBorrowRate?.value ?? 0
              ),
            },
          },
          asset,
          collaterals: marketCollaterals,
          active: true,
          createdAt: now,
          updatedAt: now,
        }

        products.push(borrowProduct)
      }
    }
  }

  console.log(`[products:aave] Fetched ${products.length} product documents`)
  console.log(
    `[products:aave] Breakdown: ${products.filter((p) => p.kind === 'borrow').length} borrow reserves + ${products.filter((p) => p.kind === 'supply').length} supply reserves`
  )
  return products
}
