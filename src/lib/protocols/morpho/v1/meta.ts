/**
 * `PROTOCOLS_META` fragment for this adapter — spread into the aggregate at
 * `@/config/protocols-meta.ts`. Kept import-light (no adapter/client code)
 * since that aggregate is also imported client-side.
 */
import { MORPHO_PROVIDER } from '../common/config'

export const MORPHO_V1_META = {
  morpho_v1: {
    displayName: 'Morpho',
    versionName: 'Morpho v1',
    provider: MORPHO_PROVIDER,
  },
} as const
