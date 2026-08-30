import { describe, expect, it } from 'vitest'

import { getStaticTokenIcon } from '@/lib/token-icons'

describe('getStaticTokenIcon', () => {
  it('resolves a symbol to its group icon', () => {
    expect(getStaticTokenIcon('eth')).toBe('/icons/native/eth.svg')
  })

  it('is case-insensitive', () => {
    expect(getStaticTokenIcon('ETH')).toBe('/icons/native/eth.svg')
    expect(getStaticTokenIcon('Btc')).toBe('/icons/native/btc.svg')
  })

  it('resolves every symbol in a shared group to the same icon', () => {
    // eth and weth are a wrapped-token family sharing one logo, per
    // public/icons/native/README.md's "wrapped tokens can reuse the
    // underlying asset's icon" convention.
    expect(getStaticTokenIcon('weth')).toBe(getStaticTokenIcon('eth'))
  })

  it('returns undefined for a symbol not in any group', () => {
    expect(getStaticTokenIcon('some-unmapped-symbol')).toBeUndefined()
  })
})
