import { describe, expect, it } from 'vitest'

import type { CatalogueRow } from '@/lib/db/types'
import {
  liquidity,
  networkSlug,
  poolIdentity,
  poolName,
  productLink,
  toBorrowProduct,
  toRawUnits,
  toSupplyProduct,
} from '@/lib/products/from-catalogue'

const now = new Date('2026-07-27T14:00:00Z')

/**
 * A catalogue row. `provider` AND `version` both matter: presentation is looked
 * up by adapter id (`${provider}_${version}`), so a Morpho fixture must say
 * `version: 'v1'` — `morpho_v3` registers nothing and would silently render
 * with the defaults.
 */
function row(
  product: Partial<CatalogueRow['product']>,
  observation: Partial<CatalogueRow> = {}
): CatalogueRow {
  return {
    product: {
      id: 'x',
      active: true,
      kind: 'supply',
      provider: 'aave',
      productType: 'reserve',
      version: 'v3',
      protocolName: 'AaveV3Ethereum',
      chainId: 1,
      chainName: 'Ethereum',
      assetSymbol: 'USDC',
      assetName: 'USD Coin',
      assetAddress: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
      assetDecimals: 6,
      protocolAddress: '0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2',
      subgraphUrl: null,
      meta: {},
      collaterals: null,
      createdAt: now,
      updatedAt: now,
      ...product,
    },
    hour: now,
    apyNet: 0.042,
    apyRewards: 0.002,
    supplyAssets: 1_000_000,
    supplyAssetsUsd: 1_000_000,
    borrowAssets: null,
    borrowAssetsUsd: null,
    collateralAssetsUsd: null,
    utilizationRate: 0.8,
    assetPriceUsd: 1,
    ...observation,
  }
}

describe('networkSlug', () => {
  it('derives the slug from chainId for Morpho and Compound', () => {
    expect(
      networkSlug(
        row({ provider: 'morpho', version: 'v1', chainId: 8453 }).product
      )
    ).toBe('base')
  })

  it('derives the slug from the market name for Aave — Lido is a "chain" in the UI', () => {
    expect(
      networkSlug(row({ protocolName: 'AaveV3EthereumLido' }).product)
    ).toBe('lido')
    expect(networkSlug(row({ protocolName: 'AaveV3Polygon' }).product)).toBe(
      'polygon'
    )
  })
})

describe('poolName', () => {
  it('takes the vault name for a Morpho supply product', () => {
    expect(
      poolName(
        row({
          provider: 'morpho',
          version: 'v1',
          productType: 'vault',
          meta: { name: 'Steakhouse USDC' },
        }).product
      )
    ).toBe('Steakhouse USDC')
  })

  it('composes loan/collateral for a Morpho borrow product', () => {
    expect(
      poolName(
        row({
          provider: 'morpho',
          version: 'v1',
          kind: 'borrow',
          collaterals: [{ symbol: 'wstETH' }],
        }).product
      )
    ).toBe('USDC/wstETH')
  })

  it('takes the asset name for Aave and Compound', () => {
    expect(poolName(row({}).product)).toBe('USD Coin')
    expect(poolName(row({ provider: 'compound' }).product)).toBe('USD Coin')
  })
})

