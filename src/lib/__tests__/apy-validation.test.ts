import { describe, expect, it } from 'vitest'

import { isFiniteApyBlock } from '@/lib/apy-validation'

describe('isFiniteApyBlock', () => {
  it('keeps a finite but absurd rate — it is what the API returned', () => {
    // 2979.96 = 297,996% APY. Real value, really returned by Morpho for an empty
    // market. Ingestion stores it; hiding it is the read side's job.
    expect(
      isFiniteApyBlock({ base: 2979.96, rewards: 0, fees: 0, net: 2979.96 })
    ).toBe(true)
    expect(
      isFiniteApyBlock({ base: -13_000, rewards: 0, fees: 0, net: -13_000 })
    ).toBe(true)
  })

  it('keeps ordinary rates and zero', () => {
    expect(
      isFiniteApyBlock({ base: 0.05, rewards: 0.01, fees: 0.002, net: 0.058 })
    ).toBe(true)
    expect(isFiniteApyBlock({ base: 0, rewards: 0, fees: 0, net: 0 })).toBe(
      true
    )
  })

  it('rejects a non-finite component, whichever one it is', () => {
    expect(isFiniteApyBlock({ base: NaN, rewards: 0, fees: 0, net: 0 })).toBe(
      false
    )
    expect(
      isFiniteApyBlock({ base: 0, rewards: Infinity, fees: 0, net: 0 })
    ).toBe(false)
    expect(
      isFiniteApyBlock({ base: 0, rewards: 0, fees: -Infinity, net: 0 })
    ).toBe(false)
    expect(isFiniteApyBlock({ base: 0, rewards: 0, fees: 0, net: NaN })).toBe(
      false
    )
  })
})
