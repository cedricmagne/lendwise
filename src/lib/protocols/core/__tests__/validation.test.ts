import { describe, expect, it } from 'vitest'

import {
  productStrictSchema,
  spotPayloadSoftSchema,
  spotPayloadStrictSchema,
} from '@/lib/protocols/core/validation'

const payload = {
  productId: 'aave:v3:ethereum:reserve:0xabc:supply',
  kind: 'supply',
  protocol: 'aave',
  chainId: 1,
  asset: 'USDC',
  apy: { base: 0.03, rewards: 0.01, fees: 0, net: 0.04, rewardItems: [] },
  market: {
    supplyAssets: 1,
    supplyAssetsUsd: 1,
    utilizationRate: 0,
    assetPriceUsd: 1,
  },
}

describe('spot payload validation', () => {
  it('soft: accepts a finite extreme rate (ingestion never drops finite data)', () => {
    const extreme = {
      ...payload,
      apy: { ...payload.apy, base: 2979.95, net: 2979.95 },
    }
    expect(spotPayloadSoftSchema.safeParse(extreme).success).toBe(true)
  })

  it('soft: rejects non-finite components and empty productId', () => {
    const nan = { ...payload, apy: { ...payload.apy, net: NaN } }
    expect(spotPayloadSoftSchema.safeParse(nan).success).toBe(false)
    expect(
      spotPayloadSoftSchema.safeParse({ ...payload, productId: '' }).success
    ).toBe(false)
  })

  it('strict: additionally bounds |net| < 10 and requires a known chainId', () => {
    const strict = spotPayloadStrictSchema([1, 137])
    expect(strict.safeParse(payload).success).toBe(true)
    const spike = { ...payload, apy: { ...payload.apy, net: 12 } }
    expect(strict.safeParse(spike).success).toBe(false)
    const wrongChain = { ...payload, chainId: 999 }
    expect(strict.safeParse(wrongChain).success).toBe(false)
  })

  it('strict: exempts drained markets (utilization ~1) from the magnitude bound', () => {
    const strict = spotPayloadStrictSchema([1])
    const spike = { base: 2979.95, net: 2979.95 }
    const at = (utilizationRate: number) => ({
      ...payload,
      apy: { ...payload.apy, ...spike },
      market: { ...payload.market, utilizationRate },
    })
    expect(strict.safeParse(at(1)).success).toBe(true)
    // Live drained Morpho markets report 0.9999997…, not exactly 1.
    expect(strict.safeParse(at(0.9999997544547339)).success).toBe(true)
    // A spike on a market with real liquidity left is still a failure.
    expect(strict.safeParse(at(0.95)).success).toBe(false)
  })
})

// Added beyond the brief: guards the field-name correction. The DB `SupplyProduct`
// nests provider/version/name under `protocol` (see src/lib/db/types.ts), and its
// native `protocol.name` ("AaveV3Ethereum") is NOT the adapter registry id
// ("aave_v3"), so the schema must accept a real product without binding name to id.
describe('product strict validation', () => {
  const adapter = { id: 'aave_v3', provider: 'aave', version: 'v3' }
  const product = {
    _id: 'aave:v3:ethereum:reserve:0xabc:supply',
    kind: 'supply',
    active: true,
    asset: { symbol: 'USDC', name: 'USD Coin', address: '0xabc', decimals: 6 },
    protocol: {
      provider: 'aave',
      type: 'reserve',
      version: 'v3',
      name: 'AaveV3Ethereum',
      subgraphUrl: 'https://example.com',
      chain: { id: 1, name: 'ethereum' },
      address: '0xpool',
      meta: {},
    },
  }

  it('accepts a real nested product whose provider/version match the adapter', () => {
    expect(productStrictSchema(adapter).safeParse(product).success).toBe(true)
  })

  it('rejects a provider that disagrees with the adapter', () => {
    const wrong = {
      ...product,
      protocol: { ...product.protocol, provider: 'morpho' },
    }
    expect(productStrictSchema(adapter).safeParse(wrong).success).toBe(false)
  })
})
