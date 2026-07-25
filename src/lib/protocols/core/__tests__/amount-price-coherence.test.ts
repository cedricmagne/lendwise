import { describe, expect, it } from 'vitest'

import { spotPayloadStrictSchema } from '@/lib/protocols/core/validation'

/**
 * The invariant: `supply_assets`, `borrow_assets` and `collateral_assets` are
 * ALWAYS in whole token units (raw ÷ 10^decimals). A reader never needs to know
 * the provider to interpret them.
 *
 * It was violated for two of three providers — Compound and Morpho passed their
 * protocols' raw base units through undivided while Aave passed human ones — so
 * one column carried two units with no flag saying which. It stayed invisible
 * because every `*Usd` column was computed by its own adapter and therefore
 * correct. This check is what makes it visible: multiply the amount by the price
 * and see whether the USD value agrees.
 */

const schema = spotPayloadStrictSchema([1])

function payload(market: Record<string, unknown>) {
  return {
    productId: 'x:v1:ethereum:market:0xabc:supply',
    kind: 'supply' as const,
    protocol: 'x_v1',
    chainId: 1,
    asset: 'USDC',
    apy: { base: 0.05, rewards: 0, fees: 0, net: 0.05, rewardItems: [] },
    market,
  }
}

describe('amount × price coherence (strict schema)', () => {
  it('accepts whole-token amounts', () => {
    // 5.2M USDC at $1 → $5.2M.
    const result = schema.safeParse(
      payload({
        supplyAssets: 5_208_000,
        assetPriceUsd: 0.9999,
        supplyAssetsUsd: 5_207_479,
        utilizationRate: 0.7,
      })
    )

    expect(result.success).toBe(true)
  })

  it('rejects raw base units — the Compound and Morpho bug', () => {
    // Same market, amount left in 6-decimal base units: 1e6 times too large.
    const result = schema.safeParse(
      payload({
        supplyAssets: 5_208_000_000_000,
        assetPriceUsd: 0.9999,
        supplyAssetsUsd: 5_207_479,
        utilizationRate: 0.7,
      })
    )

    expect(result.success).toBe(false)
    expect(JSON.stringify(result.error?.issues)).toContain('WHOLE TOKEN units')
  })

  it('rejects a price derived from a raw amount — the Morpho price bug', () => {
    // assetPriceUsd = totalAssetsUsd / totalAssets with a RAW denominator puts
    // WETH at ~1.9e-15 instead of ~1900.
    const result = schema.safeParse(
      payload({
        supplyAssets: 628.6,
        assetPriceUsd: 1.92e-15,
        supplyAssetsUsd: 1_205_000,
        utilizationRate: 0.7,
      })
    )

    expect(result.success).toBe(false)
  })

  it('catches the REAL Morpho row, where both errors cancel', () => {
    // The live-DB shape: RAW amount (10^18 too large) AND derived price (10^18
    // too small). `amount × price ≈ amountUsd` PASSES — the coherence checks are
    // blind here. Only the absolute price floor sees it.
    const result = schema.safeParse(
      payload({
        supplyAssets: 5.0e19, // raw WETH
        assetPriceUsd: 1.87e-15, // derived-from-raw
        supplyAssetsUsd: 93_876,
        utilizationRate: 0.7,
      })
    )

    expect(result.success).toBe(false)
    expect(JSON.stringify(result.error?.issues)).toContain('1e-6')
  })

  it('catches a 6-decimal stablecoin row, where the broken price is only ~1e-6', () => {
    // The shallowest case: raw USDC amount (10^6 too large) and a derived price
    // of ~1e-6. A 1e-9 floor would have waved it through — hence 1e-6.
    const result = schema.safeParse(
      payload({
        supplyAssets: 5.68e12, // raw USDC
        assetPriceUsd: 9.99e-7,
        supplyAssetsUsd: 5_683_390,
        utilizationRate: 0.7,
      })
    )

    expect(result.success).toBe(false)
  })

  it('accepts a genuinely cheap asset above the floor', () => {
    // A $0.0005 token is real and must not trip the floor.
    const result = schema.safeParse(
      payload({
        supplyAssets: 2_000_000,
        assetPriceUsd: 0.0005,
        supplyAssetsUsd: 1_000,
        utilizationRate: 0.7,
      })
    )

    expect(result.success).toBe(true)
  })

  it('checks the borrow side too', () => {
    const result = schema.safeParse({
      ...payload({
        borrowAssets: 500_000_000_000,
        assetPriceUsd: 1,
        borrowAssetsUsd: 500_000,
        utilizationRate: 0.7,
      }),
      kind: 'borrow' as const,
    })

    expect(result.success).toBe(false)
  })

  it('stays silent when the price is unknown', () => {
    // NULL means unknown, and an absent value is never a failure. A protocol
    // that publishes amounts but no price must not be rejected for it.
    const result = schema.safeParse(
      payload({
        supplyAssets: 5_208_000_000_000,
        assetPriceUsd: null,
        supplyAssetsUsd: null,
        utilizationRate: 0.7,
      })
    )

    expect(result.success).toBe(true)
  })

  it('stays silent on an empty market', () => {
    const result = schema.safeParse(
      payload({
        supplyAssets: 0,
        assetPriceUsd: 1,
        supplyAssetsUsd: 0,
        utilizationRate: 0,
      })
    )

    expect(result.success).toBe(true)
  })

  it('tolerates a stale price without flagging it', () => {
    // 3% off — a mid-slot balance change or a slightly stale oracle read.
    const result = schema.safeParse(
      payload({
        supplyAssets: 1_000,
        assetPriceUsd: 1_000,
        supplyAssetsUsd: 1_030_000,
        utilizationRate: 0.7,
      })
    )

    expect(result.success).toBe(true)
  })
})
