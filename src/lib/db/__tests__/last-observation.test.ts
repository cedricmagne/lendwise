import { describe, expect, it } from 'vitest'

import { lastObservation } from '@/lib/db/last-observation'
import type { SpotPayload } from '@/lib/db/types'

const apy = { base: 0.05, rewards: 0, fees: 0.01, net: 0.04, rewardItems: [] }

describe('lastObservation', () => {
  it('carries the supply state and leaves the borrow columns null', () => {
    const p: SpotPayload = {
      productId: 'aave:v3:ethereum:reserve:0xa0b8:supply',
      kind: 'supply',
      protocol: 'aave',
      chainId: 1,
      asset: 'USDC',
      apy,
      market: {
        supplyAssets: 1_000,
        supplyAssetsUsd: 1_000_000,
        utilizationRate: 0.8,
        assetPriceUsd: 1,
      },
    }

    expect(lastObservation(p)).toEqual({
      supplyAssets: 1_000,
      supplyAssetsUsd: 1_000_000,
      borrowAssets: null,
      borrowAssetsUsd: null,
      collateralAssetsUsd: null,
      utilizationRate: 0.8,
      assetPriceUsd: 1,
    })
  })

  it('carries the full borrow state on a borrow payload', () => {
    const p: SpotPayload = {
      productId: 'morpho:v1:ethereum:market:0xdead:borrow',
      kind: 'borrow',
      protocol: 'morpho',
      chainId: 1,
      asset: 'USDC',
      apy,
      market: {
        supplyAssets: 1_000,
        supplyAssetsUsd: 1_000_000,
        borrowAssets: 600,
        borrowAssetsUsd: 600_000,
        utilizationRate: 0.6,
        assetPriceUsd: 1,
        collateralAssetsUsd: 2_000_000,
        priceCollateralInLoanAsset: 3_400,
      },
    }

    expect(lastObservation(p)).toEqual({
      supplyAssets: 1_000,
      supplyAssetsUsd: 1_000_000,
      borrowAssets: 600,
      borrowAssetsUsd: 600_000,
      collateralAssetsUsd: 2_000_000,
      utilizationRate: 0.6,
      assetPriceUsd: 1,
    })
  })

  it('renders an unknown amount as null rather than zero — a zero is a claim', () => {
    const p: SpotPayload = {
      productId: 'morpho:v1:ethereum:vault:0xbeef:supply',
      kind: 'supply',
      protocol: 'morpho',
      chainId: 1,
      asset: 'WETH',
      apy,
      market: {
        supplyAssets: null,
        supplyAssetsUsd: null,
        utilizationRate: null,
        assetPriceUsd: null,
      },
    }

    expect(lastObservation(p)).toEqual({
      supplyAssets: null,
      supplyAssetsUsd: null,
      borrowAssets: null,
      borrowAssetsUsd: null,
      collateralAssetsUsd: null,
      utilizationRate: null,
      assetPriceUsd: null,
    })
  })
})