describe('productLink', () => {
  it('reproduces the Aave link', () => {
    expect(productLink(row({}).product)).toBe(
      'https://app.aave.com/reserve-overview/?underlyingAsset=0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48&marketName=proto_ethereum_v3'
    )
  })

  it('reproduces the Compound link', () => {
    expect(
      productLink(row({ provider: 'compound', chainId: 8453 }).product)
    ).toBe('https://app.compound.finance/?market=usdc-base')
  })

  it('reproduces the Morpho vault link', () => {
    expect(
      productLink(
        row({
          provider: 'morpho',
          version: 'v1',
          productType: 'vault',
          chainId: 8453,
          chainName: 'Base',
          protocolAddress: '0xBeeF',
          meta: { name: 'Steakhouse USDC' },
        }).product
      )
    ).toBe('https://app.morpho.org/base/vault/0xBeeF/steakhouse-usdc')
  })

  // Task 6 parity: `chain_name` holds a display name — sometimes with a
  // space — which breaks a URL built from it. The link must derive from
  // chainId (`chainIdSlug()`), never from `chainName`. Cases measured in the
  // catalogue: chain_id 196 → "X Layer" (Aave, 9 active products), 10 →
  // "op mainnet" and 42161 → "arbitrum one" (Morpho, 5 active products) — all
  // broken before the fix.
  it('stays correct when chain_name has a space — Aave X Layer', () => {
    expect(
      productLink(
        row({
          protocolName: 'AaveV3XLayer',
          chainId: 196,
          chainName: 'X Layer',
          assetAddress: '0xE538905cf8410324e03A5A23C1c177a474D59b2b',
        }).product
      )
    ).toBe(
      'https://app.aave.com/reserve-overview/?underlyingAsset=0xe538905cf8410324e03a5a23c1c177a474d59b2b&marketName=proto_xlayer_v3'
    )
  })

  it('stays correct when chain_name has a space — Morpho vault Optimism ("op mainnet")', () => {
    expect(
      productLink(
        row({
          provider: 'morpho',
          version: 'v1',
          productType: 'vault',
          chainId: 10,
          chainName: 'op mainnet',
          protocolAddress: '0xC30ce6A5758786e0F640cC5f881Dd96e9a1C5C59',
          meta: { name: 'Gauntlet USDC Prime' },
        }).product
      )
    ).toBe(
      'https://app.morpho.org/optimism/vault/0xC30ce6A5758786e0F640cC5f881Dd96e9a1C5C59/gauntlet-usdc-prime'
    )
  })

  it('stays correct when chain_name has a space — Morpho vault Arbitrum ("arbitrum one")', () => {
    expect(
      productLink(
        row({
          provider: 'morpho',
          version: 'v1',
          productType: 'vault',
          chainId: 42161,
          chainName: 'arbitrum one',
          protocolAddress: '0x7e97fa6893871A2751B5fE961978DCCb2c201E65',
          meta: { name: 'Gauntlet USDC Core' },
        }).product
      )
    ).toBe(
      'https://app.morpho.org/arbitrum/vault/0x7e97fa6893871A2751B5fE961978DCCb2c201E65/gauntlet-usdc-core'
    )
  })

  // Task 6 review fix: a chainId absent from CHAIN_SLUG_MAP (a new market
  // added to an adapter before it's registered in chain-slugs.ts) must not
  // crash the whole /supply load for one missing — decorative — link.
  // `productLink()` degrades to '' rather than re-throwing `chainIdSlug()`'s
  // exception.
  it('degrades to an empty link rather than throwing, when chainId is unregistered — Aave', () => {
    expect(
      productLink(
        row({
          chainId: 999_999_999,
          chainName: 'Unregistered Chain',
        }).product
      )
    ).toBe('')
  })

  it('degrades to an empty link rather than throwing, when chainId is unregistered — Morpho', () => {
    expect(
      productLink(
        row({
          provider: 'morpho',
          version: 'v1',
          productType: 'vault',
          chainId: 999_999_999,
          chainName: 'Unregistered Chain',
          protocolAddress: '0xBeeF',
          meta: { name: 'Steakhouse USDC' },
        }).product
      )
    ).toBe('')
  })
})

/**
 * A protocol that registers no presentation fragment — an adapter id absent
 * from `PROTOCOLS_PRESENTATION`, which is also what a FORGOTTEN registration
 * looks like. It must render, not crash: default label, default identity, no
 * link. The one exception is `network`, a required field of the table, where an
 * unregistered chain is a configuration bug and must surface loudly.
 */
describe('a protocol with no presentation fragment', () => {
  const unknown = () =>
    row({ provider: 'newproto', version: 'v9', protocolAddress: '0xPool' })
      .product

  it('names the pool after its asset', () => {
    expect(poolName(unknown())).toBe('USD Coin')
  })

  it('identifies the pool by its protocol address, twice', () => {
    expect(poolIdentity(unknown())).toEqual({
      poolId: '0xPool',
      poolAddress: '0xPool',
    })
  })

  it('renders no link', () => {
    expect(productLink(unknown())).toBe('')
  })

  it('still derives the network from chainId', () => {
    expect(networkSlug(unknown())).toBe('ethereum')
  })

  it('throws on an unregistered chainId — network is a required field', () => {
    expect(() =>
      networkSlug(
        row({ provider: 'newproto', version: 'v9', chainId: 999_999_999 })
          .product
      )
    ).toThrow(/No slug registered for chainId 999999999/)
  })
})

describe('toRawUnits', () => {
  it('converts whole tokens back into raw units', () => {
    expect(toRawUnits(1_000, 6)).toBe('1000000000')
  })

  it('returns "0" for an unknown amount', () => {
    expect(toRawUnits(null, 18)).toBe('0')
  })
})

describe('liquidity', () => {
  it('is the unborrowed share — one formula for all three providers', () => {
    expect(liquidity(1_000, 0.25)).toBe(750)
  })

  it('equals the full deposit when utilization is unknown', () => {
    expect(liquidity(1_000, null)).toBe(1_000)
  })

  it('is 0 when the deposit is unknown', () => {
    expect(liquidity(null, 0.5)).toBe(0)
  })
})

