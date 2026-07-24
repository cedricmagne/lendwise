import { describe, expect, it } from 'vitest'

import type { BorrowMarketState, SupplyMarketState } from '@/lib/db/types'
import { mergeMarketStates } from '@/lib/protocols/aave/v3/apy-history'
import {
  type AaveMarketDayState,
  marketDayKey,
} from '@/lib/protocols/aave/v3/market-history'
import type { HistoryDataPoint } from '@/lib/protocols/core/types'

const SUPPLY_ID = 'aave:v3:ethereum:reserve:0xabc:supply'
const BORROW_ID = 'aave:v3:ethereum:reserve:0xabc:borrow'
const DAY = new Date('2026-03-15T00:00:00.000Z')

/** A rate-only point, exactly what the unified API produces. */
function ratePoint(
  productId: string,
  kind: 'supply' | 'borrow',
  timestamp = DAY
): HistoryDataPoint {
  return {
    timestamp,
    productId,
    kind,
    apy: { base: 0.04, rewards: 0, fees: 0, net: 0.04, rewardItems: [] },
    market: {
      supplyAssets: null,
      supplyAssetsUsd: null,
      utilizationRate: null,
      assetPriceUsd: null,
    } as SupplyMarketState,
  }
}

function state(over: Partial<AaveMarketDayState> = {}): AaveMarketDayState {
  return {
    supplyAssets: 1000,
    borrowAssets: 800,
    utilizationRate: 0.8,
    priceUsd: 2,
    carried: false,
    ...over,
  }
}

describe('mergeMarketStates', () => {
  it('fills supply columns and derives USD from the day price', () => {
    const [p] = mergeMarketStates(
      [ratePoint(SUPPLY_ID, 'supply')],
      new Map([[marketDayKey(SUPPLY_ID, DAY), state()]])
    )
    const m = p.market as SupplyMarketState

    expect(m.supplyAssets).toBe(1000)
    expect(m.supplyAssetsUsd).toBe(2000)
    expect(m.utilizationRate).toBe(0.8)
    expect(m.assetPriceUsd).toBe(2)
    // Rates must survive the merge untouched.
    expect(p.apy.net).toBe(0.04)
  })

  it('adds borrow columns only on borrow points', () => {
    const states = new Map([
      [marketDayKey(SUPPLY_ID, DAY), state()],
      [marketDayKey(BORROW_ID, DAY), state()],
    ])
    const [supply, borrow] = mergeMarketStates(
      [ratePoint(SUPPLY_ID, 'supply'), ratePoint(BORROW_ID, 'borrow')],
      states
    )

    expect('borrowAssets' in supply.market).toBe(false)

    const m = borrow.market as BorrowMarketState
    expect(m.borrowAssets).toBe(800)
    expect(m.borrowAssetsUsd).toBe(1600)
    // AAVE is multi-collateral — no single collateral figure exists.
    expect(m.collateralAssetsUsd).toBeNull()
    expect(m.priceCollateralInLoanAsset).toBeNull()
  })

  it('leaves a day with no market state as unknown, never zero', () => {
    const [p] = mergeMarketStates([ratePoint(SUPPLY_ID, 'supply')], new Map())
    const m = p.market as SupplyMarketState

    expect(m.supplyAssets).toBeNull()
    expect(m.utilizationRate).toBeNull()
    expect(m.supplyAssetsUsd).toBeNull()
  })

  it('keeps amounts but no USD when the day has no price', () => {
    const [p] = mergeMarketStates(
      [ratePoint(SUPPLY_ID, 'supply')],
      new Map([[marketDayKey(SUPPLY_ID, DAY), state({ priceUsd: null })]])
    )
    const m = p.market as SupplyMarketState

    expect(m.supplyAssets).toBe(1000)
    expect(m.utilizationRate).toBe(0.8)
    expect(m.assetPriceUsd).toBeNull()
    expect(m.supplyAssetsUsd).toBeNull()
  })

  it('joins on the UTC day, not the exact instant', () => {
    // Rate points land at midnight; subgraph states at the day's last event.
    const lateInDay = new Date('2026-03-15T23:47:11.000Z')
    const [p] = mergeMarketStates(
      [ratePoint(SUPPLY_ID, 'supply', lateInDay)],
      new Map([[marketDayKey(SUPPLY_ID, DAY), state()]])
    )

    expect((p.market as SupplyMarketState).supplyAssets).toBe(1000)
  })

  it('does not match a state from a different day', () => {
    const otherDay = new Date('2026-03-16T00:00:00.000Z')
    const [p] = mergeMarketStates(
      [ratePoint(SUPPLY_ID, 'supply')],
      new Map([[marketDayKey(SUPPLY_ID, otherDay), state()]])
    )

    expect((p.market as SupplyMarketState).supplyAssets).toBeNull()
  })
})
