/**
 * Blend v1's presentation overrides — see `core/presentation.ts` for the
 * contract. The naming rule is shared with v2 (`blend/common/presentation.ts`).
 *
 * Registered into `@/config/protocols-presentation`.
 */
import type { ProtocolName } from '@/config/protocols-meta'
import type { ProtocolPresentation } from '@/lib/protocols/core/presentation'

import { blendPoolName } from '../common/presentation'

export const BLEND_V1_PRESENTATION = {
  blend_v1: {
    poolName: blendPoolName,
  },
} satisfies Partial<Record<ProtocolName, ProtocolPresentation>>
