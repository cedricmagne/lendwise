import { describe, expect, it } from 'vitest'

import { formatUpdatedAgo } from '../format-relative-time'

describe('formatUpdatedAgo', () => {
  const now = 1_753_257_600_000

  it('returns <1m ago under one minute', () => {
    expect(formatUpdatedAgo(now, now)).toBe('<1m ago')
    expect(formatUpdatedAgo(now - 59_000, now)).toBe('<1m ago')
  })

  it('returns whole minutes under one hour', () => {
    expect(formatUpdatedAgo(now - 60_000, now)).toBe('1m ago')
    expect(formatUpdatedAgo(now - 35 * 60_000, now)).toBe('35m ago')
    expect(formatUpdatedAgo(now - 59 * 60_000 - 59_000, now)).toBe('59m ago')
  })

  it('returns whole hours from one hour up, without a day unit', () => {
    expect(formatUpdatedAgo(now - 60 * 60_000, now)).toBe('1h ago')
    expect(formatUpdatedAgo(now - 90 * 60_000, now)).toBe('1h ago')
    expect(formatUpdatedAgo(now - 26 * 60 * 60_000, now)).toBe('26h ago')
  })
})
