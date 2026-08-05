/**
 * `PROTOCOLS_META` fragment for this adapter — spread into the aggregate at
 * `@/config/protocols-meta.ts`. Kept import-light (no adapter/client code)
 * since that aggregate is also imported client-side.
 */
import { COMPOUND_PROVIDER } from '../common/config'

export const COMPOUND_V3_META = {
  compound_v3: {
    displayName: 'Compound',
    versionName: 'Compound v3',
    provider: COMPOUND_PROVIDER,
  },
} as const
