/**
 * Symbols that share one icon are grouped for authoring — add a symbol to a
 * family in one place. `STATIC_TOKEN_ICONS` below flattens this into a Map
 * for O(1) lookup; nothing else reads `STATIC_ICON_GROUPS` directly.
 *
 * IMPORTANT: only reference SVG/webp files that actually exist in
 * /public/icons/tokens/ — a missing file falls back to CoinGecko instead of
 * failing loudly.
 */
const TOKEN_ICON_ROOT_PATH = '/icons/tokens'

type IconGroup = { symbols: string[]; icon: string }

const STATIC_ICON_GROUPS: IconGroup[] = [
  { symbols: ['eth', 'weth'], icon: 'eth.svg' },
  { symbols: ['btc', 'wbtc'], icon: 'btc.svg' },
  { symbols: ['dai'], icon: 'dai.webp' },
  { symbols: ['aqua'], icon: 'aqua.webp' },
  { symbols: ['cetes'], icon: 'cetes.webp' },
  { symbols: ['eurc'], icon: 'eurc.png' },
  { symbols: ['eurx'], icon: 'eurx.png' },
  { symbols: ['grbx'], icon: 'grbx.png' },
  { symbols: ['pyusd'], icon: 'pyusd.webp' },
  { symbols: ['solvbtc'], icon: 'solvbtc.svg' },
  { symbols: ['tesouro'], icon: 'tesouro.jpg' },
  { symbols: ['usd1'], icon: 'usd1.webp' },
  { symbols: ['usdc'], icon: 'usdc.webp' },
  { symbols: ['usde'], icon: 'usde.webp' },
  { symbols: ['usdg'], icon: 'usdg.webp' },
  { symbols: ['usdglo'], icon: 'usdglo.webp' },
  { symbols: ['usds'], icon: 'usds.webp' },
  { symbols: ['usdt'], icon: 'usdt.webp' },
  { symbols: ['usdx'], icon: 'usdx.webp' },
  { symbols: ['ustry'], icon: 'ustry.webp' },
  { symbols: ['xlm'], icon: 'xlm.svg' },
  { symbols: ['xrf'], icon: 'xrf.svg' },
  { symbols: ['xsolvbtc'], icon: 'xsolvbtc.svg' },
]

export const STATIC_TOKEN_ICONS: ReadonlyMap<string, string> = new Map(
  STATIC_ICON_GROUPS.flatMap((group) =>
    group.symbols.map(
      (symbol) =>
        [symbol.toLowerCase(), `${TOKEN_ICON_ROOT_PATH}/${group.icon}`] as const
    )
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
