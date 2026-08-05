import { defineYieldAdapter } from '@/lib/protocols/core/define'
import { CHAIN_SLUG_MAP } from '@/lib/protocols/core/toolkit/chain-slugs'

import { fetchBlendV2ApySpot } from './apy-spot'
import { fetchBlendV2Products } from './products'

export const adapter = defineYieldAdapter({
  id: 'blend_v2',
  name: 'Blend v2',
  provider: 'blend',
  version: 'v2',
  chains: {
    '-1': { slug: CHAIN_SLUG_MAP['-1'] },
  },
  getProducts: fetchBlendV2Products,
  getApySpot: fetchBlendV2ApySpot,
  // getApyHistory: optional
})
