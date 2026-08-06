import { describe, expect, it } from 'vitest'

import { PROTOCOLS_META, type ProtocolName } from '@/config/protocols-meta'
import { PROTOCOLS_PRESENTATION } from '@/config/protocols-presentation'

/**
 * What each registered protocol overrides. Every hook it does NOT name falls
 * back to `core/presentation.ts` — that is a decision, so it is written down
 * here rather than inferred.
 *
 * This table is the point of the file. `PROTOCOLS_PRESENTATION` is keyed by
 * adapter id, not by provider, so two versions of one protocol register
 * separately: Blend v2 does not inherit v1's fragment. Dropping a registration
 * would otherwise be silent — the rows would simply fall back to `assetName`,
 * which is exactly the bug Blend v1 shipped once (five Stellar pools, same
 * asset, four rows reading identically).
 *
 * Adding a protocol fails this test until its presentation is decided, even if
 * the decision is "nothing to override" — an empty array.
 */
const EXPECTED_HOOKS: Record<ProtocolName, string[]> = {
  aave_v3: ['networkSlug', 'productLink'],
  morpho_v1: ['poolName', 'poolIdentity', 'productLink'],
  compound_v3: ['productLink'],
  blend_v1: ['poolName'],
  blend_v2: ['poolName'],
}

describe('PROTOCOLS_PRESENTATION', () => {
  it('covers every protocol declared in PROTOCOLS_META', () => {
    expect(Object.keys(EXPECTED_HOOKS).sort()).toEqual(
      Object.keys(PROTOCOLS_META).sort()
    )
  })

  it.each(Object.keys(EXPECTED_HOOKS) as ProtocolName[])(
    '%s registers exactly the hooks it is expected to',
    (id) => {
      const hooks = Object.keys(PROTOCOLS_PRESENTATION[id] ?? {})
      expect(hooks.sort()).toEqual([...EXPECTED_HOOKS[id]].sort())
    }
  )

  it('registers nothing under a key that is not a known adapter id', () => {
    const known = new Set(Object.keys(PROTOCOLS_META))
    expect(
      Object.keys(PROTOCOLS_PRESENTATION).filter((k) => !known.has(k))
    ).toEqual([])
  })
})
