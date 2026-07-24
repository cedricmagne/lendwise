import { describe, expect, it } from 'vitest'

import { groupGapsByProvider } from '@/lib/heal/gap-spans'

const AAVE = 'aave:v3:ethereum:reserve:0xa:supply'
const MORPHO = 'morpho:v1:base:market:0xm:supply'
const COMPOUND = 'compound:v3:ethereum:market:0xc:supply'

const providerOf = new Map([
  [AAVE, 'aave'],
  [MORPHO, 'morpho'],
  [COMPOUND, 'compound'],
])

const hours = (iso: string) => new Date(iso).getTime()

describe('groupGapsByProvider', () => {
  it('gives each provider its own span instead of the report-wide one', () => {
    // The regression this guards: one stale Aave gap used to widen every other
    // provider's refetch window to a week.
    const { spanByProvider, globalSpan } = groupGapsByProvider(
      [
        { productId: AAVE, hour: '2026-07-17T04:00:00.000Z' },
        { productId: MORPHO, hour: '2026-07-24T09:00:00.000Z' },
        { productId: MORPHO, hour: '2026-07-24T11:00:00.000Z' },
      ],
      providerOf
    )

    expect(spanByProvider.get('aave')).toEqual({
      min: hours('2026-07-17T04:00:00.000Z'),
      max: hours('2026-07-17T04:00:00.000Z'),
    })
    // 2 hours wide, NOT the 7 days separating it from the Aave hole.
    expect(spanByProvider.get('morpho')).toEqual({
      min: hours('2026-07-24T09:00:00.000Z'),
      max: hours('2026-07-24T11:00:00.000Z'),
    })
    // The donor query still needs the whole report.
    expect(globalSpan).toEqual({
      min: hours('2026-07-17T04:00:00.000Z'),
      max: hours('2026-07-24T11:00:00.000Z'),
    })
  })

  it('buckets every entry under its provider', () => {
    const { gapsByProvider } = groupGapsByProvider(
      [
        { productId: AAVE, hour: '2026-07-24T01:00:00.000Z' },
        { productId: COMPOUND, hour: '2026-07-24T02:00:00.000Z' },
        { productId: COMPOUND, hour: '2026-07-24T03:00:00.000Z' },
      ],
      providerOf
    )

    expect([...gapsByProvider.keys()].sort()).toEqual(['aave', 'compound'])
    expect(gapsByProvider.get('compound')).toHaveLength(2)
    expect(gapsByProvider.get('aave')?.[0].hour).toBeInstanceOf(Date)
  })

  it("files an unresolvable productId under 'unknown' rather than dropping it", () => {
    const { gapsByProvider, spanByProvider } = groupGapsByProvider(
      [{ productId: 'ghost:v1:x:y:supply', hour: '2026-07-24T01:00:00.000Z' }],
      providerOf
    )

    // No adapter claims 'unknown', so the entry falls through to the donor
    // phase — visible and healable, never silently discarded.
    expect(gapsByProvider.get('unknown')).toHaveLength(1)
    expect(spanByProvider.has('unknown')).toBe(true)
  })

  it('handles a single gap (span of zero width)', () => {
    const t = hours('2026-07-24T01:00:00.000Z')
    const { spanByProvider, globalSpan } = groupGapsByProvider(
      [{ productId: AAVE, hour: '2026-07-24T01:00:00.000Z' }],
      providerOf
    )

    expect(spanByProvider.get('aave')).toEqual({ min: t, max: t })
    expect(globalSpan).toEqual({ min: t, max: t })
  })

  it('is order-independent', () => {
    const entries = [
      { productId: AAVE, hour: '2026-07-24T05:00:00.000Z' },
      { productId: AAVE, hour: '2026-07-24T01:00:00.000Z' },
      { productId: AAVE, hour: '2026-07-24T03:00:00.000Z' },
    ]
    const forward = groupGapsByProvider(entries, providerOf)
    const backward = groupGapsByProvider([...entries].reverse(), providerOf)

    expect(forward.spanByProvider.get('aave')).toEqual(
      backward.spanByProvider.get('aave')
    )
    expect(forward.spanByProvider.get('aave')).toEqual({
      min: hours('2026-07-24T01:00:00.000Z'),
      max: hours('2026-07-24T05:00:00.000Z'),
    })
  })
})
