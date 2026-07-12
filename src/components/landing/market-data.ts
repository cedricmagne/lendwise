/**
 * Demo rates shown on the landing page — single source of truth so the
 * Ticker and the ProblemSection chips never drift apart.
 */
export const demoRates = [
  {
    protocol: 'Morpho',
    chain: 'BASE',
    rate: '7.37%',
    tickerTag: 'supply',
    chipSub: 'supply APY',
  },
  {
    protocol: 'Aave v3',
    chain: 'ETH',
    rate: '3.21%',
    tickerTag: 'net',
    chipSub: 'net yield',
  },
  {
    protocol: 'Compound',
    chain: 'ETH',
    rate: '6.12%',
    tickerTag: 'borrow',
    chipSub: 'borrow rate',
  },
  {
    protocol: 'Yearn V3',
    chain: 'ETH',
    rate: '~12%',
    tickerTag: 'est',
    chipSub: 'estimated',
  },
  {
    protocol: 'Spark',
    chain: 'GNOSIS',
    rate: '5.00%',
    tickerTag: 'base',
    chipSub: 'APR base',
  },
  {
    protocol: 'Pendle',
    chain: 'ARB',
    rate: '4.79%',
    tickerTag: 'PT fixed',
    chipSub: 'PT fixed',
  },
  {
    protocol: 'Venus',
    chain: 'BSC',
    rate: '5.41%',
    tickerTag: 'supply',
    chipSub: 'supply APY',
  },
  {
    protocol: 'Lido',
    chain: 'ETH',
    rate: '3.05%',
    tickerTag: 'stETH',
    chipSub: 'stETH',
  },
]

/** Subset rendered as chips in the problem section. */
export const chipRates = demoRates.slice(0, 6)
