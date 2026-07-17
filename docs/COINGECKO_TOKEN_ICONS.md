# CoinGecko Token Icon System

## Overview

Comprehensive token icon system using **CoinGecko API** for all currency icons (crypto and fiat) with multi-layer caching strategy. This provides access to thousands of token icons with a unified component interface.

**Single Component:** `TokenIcon` handles all currencies - no separate components needed.

## Architecture

### 🏗️ Three-Layer Caching Strategy

1. **Native Icons** (`/public/icons/native/`) - Instant load for high-priority tokens
2. **localStorage** - Client-side persistent cache (survives page reloads)
3. **Server Memory** - API route in-memory cache (24h)
4. **CoinGecko API** - Fallback source with Next.js cache (24h)

### 📁 File Structure

```
src/
├── lib/
│   └── coingecko.ts              # CoinGecko API utilities
├── app/
│   └── api/
│       └── token-icon/
│           └── route.ts          # Server-side caching API
├── hooks/
│   └── useTokenIcon.ts           # SWR hook with localStorage
└── components/
    ├── TokenIcon.tsx             # Main token icon component
    └── currency-icon.tsx         # Updated to use TokenIcon for crypto

public/
└── icons/
    └── native/                   # Native token icons (optional)
        ├── eth.svg
        ├── btc.svg
        ├── usdc.svg
        └── ...
```

## Implementation Details

### 1. CoinGecko API Utilities (`lib/coingecko.ts`)

**Functions:**

- `searchCoinBySymbol(symbol)` - Find CoinGecko ID from token symbol
- `getCoinIconUrl(id)` - Get icon URL from CoinGecko ID
- `getTokenIconBySymbol(symbol)` - Combined function (recommended)

**Caching:**

- Coin list: 24h Next.js cache
- Coin details: 7 days Next.js cache

### 2. API Route (`app/api/token-icon/route.ts`)

**Endpoint:** `GET /api/token-icon?symbol=BTC`

**Features:**

- In-memory server cache (24h)
- HTTP cache headers (`s-maxage=86400`)
- Graceful error handling

**Response:**

```json
{
  "symbol": "btc",
  "url": "https://coin-images.coingecko.com/coins/images/1/small/bitcoin.png",
  "cached": true
}
```

### 3. SWR Hook (`hooks/useTokenIcon.ts`)

**Usage:**

```tsx
const iconUrl = useTokenIcon('BTC')
```

**Features:**

- localStorage caching (persistent)
- SWR for data fetching
- 1-hour deduplication
- No revalidation on focus

**Cache Key:** `token-icon-{symbol}`

### 4. TokenIcon Component (`components/TokenIcon.tsx`)

**Usage:**

```tsx
<TokenIcon symbol="BTC" size={24} />
<TokenIcon symbol="ETH" size={32} className="border" />
```

**Loading Priority:**

1. Native icons (instant)
2. localStorage cache
3. SWR fetch from API
4. Fallback to symbol initials

**States:**

- **Loading**: Animated skeleton
- **Success**: Token image
- **Error**: Symbol initials in circle

### 5. CurrencyIcon Integration

**Automatic routing:**

- **Crypto** → `TokenIcon` (CoinGecko)
- **Fiat** → `financial-flag-icons` (CDN)

```tsx
<CurrencyIcon currency="BTC" size={20} />  // Uses TokenIcon
<CurrencyIcon currency="USD" size={20} />  // Uses financial-flag-icons
```

## Setup Instructions

### Step 1: Create Native Icons Directory (Optional)

```bash
mkdir -p public/icons/native
```

Add SVG icons for high-priority tokens:

- `eth.svg`, `btc.svg`, `usdc.svg`, `usdt.svg`, `dai.svg`, etc.

You can download these from:

