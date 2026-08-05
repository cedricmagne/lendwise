// src/config/protocols-server.ts — server only: loaders dynamic-import heavy adapter modules
import type { ProtocolName } from '@/config/protocols-meta'
import type { AppAdapter, YieldAdapter } from '@/lib/protocols/core/types'

export const YIELD_ADAPTERS: Record<ProtocolName, () => Promise<YieldAdapter>> =
  {
    aave_v3: () => import('@/lib/protocols/aave/v3').then((m) => m.adapter),
    morpho_v1: () => import('@/lib/protocols/morpho/v1').then((m) => m.adapter),
    compound_v3: () =>
      import('@/lib/protocols/compound/v3').then((m) => m.adapter),
    blend_v1: () => import('@/lib/protocols/blend/v1').then((m) => m.adapter),
    blend_v2: () => import('@/lib/protocols/blend/v2').then((m) => m.adapter),
  }

export const APP_ADAPTERS: Partial<
  Record<ProtocolName, () => Promise<AppAdapter>>
> = {
  aave_v3: () => import('@/lib/protocols/aave/v3').then((m) => m.appAdapter),
  morpho_v1: () =>
    import('@/lib/protocols/morpho/v1').then((m) => m.appAdapter),
  compound_v3: () =>
    import('@/lib/protocols/compound/v3').then((m) => m.appAdapter),
}
