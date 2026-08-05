/**
 * @file meta.ts
 * `PROTOCOLS_META` fragment for this adapter — spread into the aggregate at
 * `@/config/protocols-meta.ts`. Kept import-light (no adapter/client code)
 * since that aggregate is also imported client-side.
 */
import { AAVE_PROVIDER } from '../common/config'

export const AAVE_V3_META = {
  aave_v3: {
    displayName: 'Aave',
    versionName: 'Aave v3',
    provider: AAVE_PROVIDER,
  },
} as const
