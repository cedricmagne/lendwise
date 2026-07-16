import { describe, expect, it } from 'vitest'

import { defineYieldAdapter } from '@/lib/protocols/core/define'
import type { YieldAdapter } from '@/lib/protocols/core/types'

describe('defineYieldAdapter', () => {
  it('returns the adapter unchanged (typed identity)', () => {
    const adapter: YieldAdapter = {
      id: 'test_v1',
      name: 'Test v1',
      provider: 'test',
      version: 'v1',
      chains: { 1: { slug: 'ethereum' } },
      getProducts: async () => [],
      getApySpot: async () => [],
    }
    expect(defineYieldAdapter(adapter)).toBe(adapter)
  })
})
