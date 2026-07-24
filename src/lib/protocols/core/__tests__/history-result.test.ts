import { describe, expect, it } from 'vitest'

import { toHistoryResult } from '@/lib/protocols/core/history-result'
import type {
  HistoryDataPoint,
  HistoryResult,
} from '@/lib/protocols/core/types'

function point(productId: string): HistoryDataPoint {
  return {
    timestamp: new Date('2026-07-20T08:00:00.000Z'),
    productId,
    kind: 'supply',
    apy: { base: 0.05, rewards: 0, fees: 0, net: 0.05, rewardItems: [] },
    market: {
      supplyAssets: null,
      supplyAssetsUsd: null,
      utilizationRate: null,
      assetPriceUsd: null,
    },
  }
}

describe('toHistoryResult', () => {
  it('wraps a bare array, reporting no failures', () => {
    const points = [point('a'), point('b')]

    expect(toHistoryResult(points)).toEqual({ points, failures: [] })
  })

  it('wraps an empty array', () => {
    expect(toHistoryResult([])).toEqual({ points: [], failures: [] })
  })

  it('passes a HistoryResult through untouched', () => {
    const result: HistoryResult = {
      points: [point('a')],
      failures: [{ productId: 'b', reason: 'rate limited' }],
    }

    expect(toHistoryResult(result)).toBe(result)
  })

  it('treats a result with no failures as a result, not an array', () => {
    const result: HistoryResult = { points: [], failures: [] }

    expect(toHistoryResult(result)).toBe(result)
  })
})
