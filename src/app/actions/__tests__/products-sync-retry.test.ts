/**
 * The catalogue sync retries an enumeration that failed.
 *
 * Regression cover for 2026-08-06: the Stellar RPC answered 429 to Blend's
 * enumeration during the hourly sync, `Promise.allSettled` absorbed it, the
 * route answered 207 — which QStash reads as success — and the catalogue went a
 * full hour without Blend's 78 products. The collector meanwhile kept emitting
 * them, and every one of the six slots that hour was dropped by the
 * catalogue filter in `upsertHourlySlots`.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getProducts: vi.fn(),
  upsertProducts: vi.fn(),
  syncProviderProducts: vi.fn(),
}))

vi.mock('@/lib/db/repositories/products', () => ({
  upsertProducts: mocks.upsertProducts,
  syncProviderProducts: mocks.syncProviderProducts,
}))

vi.mock('@/config/protocols-server', () => ({
  YIELD_ADAPTERS: {
    aave_v3: async () => ({ getProducts: mocks.getProducts }),
  },
}))

const { syncProducts } = await import('@/app/actions/products-sync.actions')

const product = (id: string) => ({
  _id: id,
  kind: 'supply',
  protocol: { provider: 'aave', chain: { id: 1 } },
})

/** Drives `syncProducts` past the retry pause without waiting for it. */
async function runPastRetryDelay() {
  const pending = syncProducts()
  await vi.advanceTimersByTimeAsync(10_000)
  return pending
}

describe('syncProducts — enumeration retry', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    mocks.upsertProducts.mockResolvedValue(undefined)
    mocks.syncProviderProducts.mockResolvedValue({
      activated: 0,
      deactivated: 0,
      unchanged: 1,
    })
  })

  it('retries once and writes the products the second attempt returned', async () => {
    mocks.getProducts
      .mockRejectedValueOnce(new Error('Request failed with status code 429'))
      .mockResolvedValueOnce([product('a'), product('b')])

    const result = await runPastRetryDelay()

    expect(mocks.getProducts).toHaveBeenCalledTimes(2)
    expect(result.counts.total).toBe(2)
    expect(result.success).toBe(true)
    expect(mocks.upsertProducts).toHaveBeenCalledOnce()
  })

  it('gives up after the retry, and leaves availability untouched', async () => {
    mocks.getProducts.mockRejectedValue(
      new Error('Request failed with status code 429')
    )

    const result = await runPastRetryDelay()

    expect(mocks.getProducts).toHaveBeenCalledTimes(2)
    expect(result.success).toBe(false)
    expect(result.errors[0]).toContain('429')
    // The guard that matters: a provider whose enumeration failed must never
    // reach reconciliation, or its empty id list reads as "everything delisted".
    expect(mocks.syncProviderProducts).not.toHaveBeenCalled()
  })

  it('does not retry an enumeration that succeeded', async () => {
    mocks.getProducts.mockResolvedValueOnce([product('a')])

    const result = await runPastRetryDelay()

    expect(mocks.getProducts).toHaveBeenCalledTimes(1)
    expect(result.counts.total).toBe(1)
  })
})
