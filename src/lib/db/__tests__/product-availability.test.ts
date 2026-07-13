import { describe, expect, it } from 'vitest'

import {
  type ProductAvailabilityPeriod,
  isProductExpectedAt,
} from '@/lib/db/product-availability'

const at = (iso: string) => new Date(iso)

describe('isProductExpectedAt', () => {
  /** Listed 10:00, delisted after its 14:00 observation, relisted 18:00. */
  const periods: ProductAvailabilityPeriod[] = [
    {
      activatedAt: at('2026-07-13T10:00:00.000Z'),
      deactivatedAt: at('2026-07-13T15:00:00.000Z'),
    },
    {
      activatedAt: at('2026-07-13T18:00:00.000Z'),
      deactivatedAt: null,
    },
  ]

  it('expects the hour of the last observation, but not the one after it', () => {
    // The 14:00 slot has real data and must still count toward completeness.
    expect(isProductExpectedAt(periods, at('2026-07-13T14:00:00.000Z'))).toBe(
      true
    )
    // 15:00 is when the market stopped existing. Not a gap — nothing was owed.
    expect(isProductExpectedAt(periods, at('2026-07-13T15:00:00.000Z'))).toBe(
      false
    )
  })

  it('keeps two cycles distinct instead of collapsing them into one', () => {
    expect(isProductExpectedAt(periods, at('2026-07-13T09:00:00.000Z'))).toBe(
      false
    )
    expect(isProductExpectedAt(periods, at('2026-07-13T10:00:00.000Z'))).toBe(
      true
    )
    // The dead stretch between the two listings.
    expect(isProductExpectedAt(periods, at('2026-07-13T16:00:00.000Z'))).toBe(
      false
    )
    expect(isProductExpectedAt(periods, at('2026-07-13T17:00:00.000Z'))).toBe(
      false
    )
    expect(isProductExpectedAt(periods, at('2026-07-13T18:00:00.000Z'))).toBe(
      true
    )
  })

  it('expects every hour from an open period onward', () => {
    expect(isProductExpectedAt(periods, at('2026-07-14T04:00:00.000Z'))).toBe(
      true
    )
    expect(isProductExpectedAt(periods, at('2027-01-01T00:00:00.000Z'))).toBe(
      true
    )
  })

  it('expects nothing from a product that was never listed', () => {
    expect(isProductExpectedAt([], at('2026-07-13T12:00:00.000Z'))).toBe(false)
  })
})
