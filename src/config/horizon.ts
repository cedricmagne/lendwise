/**
 * Global horizon configuration.
 * Add an entry here to expose it in the Supply/Borrow table selectors
 * AND in the optimizer's time-horizon button group.
 */
export const HORIZON_OPTIONS = [
  {
    key: 'intraday',
    label: '1D',
    days: 1,
    apyKey: 'apy',
    rewardsKey: 'apyRewards',
    columnHeader: 'APY',
  },
  {
    key: 'short',
    label: '7D',
    days: 7,
    apyKey: 'apyDaily',
    rewardsKey: 'apyRewardsDaily',
    columnHeader: 'APY (7D avg)',
  },
  {
    key: 'medium',
    label: '1M',
    days: 30,
    apyKey: 'apyMonthly',
    rewardsKey: 'apyRewardsMonthly',
    columnHeader: 'APY (1M avg)',
  },
  {
    key: 'long',
    label: '1Y',
    days: 365,
    apyKey: 'apyYearly',
    rewardsKey: 'apyRewardsYearly',
    columnHeader: 'APY (1Y avg)',
  },
] as const

export type HorizonKey = (typeof HORIZON_OPTIONS)[number]['key']

/** Record-style lookup — same data, keyed by `HorizonKey`. */
export const HORIZON_CONFIG = Object.fromEntries(
  HORIZON_OPTIONS.map((h) => [h.key, h])
) as Record<HorizonKey, (typeof HORIZON_OPTIONS)[number]>
