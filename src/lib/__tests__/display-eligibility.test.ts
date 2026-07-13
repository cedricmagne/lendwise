import { describe, expect, it } from 'vitest'

import {
  DISPLAY_POLICY,
  type Observation,
  decideFlag,
  ineligibilityReason,
} from '@/lib/display-eligibility'

/** A healthy market: $5M TVL, 5% net. */
const ok: Observation = { tvlUsd: 5_000_000, apyNet: 0.05 }

describe('ineligibilityReason', () => {
  it('accepts a real market', () => {
    expect(ineligibilityReason(ok)).toBeNull()
    // Exactly at the floor is in — the floor is a minimum, not an exclusion.
    expect(
      ineligibilityReason({ tvlUsd: DISPLAY_POLICY.minTvlUsd, apyNet: 0.05 })
    ).toBeNull()
    // 1000% exactly is in; the rule is strictly-greater.
    expect(ineligibilityReason({ tvlUsd: 5_000_000, apyNet: 10 })).toBeNull()
  })

  it('rejects an empty market whatever it quotes', () => {
    // The pool that started all this: TVL $0, utilisation 0, quoting 297,996%.
    expect(ineligibilityReason({ tvlUsd: 0, apyNet: 2979.96 })).toBe(
      'empty_market'
    )
    // And the case magnitude alone would have missed: dead pool, plausible rate.
    expect(ineligibilityReason({ tvlUsd: 0, apyNet: 0.08 })).toBe(
      'empty_market'
    )
    expect(ineligibilityReason({ tvlUsd: 519.75, apyNet: 0.043 })).toBe(
      'empty_market'
    )
  })

  it('treats unknown liquidity as empty, not as passing', () => {
    expect(ineligibilityReason({ tvlUsd: null, apyNet: 0.05 })).toBe(
      'empty_market'
    )
  })

  it('reports the empty market as the cause when a pool is both', () => {
    // Both rules fire; the empty market is the root cause, the rate its symptom.
    expect(ineligibilityReason({ tvlUsd: 0, apyNet: 2979.96 })).toBe(
      'empty_market'
    )
  })

  it('rejects an absurd rate on a pool that does have liquidity', () => {
    expect(ineligibilityReason({ tvlUsd: 22_000_000, apyNet: 11 })).toBe(
      'outlier_apy'
    )
    expect(ineligibilityReason({ tvlUsd: 22_000_000, apyNet: -11 })).toBe(
      'outlier_apy'
    )
    expect(ineligibilityReason({ tvlUsd: 22_000_000, apyNet: NaN })).toBe(
      'outlier_apy'
    )
  })
})

describe('decideFlag', () => {
  const bad: Observation = { tvlUsd: 0, apyNet: 2979.96 }

  it('hides a pool only after 3 consecutive bad hours', () => {
    expect(
      decideFlag({ currentlyFlagged: false, recent: [bad, bad, bad] })
    ).toBe('flag')
    expect(
      decideFlag({ currentlyFlagged: false, recent: [bad, ok, bad] })
    ).toBe('unchanged')
  })

  it('does not hide a pool for want of data — a pipeline outage is not evidence', () => {
    expect(decideFlag({ currentlyFlagged: false, recent: [bad, bad] })).toBe(
      'unchanged'
    )
    expect(decideFlag({ currentlyFlagged: false, recent: [] })).toBe(
      'unchanged'
    )
  })

  it('restores a pool only after 12 consecutive good hours', () => {
    const twelve = Array.from({ length: 12 }, () => ok)
    expect(decideFlag({ currentlyFlagged: true, recent: twelve })).toBe('clear')
    // One bad hour anywhere in the window keeps it hidden.
    expect(
      decideFlag({
        currentlyFlagged: true,
        recent: [...twelve.slice(0, 11), bad],
      })
    ).toBe('unchanged')
    // Eleven good hours are not twelve.
    expect(
      decideFlag({ currentlyFlagged: true, recent: twelve.slice(0, 11) })
    ).toBe('unchanged')
  })

  it('is asymmetric: one good hour cannot undo a hidden pool', () => {
    expect(decideFlag({ currentlyFlagged: true, recent: [ok] })).toBe(
      'unchanged'
    )
    expect(
      decideFlag({ currentlyFlagged: true, recent: [ok, ok, ok, ok, ok] })
    ).toBe('unchanged')
  })

  it('ignores observations beyond the decision window', () => {
    // Rows 4+ are irrelevant when deciding to flag: only the newest 3 count.
    expect(
      decideFlag({ currentlyFlagged: false, recent: [bad, bad, bad, ok, ok] })
    ).toBe('flag')
  })
})
