/**
 * Compound's presentation overrides — see `core/presentation.ts` for the
 * contract. Only the link differs; name, network and identity are the defaults.
 *
 * Registered into `@/config/protocols-presentation`.
 */
import type { ProtocolName } from '@/config/protocols-meta'
import type { ProductRow } from '@/lib/db/schema'
import type { ProtocolPresentation } from '@/lib/protocols/core/presentation'

import { SLUG_MAPPING } from './utils'

export const COMPOUND_V3_PRESENTATION = {
  compound_v3: {
    /**
     * Compound's app uses its own chain slugs (`arb`, `op`), not the registry's
     * — hence `SLUG_MAPPING` rather than `chainSlugFor()`, and `mainnet` as the
     * fallback its URLs already default to.
     */
    productLink: (p: ProductRow) =>
      `https://app.compound.finance/?market=${p.assetSymbol.toLowerCase()}-${SLUG_MAPPING[p.chainId] ?? 'mainnet'}`,
  },
} satisfies Partial<Record<ProtocolName, ProtocolPresentation>>
