// src/config/protocols-meta.ts — importable from client components, zero server deps
export const PROTOCOLS_META = {
  aave_v3: { displayName: 'Aave', versionName: 'Aave v3', provider: 'aave' },
  morpho_v1: {
    displayName: 'Morpho',
    versionName: 'Morpho v1',
    provider: 'morpho',
  },
  compound_v3: {
    displayName: 'Compound',
    versionName: 'Compound v3',
    provider: 'compound',
  },
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
