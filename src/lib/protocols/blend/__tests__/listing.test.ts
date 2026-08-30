import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * `blendPoolIds` is THE enumeration predicate for both Blend callers. The known
 * set is injected by the pipeline via `opts.poolIds` (the `products` catalogue);
 * `getFactoryDeployedPools` (the on-chain factory Deploy scan) is the only thing
 * mocked here — the union / dedup / sort is really computed.
 */

const mocks = vi.hoisted(() => ({
  getFactoryDeployedPools: vi.fn(),
}))

vi.mock('@/lib/protocols/blend/common/api', () => ({
  getFactoryDeployedPools: mocks.getFactoryDeployedPools,
}))

const { blendPoolIds } = await import('@/lib/protocols/blend/listing')

// Synthetic strkey-shaped ids (56 chars, leading `C`). Distinct and
// case-convertible; none is a real pool.
const KNOWN_A = `C${'A'.repeat(55)}`
const KNOWN_B = `C${'B'.repeat(55)}`
const EVENT_C = `C${'C'.repeat(55)}`
const EVENT_D = `C${'D'.repeat(55)}`

beforeEach(() => {
  vi.clearAllMocks()
  vi.restoreAllMocks()
})

describe('blendPoolIds — catalogue mode (getProducts)', () => {
  it('unions the known set with the factory scan, deduped and sorted', async () => {
    mocks.getFactoryDeployedPools.mockResolvedValue([EVENT_C, EVENT_D])

    const result = await blendPoolIds(
      'v2',
      { poolIds: [KNOWN_B, KNOWN_A] },
      'catalogue'
    )

    expect(result).toEqual([KNOWN_A, KNOWN_B, EVENT_C, EVENT_D])
    expect(mocks.getFactoryDeployedPools).toHaveBeenCalledWith('v2')
  })

  it('collapses a pool that appears in both terms', async () => {
    mocks.getFactoryDeployedPools.mockResolvedValue([KNOWN_B, EVENT_C])

    const result = await blendPoolIds(
      'v1',
      { poolIds: [KNOWN_A, KNOWN_B] },
      'catalogue'
    )

    expect(result).toEqual([KNOWN_A, KNOWN_B, EVENT_C])
    expect(new Set(result).size).toBe(result.length)
  })

  it('upcases a lowercase address from either term, exactly once', async () => {
    mocks.getFactoryDeployedPools.mockResolvedValue([EVENT_C.toLowerCase()])

    const result = await blendPoolIds(
      'v2',
      { poolIds: [KNOWN_A.toLowerCase(), KNOWN_A] },
      'catalogue'
    )

    expect(result).toEqual([EVENT_C, KNOWN_A].sort())
    expect(result).not.toContain(KNOWN_A.toLowerCase())
    expect(result).not.toContain(EVENT_C.toLowerCase())
  })

  it('warns and falls back to the known set when the factory scan rejects', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    mocks.getFactoryDeployedPools.mockRejectedValue(new Error('429'))

    const result = await blendPoolIds('v1', { poolIds: [KNOWN_A] }, 'catalogue')

    expect(result).toEqual([KNOWN_A])
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('[pools:blend_v1] getEvents skipped: 429')
    )
  })

  it('returns [] when the known set is empty and the factory scan is empty', async () => {
    mocks.getFactoryDeployedPools.mockResolvedValue([])

    expect(await blendPoolIds('v2', undefined, 'catalogue')).toEqual([])
    expect(await blendPoolIds('v2', { poolIds: [] }, 'catalogue')).toEqual([])
  })

  it('lets the factory scan add a pool absent from the known set', async () => {
    mocks.getFactoryDeployedPools.mockResolvedValue([EVENT_C])

    expect(await blendPoolIds('v1', { poolIds: [] }, 'catalogue')).toEqual([
      EVENT_C,
    ])
  })

  it('returns a stable ascending sort regardless of input order', async () => {
    mocks.getFactoryDeployedPools.mockResolvedValue([EVENT_C])

    expect(
      await blendPoolIds('v2', { poolIds: [EVENT_D, KNOWN_A] }, 'catalogue')
    ).toEqual([KNOWN_A, EVENT_C, EVENT_D].sort())
  })
})

describe('blendPoolIds — spot mode (getApySpot)', () => {
  it('returns the known set deduped and sorted, without calling the factory', async () => {
    const result = await blendPoolIds(
      'v2',
      { poolIds: [KNOWN_B, KNOWN_A, KNOWN_B] },
      'spot'
    )

    expect(result).toEqual([KNOWN_A, KNOWN_B])
    expect(mocks.getFactoryDeployedPools).not.toHaveBeenCalled()
  })

  it('returns [] for an empty / absent known set', async () => {
    expect(await blendPoolIds('v1', { poolIds: [] }, 'spot')).toEqual([])
    expect(await blendPoolIds('v1', undefined, 'spot')).toEqual([])
    expect(mocks.getFactoryDeployedPools).not.toHaveBeenCalled()
  })
})