- [CoinGecko](https://www.coingecko.com/)
- [Token Icons Repository](https://github.com/spothq/cryptocurrency-icons)

### Step 2: Configure Native Icons

Edit `NATIVE_ICONS` in `components/TokenIcon.tsx`:

```typescript
const NATIVE_ICONS: Record<string, string> = {
  eth: '/icons/native/eth.svg',
  weth: '/icons/native/eth.svg',
  btc: '/icons/native/btc.svg',
  // Add more...
}
```

### Step 3: Test the System

```tsx
import { TokenIcon } from '@/components/TokenIcon'

export default function TestPage() {
  const tokens = ['BTC', 'ETH', 'USDC', 'DOGE', 'PEPE', 'SHIB']

  return (
    <div className="flex gap-4">
      {tokens.map((symbol) => (
        <div key={symbol} className="flex flex-col items-center gap-2">
          <TokenIcon symbol={symbol} size={48} />
          <span className="text-sm">{symbol}</span>
        </div>
      ))}
    </div>
  )
}
```

## Performance Characteristics

### Cache Hit Rates (Expected)

| Layer         | Hit Rate | Load Time |
| ------------- | -------- | --------- |
| Native Icons  | ~10%     | <10ms     |
| localStorage  | ~70%     | ~20ms     |
| Server Memory | ~15%     | ~50ms     |
| CoinGecko API | ~5%      | ~500ms    |

### Storage Usage

- **localStorage**: ~50 bytes per token
- **Server Memory**: ~100 bytes per token
- **Total for 100 tokens**: ~5KB localStorage + ~10KB server

### API Rate Limits

CoinGecko Free API:

- **50 calls/minute** (coin list)
- **10-30 calls/minute** (coin details)

Our caching strategy keeps API calls minimal:

- Coin list: 1 call per 24h
- Coin details: 1 call per token per 24h

## Usage Examples

### Basic Usage

```tsx
import { TokenIcon } from '@/components/TokenIcon'

;<TokenIcon symbol="BTC" size={24} />
```

### In Table Cells

```tsx
<div className="flex items-center gap-2">
  <TokenIcon symbol={row.token} size={20} />
  <span>{row.token}</span>
</div>
```

### With Loading State

```tsx
const iconUrl = useTokenIcon('BTC')

{
  iconUrl ? (
    <Image src={iconUrl} alt="BTC" width={24} height={24} />
  ) : (
    <Skeleton className="h-6 w-6 rounded-full" />
  )
}
```

### Preload Icons

```tsx
// Preload common tokens on app start
useEffect(() => {
  const commonTokens = ['BTC', 'ETH', 'USDC', 'USDT']
  commonTokens.forEach((symbol) => {
    fetch(`/api/token-icon?symbol=${symbol}`)
  })
}, [])
```

## Troubleshooting

### Icons Not Loading

1. **Check API route**: Visit `/api/token-icon?symbol=BTC`
2. **Check localStorage**: Open DevTools → Application → Local Storage
3. **Check console**: Look for CoinGecko API errors
4. **Check Next.js config**: Ensure `coin-images.coingecko.com` is allowed

### Slow Loading

1. **Add to native icons**: Move frequently used tokens to `/public/icons/native/`
2. **Preload on mount**: Fetch common tokens on app initialization
3. **Check network**: CoinGecko API might be slow in some regions

### Wrong Icons

1. **Symbol ambiguity**: Some symbols have multiple coins (e.g., "UNI")
2. **Manual mapping**: Add specific mappings in `searchCoinBySymbol`
3. **Use CoinGecko ID**: Directly use `getCoinIconUrl('bitcoin')` instead of symbol

## Advanced Configuration

### Custom Fallback Icon

```tsx
// In TokenIcon.tsx
const handleError = () => {
  setSrc('/icons/default-token.svg') // Custom fallback
}
```

### Increase Cache Duration

```tsx
// In useTokenIcon.ts
dedupingInterval: 1000 * 60 * 60 * 24, // 24 hours
```

### Add More Native Icons

```typescript
const NATIVE_ICONS: Record<string, string> = {
  // Stablecoins
  usdc: '/icons/native/usdc.svg',
  usdt: '/icons/native/usdt.svg',
  dai: '/icons/native/dai.svg',

  // Major chains
  eth: '/icons/native/eth.svg',
  btc: '/icons/native/btc.svg',
  bnb: '/icons/native/bnb.svg',

  // DeFi tokens
  uni: '/icons/native/uni.svg',
  aave: '/icons/native/aave.svg',
  comp: '/icons/native/comp.svg',
}
```

## Migration from financial-flag-icons

The system is **backward compatible**. Existing `CurrencyIcon` usage continues to work:

```tsx
// Still works - automatically routes to TokenIcon for crypto
<CurrencyIcon currency="BTC" size={20} />

// Still works - uses financial-flag-icons for fiat
<CurrencyIcon currency="USD" size={20} />
```

No code changes required in existing components!

## Benefits

### ✅ Comprehensive Coverage

- **Thousands of tokens** vs. 58 from financial-flag-icons
- Covers DeFi, meme coins, new tokens, etc.

### ✅ Performance

- Multi-layer caching minimizes API calls
- Native icons for instant load
- localStorage for persistence

### ✅ Reliability

- Graceful fallbacks at every layer
- Works offline (if cached)
- No breaking changes on API failures

### ✅ Maintainability

- Single source of truth (CoinGecko)
- Automatic updates (new tokens appear automatically)
- No manual icon management

## Resources

- [CoinGecko API Documentation](https://www.coingecko.com/en/api/documentation)
- [SWR Documentation](https://swr.vercel.app/)
- [Next.js Image Optimization](https://nextjs.org/docs/app/building-your-application/optimizing/images)
