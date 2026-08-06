/**
 * Aave's presentation overrides — see `core/presentation.ts` for the contract.
 *
 * Registered into `@/config/protocols-presentation`.
 */
import type { ProtocolName } from '@/config/protocols-meta'
import type { ProductRow } from '@/lib/db/schema'
import type { ProtocolPresentation } from '@/lib/protocols/core/presentation'
import { chainSlugFor } from '@/lib/protocols/core/toolkit/chain-slugs'

import { getNetworkName } from './utils'

export const AAVE_V3_PRESENTATION = {
  aave_v3: {
    /**
     * Aave's UI presents Lido, EtherFi and Horizon as distinct "networks"
     * though all three sit on Ethereum, so the slug comes from the market name
     * rather than from `chainId` — the one documented exception to deriving
     * `network` from the chain registry.
     */
    networkSlug: (p: ProductRow) => getNetworkName(p.protocolName),

    /**
     * `chainSlugFor()`, not `defaultNetworkSlug()`: a link is decorative, not a
     * required field of the table. A chainId that drifts from the registry (a
     * new market added to AAVE_V3_CHAINS before it is registered in
     * chain-slugs.ts) should only cost a missing link, never crash all of
     * `/supply`.
     *
     * And the slug, not `p.chainName`: that column holds the source protocol's
     * DISPLAY name, which sometimes contains a space (`chain_id` 196 →
     * "X Layer") — building a URL from it breaks it. 9 Aave products rendered a
     * broken link before this was fixed.
     *
     * Deliberately the chain slug rather than `networkSlug()` above: the latter
     * distinguishes Lido/EtherFi/Horizon, but those markets had no eligible row
     * in the catalogue when the link was fixed — so nothing could confirm which
     * token Aave's app expects there. This leaves their link unchanged
     * (`ethereum`) rather than inventing an unverified slug.
     */
    productLink: (p: ProductRow) => {
      const slug = chainSlugFor(p.chainId)
      if (!slug) return ''
      return `https://app.aave.com/reserve-overview/?underlyingAsset=${p.assetAddress.toLowerCase()}&marketName=proto_${slug}_v3`
    },
  },
} satisfies Partial<Record<ProtocolName, ProtocolPresentation>>