describe('toSupplyProduct', () => {
  it('fills the table type without borrowing anything from an adapter', () => {
    const p = toSupplyProduct(row({}), {
      apyDaily: 0.041,
      apyMonthly: 0.039,
      apyYearly: 0.037,
      apyRewardsDaily: 0.002,
      apyRewardsMonthly: 0.002,
      apyRewardsYearly: 0.001,
    })

    expect(p.protocol).toBe('aave_v3')
    expect(p.network).toBe('ethereum')
    expect(p.productId).toBe('x')
    expect(p.apy).toBe(0.042)
    expect(p.apyRewards).toBe(0.002)
    expect(p.apyMonthly).toBe(0.039)
    expect(p.assetAmountUsd).toBe(1_000_000)
    expect(p.assetAmount).toBe('1000000000000')
    // 1,000,000 deposited, 80% utilized → 200,000 available.
    expect(p.liquidityAmountUsd).toBe(200_000)
    expect(p.liquidityAmount).toBe('200000000000')
  })

  it('never invents a rate: APY always comes from the observation', () => {
    const p = toSupplyProduct(row({}, { apyNet: -0.01 }))
    expect(p.apy).toBe(-0.01)
  })

  it('reads the horizon averages off the row when none is passed', () => {
    // `latestForTable` joins them in, so the row IS the enrichment and the
    // caller passes nothing. This is what lets `_loadSupplyProducts` be a
    // single query rather than a read plus an `apyEnrichments` round trip.
    const p = toSupplyProduct(
      row({}, { apyDaily: 0.041, apyMonthly: 0.039, apyYearly: 0.037 })
    )
    expect(p.apyDaily).toBe(0.041)
    expect(p.apyMonthly).toBe(0.039)
    expect(p.apyYearly).toBe(0.037)
  })

  it('lets an explicit enrichment win over the row — table-parity.ts still passes one, comparing a fresh adapter read against a stored row', () => {
    const p = toSupplyProduct(row({}, { apyMonthly: 0.039 }), {
      apyMonthly: 0.011,
    })
    expect(p.apyMonthly).toBe(0.011)
  })

  it('leaves a horizon undefined when the row carries none — the UI shows a dash', () => {
    const p = toSupplyProduct(row({}))
    expect(p.apyDaily).toBeUndefined()
    expect(p.apyMonthly).toBeUndefined()
    expect(p.apyYearly).toBeUndefined()
  })
})

describe('toBorrowProduct', () => {
  const collaterals = [
    {
      symbol: 'wstETH',
      name: 'Wrapped stETH',
      address: '0xCoLLateraL',
      decimals: 18,
      ltv: 0.75,
      lltv: 0.8,
    },
  ]

  it('fills the borrow table type — assetAmount is the market’s total supply, not the amount borrowed, matching every adapter’s borrow-products.ts', () => {
    const p = toBorrowProduct(
      row(
        { kind: 'borrow', provider: 'morpho', version: 'v1', collaterals },
        { apyDaily: 0.041, apyMonthly: 0.039, apyYearly: 0.037 }
      )
    )

    expect(p.protocol).toBe('morpho_v1')
    expect(p.apy).toBe(0.042)
    expect(p.apyMonthly).toBe(0.039)
    // 1,000,000 total supply, 80% utilized → 200,000 still available to borrow.
    expect(p.assetAmountUsd).toBe(1_000_000)
    expect(p.liquidityAmountUsd).toBe(200_000)
    expect(p.collaterals).toEqual([
      {
        address: '0xCoLLateraL',
        symbol: 'wstETH',
        name: 'Wrapped stETH',
        decimals: 18,
        ltv: 0.75,
        lltv: 0.8,
      },
    ])
  })

  it('reports the reward component of the borrow rate, same contract as SupplyProduct', () => {
    // A borrow rate can carry an incentive that offsets its cost — Blend's
    // BLND emissions and Aave's Merit both do this. `row()` defaults
    // apyRewards to 0.002; toBorrowProduct must not drop it the way it used
    // to.
    const p = toBorrowProduct(row({ kind: 'borrow' }), {
      apyDaily: 0.041,
      apyMonthly: 0.039,
      apyYearly: 0.037,
      apyRewardsDaily: 0.003,
      apyRewardsMonthly: 0.002,
      apyRewardsYearly: 0.001,
    })

    expect(p.apyRewards).toBe(0.002)
    expect(p.apyRewardsDaily).toBe(0.003)
    expect(p.apyRewardsMonthly).toBe(0.002)
    expect(p.apyRewardsYearly).toBe(0.001)
  })

  it('reports 0, never undefined, on a measured row without borrow-side rewards — the vast majority of markets today', () => {
    const p = toBorrowProduct(row({ kind: 'borrow' }, { apyRewards: 0 }))
    expect(p.apyRewards).toBe(0)
  })

  it('renders an empty collateral list rather than throwing when the column is null', () => {
    const p = toBorrowProduct(row({ kind: 'borrow', collaterals: null }))
    expect(p.collaterals).toEqual([])
  })

  it('composes the Morpho borrow pool name from loan/collateral, same as poolName()', () => {
    const p = toBorrowProduct(
      row({
        kind: 'borrow',
        provider: 'morpho',
        version: 'v1',
        assetSymbol: 'USDC',
        collaterals,
      })
    )
    expect(p.poolName).toBe('USDC/wstETH')
  })
})
