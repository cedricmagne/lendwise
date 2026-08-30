# Token Icons

This directory contains SVG icons for high-priority tokens that should load instantly without API calls.

## Recommended Tokens to Add

### Stablecoins

- `usdc.svg` - USD Coin
- `usdt.svg` - Tether
- `dai.svg` - Dai

### Major Cryptocurrencies

- `btc.svg` - Bitcoin
- `eth.svg` - Ethereum
- `bnb.svg` - BNB
- `sol.svg` - Solana
- `matic.svg` - Polygon

### Wrapped Tokens

- `weth.svg` - Wrapped Ethereum (can use same as eth.svg)
- `wbtc.svg` - Wrapped Bitcoin (can use same as btc.svg)

### DeFi Tokens

- `uni.svg` - Uniswap
- `aave.svg` - Aave
- `comp.svg` - Compound

## Where to Get Icons

1. **CoinGecko**: Download from token pages
2. **Token Icons Repo**: https://github.com/spothq/cryptocurrency-icons
3. **Official Websites**: Most projects provide SVG logos

## File Naming

- Use **lowercase** symbol names
- Format: `{symbol}.svg`
- Examples: `btc.svg`, `eth.svg`, `usdc.svg`

## Optimization

SVG files should be optimized:

- Remove unnecessary metadata
- Minimize file size
- Ensure viewBox is set correctly

You can use [SVGO](https://github.com/svg/svgo) to optimize:

```bash
npx svgo -f public/icons/tokens
```

## Usage

Once added, icons will be automatically used by the `TokenIcon` component with instant loading (no API calls).
