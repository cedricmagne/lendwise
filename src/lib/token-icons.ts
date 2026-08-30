/**
 * Symbols that share one icon are grouped for authoring — add a symbol to a
 * family in one place. `STATIC_TOKEN_ICONS` below flattens this into a Map
 * for O(1) lookup; nothing else reads `STATIC_ICON_GROUPS` directly.
 *
 * IMPORTANT: only reference SVG/webp files that actually exist in
 * /public/icons/native/ — a missing file falls back to CoinGecko instead of
 * failing loudly.
 */
type IconGroup = { symbols: string[]; icon: string }

const STATIC_ICON_GROUPS: IconGroup[] = [
  { symbols: ['eth', 'weth'], icon: '/icons/native/eth.svg' },
  { symbols: ['btc', 'wbtc'], icon: '/icons/native/btc.svg' },
  { symbols: ['xlm'], icon: '/icons/native/xlm.svg' },
  { symbols: ['dai'], icon: '/icons/native/dai.webp' },
  { symbols: ['usdc'], icon: '/icons/native/usdc.webp' },
]

export const STATIC_TOKEN_ICONS: ReadonlyMap<string, string> = new Map(
  STATIC_ICON_GROUPS.flatMap((group) =>
    group.symbols.map((symbol) => [symbol.toLowerCase(), group.icon] as const)
  )
)

/**
 * Icon for a token symbol from the static table, skipping CoinGecko
 * entirely. Returns undefined if the symbol isn't covered — callers fall
 * back to the CoinGecko-backed lookup.
 */
export function getStaticTokenIcon(symbol: string): string | undefined {
  return STATIC_TOKEN_ICONS.get(symbol.toLowerCase())
}
