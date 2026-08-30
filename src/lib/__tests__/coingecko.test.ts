import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { getCoinIconUrl, searchCoinBySymbol } from '@/lib/coingecko'

describe('searchCoinBySymbol', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('resolves a mapped symbol from ASSET_TO_COINGECKO_ID without calling CoinGecko', async () => {
    const id = await searchCoinBySymbol('ETH')

    expect(id).toBe('ethereum')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('falls back to the coins/list scan for an unmapped symbol', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify([{ id: 'some-coin', symbol: 'zzz', name: 'Zzz' }]),
        { status: 200 }
      )
    )

    const id = await searchCoinBySymbol('zzz')

    expect(id).toBe('some-coin')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('retries a 429 and succeeds once the rate limit clears', async () => {
    vi.useFakeTimers()
    fetchMock
      .mockResolvedValueOnce(new Response(null, { status: 429 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([{ id: 'some-coin', symbol: 'zzz', name: 'Zzz' }]),
          { status: 200 }
        )
      )

    const promise = searchCoinBySymbol('zzz')
    await vi.runAllTimersAsync()
    const id = await promise

    expect(id).toBe('some-coin')
    expect(fetchMock).toHaveBeenCalledTimes(2)
    vi.useRealTimers()
  })
})

describe('getCoinIconUrl', () => {
  it('retries a 429 and returns the icon once the rate limit clears', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    vi.useFakeTimers()

    fetchMock
      .mockResolvedValueOnce(new Response(null, { status: 429 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: 'ethereum',
            symbol: 'eth',
            name: 'Ethereum',
            image: { thumb: 't', small: 's', large: 'l' },
          }),
          { status: 200 }
        )
      )

    const promise = getCoinIconUrl('ethereum')
    await vi.runAllTimersAsync()
    const url = await promise

    expect(url).toBe('s')
    expect(fetchMock).toHaveBeenCalledTimes(2)

    vi.useRealTimers()
    vi.unstubAllGlobals()
  })
})
