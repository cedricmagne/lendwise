import { describe, expect, it } from 'vitest'

import type { CollectApyResult } from '@/app/actions/apy-snapshots.actions'
import { spotStatus } from '@/lib/apy-spot-status'

function result(over: Partial<CollectApyResult> = {}): CollectApyResult {
  return {
    success: true,
    counts: { total: 2244 },
    errors: [],
    durationMs: 11_373,
    ...over,
  }
}

describe('spotStatus', () => {
  it('is 200 when every protocol answered', () => {
    expect(spotStatus(result())).toBe(200)
  })

  /**
   * The reason the whole helper exists: 500 here would make QStash retry, and
   * the retry would re-sample the protocols that DID answer — adding a second
   * observation to their running mean for the hour. Reconcile closes the hole
   * tonight instead.
   */
  it('is 207 when some protocols failed but samples were collected', () => {
    expect(
      spotStatus(
        result({
          success: false,
          counts: { aave_v3: 451, total: 451 },
          errors: ['[blend_v2] RPC timeout'],
        })
      )
    ).toBe(207)
  })

  it('is 500 when nothing was collected — a retry has nothing to skew', () => {
    expect(
      spotStatus(
        result({
          success: false,
          counts: { total: 0 },
          errors: ['[aave_v3] 502', '[morpho_v1] 502'],
        })
      )
    ).toBe(500)
  })

  it('is 500 on an empty run with no error reported', () => {
    expect(spotStatus(result({ counts: { total: 0 } }))).toBe(500)
  })
})
