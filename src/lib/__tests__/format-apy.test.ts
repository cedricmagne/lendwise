import { describe, expect, it } from 'vitest'

import { formatApy } from '@/lib/product-stats'

/**
 * A borrow market whose rewards outrun its base rate has a NEGATIVE net APY —
 * the market pays you to borrow. Real case, measured 2026-07-26 on
 * `morpho:v1:base:market:0x67a6…b538:borrow`: base 4.08%, rewards 5.19%, net
 * -1.10%.
 *
 * The tables clamped with a bare `value < 0.0001`, which is true of EVERY
 * negative, so -1.10% rendered as "<0.01%" — a rate that pays the user, shown
 * as a rate too small to matter.
 */
describe('formatApy', () => {
  it('shows a negative rate at its real value', () => {
    expect(formatApy(-0.011049215723269907)).toBe('-1.10%')
  })

  it('reads a near-zero negative as ABOVE the threshold, not below it', () => {
    // "<-0.01%" would claim the value is smaller than -0.01%, which is the
    // opposite of true: -0.00005 sits between -0.01% and zero. A clamp must
    // not assert the wrong side of its own bound.
    expect(formatApy(-0.00005)).toBe('>-0.01%')
  })

  it('never labels a negative rate with the positive clamp', () => {
    expect(formatApy(-0.00005)).not.toBe('<0.01%')
  })

  it('keeps the positive clamp for a near-zero positive', () => {
    expect(formatApy(0.00005)).toBe('<0.01%')
  })

  it('clamps an absurd negative the way it clamps an absurd positive', () => {
    expect(formatApy(-15)).toBe('<-1000%')
    expect(formatApy(15)).toBe('>1000%')
  })

  it('renders ordinary rates unchanged', () => {
    expect(formatApy(0.0425)).toBe('4.25%')
    expect(formatApy(-0.0425)).toBe('-4.25%')
  })

  it('has nothing to say about a missing rate', () => {
    expect(formatApy(undefined)).toBe('-')
    expect(formatApy(null)).toBe('-')
    expect(formatApy(Number.NaN)).toBe('-')
  })
})
