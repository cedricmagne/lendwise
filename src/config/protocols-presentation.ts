// src/config/protocols-presentation.ts — how each protocol's rows are displayed
import { AAVE_V3_PRESENTATION } from '@/lib/protocols/aave/v3/presentation'
import { BLEND_V1_PRESENTATION } from '@/lib/protocols/blend/v1/presentation'
import { BLEND_V2_PRESENTATION } from '@/lib/protocols/blend/v2/presentation'
import { COMPOUND_V3_PRESENTATION } from '@/lib/protocols/compound/v3/presentation'
import type { ProtocolPresentation } from '@/lib/protocols/core/presentation'
import { MORPHO_V1_PRESENTATION } from '@/lib/protocols/morpho/v1/presentation'

import type { ProtocolName } from './protocols-meta'

/**
 * Each entry is owned by its adapter (`{protocol}/{version}/presentation.ts`)
 * and spread in here — same explicit registration as `protocols-meta.ts` (no
 * filesystem discovery, see `src/lib/protocols/README.md`).
 *
 * Unlike that registry, this one is NOT client-safe: a hook may reach into its
 * adapter's utils (`getNetworkName`, `SLUG_MAPPING`). Its only consumer,
 * `src/lib/products/from-catalogue.ts`, runs on the server.
 *
 * Keyed by adapter id (`blend_v1`), not by provider (`blend`): the key is typed
 * by `ProtocolName`, and two versions of one protocol can present differently.
 * The flip side is that each version must register — v2 does not inherit v1's
 * fragment. `__tests__/protocols-presentation.test.ts` locks that down.
 *
 * `Partial` on purpose: a protocol that needs no override registers nothing and
 * gets the defaults in `core/presentation.ts`.
 */
export const PROTOCOLS_PRESENTATION: Partial<
  Record<ProtocolName, ProtocolPresentation>
> = {
  ...AAVE_V3_PRESENTATION,
  ...MORPHO_V1_PRESENTATION,
  ...COMPOUND_V3_PRESENTATION,
  ...BLEND_V1_PRESENTATION,
  ...BLEND_V2_PRESENTATION,
}
