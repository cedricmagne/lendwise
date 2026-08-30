import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ProtocolName } from '@/config/protocols-meta'
import type { YieldAdapter } from '@/lib/protocols/core/types'

/**
 * `catalogueFetchOpts` seeds `opts.poolIds` from the `products` catalogue for
 * every adapter that declares `ownsMarketDiscovery: false`, and touches nothing
 * for the rest. Both its dependencies — the adapter registry and the repo read
 * — are mocked; the flag gating is the behaviour under test.
 */

const mocks = vi.hoisted(() => ({
  distinctProtocolAddresses: vi.fn(),
  adapters: {} as Record<string, () => Promise<Partial<YieldAdapter>>>,
}))

vi.mock('@/config/protocols-server', () => ({
  get YIELD_ADAPTERS() {
    return mocks.adapters
  },
}))
vi.mock('@/lib/db/repositories/products', () => ({
  distinctProtocolAddresses: mocks.distinctProtocolAddresses,
}))

const { catalogueFetchOpts } =
  await import('@/lib/protocols/core/catalogue-opts')

const adapter = (
  over: Partial<YieldAdapter>
): (() => Promise<Partial<YieldAdapter>>) => {
  const a: Partial<YieldAdapter> = {
    provider: 'x',
    version: 'v1',
    ...over,
  }
  return async () => a
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.adapters = {}
  mocks.distinctProtocolAddresses.mockResolvedValue(['POOL_A', 'POOL_B'])
})

describe('catalogueFetchOpts', () => {
  it('skips an adapter with no ownsMarketDiscovery field', async () => {
    mocks.adapters = { aave_v3: adapter({ provider: 'aave', version: 'v3' }) }

    const out = await catalogueFetchOpts(['aave_v3'] as ProtocolName[], {
      activeOnly: false,
    })

    expect(out.size).toBe(0)
    expect(mocks.distinctProtocolAddresses).not.toHaveBeenCalled()
  })

  it('skips an adapter with ownsMarketDiscovery: true', async () => {
    mocks.adapters = {
      compound_v3: adapter({
        provider: 'compound',
        version: 'v3',
        ownsMarketDiscovery: true,
      }),
    }

    const out = await catalogueFetchOpts(['compound_v3'] as ProtocolName[], {
      activeOnly: true,
    })

    expect(out.size).toBe(0)
    expect(mocks.distinctProtocolAddresses).not.toHaveBeenCalled()
  })

  it('seeds poolIds for an adapter with ownsMarketDiscovery: false', async () => {
    mocks.adapters = {
      blend_v2: adapter({
        provider: 'blend',
        version: 'v2',
        ownsMarketDiscovery: false,
      }),
    }

    const out = await catalogueFetchOpts(['blend_v2'] as ProtocolName[], {
      activeOnly: true,
    })

    expect(mocks.distinctProtocolAddresses).toHaveBeenCalledWith(
      'blend',
      'v2',
      {
        activeOnly: true,
      }
    )
    expect(out.get('blend_v2' as ProtocolName)).toEqual({
      poolIds: ['POOL_A', 'POOL_B'],
    })
  })

  it('forwards activeOnly: false through to the repo', async () => {
    mocks.adapters = {
      blend_v1: adapter({
        provider: 'blend',
        version: 'v1',
        ownsMarketDiscovery: false,
      }),
    }

    await catalogueFetchOpts(['blend_v1'] as ProtocolName[], {
      activeOnly: false,
    })

    expect(mocks.distinctProtocolAddresses).toHaveBeenCalledWith(
      'blend',
      'v1',
      {
        activeOnly: false,
      }
    )
  })

  it('returns Map entries only for the false adapters in a mixed list', async () => {
    mocks.adapters = {
      aave_v3: adapter({ provider: 'aave', version: 'v3' }),
      blend_v1: adapter({
        provider: 'blend',
        version: 'v1',
        ownsMarketDiscovery: false,
      }),
      blend_v2: adapter({
        provider: 'blend',
        version: 'v2',
        ownsMarketDiscovery: false,
      }),
    }

    const out = await catalogueFetchOpts(
      ['aave_v3', 'blend_v1', 'blend_v2'] as ProtocolName[],
      { activeOnly: false }
    )

    expect([...out.keys()].sort()).toEqual(['blend_v1', 'blend_v2'])
    expect(mocks.distinctProtocolAddresses).toHaveBeenCalledTimes(2)
  })
})
