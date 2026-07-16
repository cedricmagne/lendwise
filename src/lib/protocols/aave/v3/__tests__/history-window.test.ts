import { describe, expect, it } from 'vitest'

import { aaveWindowForRange } from '@/lib/protocols/aave/v3/apy-history'

const now = 1_760_000_000 // any fixed unix-seconds anchor
const h = 3600

describe('aaveWindowForRange', () => {
  it('picks the smallest Aave API window covering the requested lookback', () => {
    expect(aaveWindowForRange(now - 6 * h, now)).toBe('LAST_DAY')
    expect(aaveWindowForRange(now - 24 * h, now)).toBe('LAST_DAY')
    expect(aaveWindowForRange(now - 25 * h, now)).toBe('LAST_WEEK')
    expect(aaveWindowForRange(now - 7 * 24 * h, now)).toBe('LAST_WEEK')
    expect(aaveWindowForRange(now - 8 * 24 * h, now)).toBe('LAST_YEAR')
  })
})
