import { AAVE_V3_META } from '@/lib/protocols/aave/v3/meta'
import { COMPOUND_V3_META } from '@/lib/protocols/compound/v3/meta'
import { MORPHO_V1_META } from '@/lib/protocols/morpho/v1/meta'

/**
 * Each entry is owned by its adapter (`{protocol}/{version}/meta.ts`) and
 * spread in here — this file stays the one explicit registration point (no
 * filesystem discovery, see `src/lib/protocols/README.md`), but never
 * hand-declares a protocol's identity itself.
 */
export const PROTOCOLS_META = {
  ...AAVE_V3_META,
  ...MORPHO_V1_META,
  ...COMPOUND_V3_META,
} as const

export type ProtocolName = keyof typeof PROTOCOLS_META

function metaFor(id: string) {
  return id in PROTOCOLS_META ? PROTOCOLS_META[id as ProtocolName] : undefined
}

/** 'aave_v3' → 'Aave v3'. Version-qualified display name, looked up (not parsed). */
export function protocolVersionName(id: string): string {
  return metaFor(id)?.versionName ?? 'n/a'
}

/** 'aave_v3' → 'Aave'. Provider display name, looked up (not parsed). */
export function protocolDisplayName(id: string): string {
  return metaFor(id)?.displayName ?? 'n/a'
}

/** DB provider column value → adapter ids. Used by heal to map gaps to adapters. */
export function adapterIdsForProvider(provider: string): ProtocolName[] {
  return (Object.keys(PROTOCOLS_META) as ProtocolName[]).filter(
    (id) => PROTOCOLS_META[id].provider === provider
  )
}
