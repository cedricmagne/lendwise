'use client'

import { useMemo, useState, useTransition } from 'react'

import {
  AlertCircle,
  ArrowUpRightFromSquare,
  Check,
  Copy,
  Gift,
  Percent,
  TrendingUp,
  X,
} from 'lucide-react'
import posthog from 'posthog-js'
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceArea,
  ReferenceLine,
  XAxis,
  YAxis,
} from 'recharts'

import {
  loadMarketBorrowHistoryRates,
  loadMarketSupplyHistoryRates,
} from '@/app/actions/market-rates.actions'
import {
  type ProductHistoryPoint,
  loadProductApyHistory,
  loadProductAvailability,
} from '@/app/actions/product-apy-history.actions'
import { NetworkBadge } from '@/components/badge/NetworkBadge'
import { ProtocolBadge } from '@/components/badge/ProtocolBadge'
import { TokenIcon } from '@/components/icon'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from '@/components/ui/chart'
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from '@/components/ui/drawer'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { useCurrency } from '@/contexts'
import { useIsMobile } from '@/hooks/useMobile'
import {
  type DeadStretch,
  type Period,
  deadStretches,
  withGaps,
} from '@/lib/chart-availability'
import { formatCompactCurrency } from '@/lib/format-currency'
import {
  type BorrowProduct,
  type SupplyProduct,
  TIMEFRAME_OPTIONS,
  type TimeframeLabel,
} from '@/types'

type ProductKind = 'supply' | 'borrow'

interface SeriesDef {
  key: keyof ProductHistoryPoint
  label: string
  color: string
  variant: 'area' | 'line'
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const fmtPct = (v: number | undefined, digits = 2) =>
  v === undefined || !Number.isFinite(v)
    ? '—'
    : v < 0.0001 && v > 0
      ? '<0.01%'
      : v > 10
        ? '>1000%'
        : `${(v * 100).toFixed(digits)}%`

const mean = (xs: number[]) =>
  xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0

const lastDefined = (
  points: ProductHistoryPoint[],
  key: keyof ProductHistoryPoint
): number | null => {
  for (let i = points.length - 1; i >= 0; i--) {
    const v = points[i][key]
    if (typeof v === 'number') return v
  }
  return null
}

// ─── Chart ─────────────────────────────────────────────────────────────────

function HistoryChart({
  data,
  series,
  timeframe,
  valueFormatter,
  height = 170,
  dead = [],
}: {
  data: ProductHistoryPoint[]
  series: SeriesDef[]
  timeframe: TimeframeLabel
  valueFormatter: (value: number) => string
  height?: number
  /** Stretches during which the pool was not listed by its protocol. */
  dead?: DeadStretch[]
}) {
  const config = Object.fromEntries(
    series.map((s) => [s.key, { label: s.label, color: s.color }])
  ) satisfies ChartConfig
  const hasData = data.length > 0

  // An empty point inside each dead stretch. Recharts breaks a line on a point
  // that EXISTS with a nil value, and jumps over a timestamp that is simply
  // absent — so this, plus connectNulls={false}, cuts the line at delistings and
  // ONLY there. Collection gaps stay absent from the array and go on being
  // bridged, which is right: the market existed then, we just missed the reading.
  const chartData = withGaps(data, dead)

  return (
    <div className="relative w-full" style={{ height }}>
      <ChartContainer config={config} className="h-full w-full">
        <ComposedChart
          accessibilityLayer
          data={chartData}
          margin={{ top: 8, right: 8, left: 4, bottom: 0 }}
        >
          <CartesianGrid vertical={false} />
          {/* Name the hole. A bare break reads as "the chart is broken"; the
              band says the pool was not there. */}
          {dead.map((d) => (
            <ReferenceArea
              key={`${d.from}-${d.to}`}
              x1={d.from}
              x2={d.to}
              fill="var(--muted-foreground)"
              fillOpacity={0.1}
              stroke="none"
              ifOverflow="hidden"
              label={{
                value: 'Not listed',
                position: 'insideTop',
                fontSize: 10,
                fill: 'var(--muted-foreground)',
              }}
            />
          ))}
          <XAxis
            dataKey="timestamp"
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            minTickGap={32}
            tick={{ fill: 'var(--muted-foreground)', fontSize: 11 }}
            tickFormatter={(value) =>
              new Date(value * 1000).toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric',
              })
            }
          />
          <YAxis
            width={52}
            tickLine={false}
            axisLine={false}
            tick={{ fill: 'var(--muted-foreground)', fontSize: 11 }}
            tickFormatter={(value) => valueFormatter(Number(value))}
          />
          <ChartTooltip
            cursor={false}
            content={
              <ChartTooltipContent
                indicator="line"
                labelFormatter={(value) =>
                  new Date(Number(value) * 1000).toLocaleDateString('en-US', {
                    month: 'short',
                    day: 'numeric',
                    year: 'numeric',
                    ...(timeframe === '24h' && {
                      hour: 'numeric',
                      minute: 'numeric',
                    }),
                  })
                }
                valueFormatter={(value) => valueFormatter(Number(value))}
              />
            }
          />
          {series.map((s) =>
            s.variant === 'area' ? (
              <Area
                key={s.key}
                dataKey={s.key}
                type="natural"
                stroke={`var(--color-${s.key})`}
                fill={`var(--color-${s.key})`}
                fillOpacity={0.25}
                strokeWidth={2}
                isAnimationActive={false}
                connectNulls={false}
              />
            ) : (
              <Line
                key={s.key}
                dataKey={s.key}
                type="natural"
                stroke={`var(--color-${s.key})`}
                strokeWidth={1.5}
                dot={false}
                isAnimationActive={false}
                connectNulls={false}
              />
            )
          )}
        </ComposedChart>
      </ChartContainer>
      {!hasData && (
        <div className="text-muted-foreground pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-sm">
          <AlertCircle className="mb-2 h-6 w-6 opacity-40" />
          <p>No data available</p>
        </div>
      )}
    </div>
  )
}

// ─── APY breakdown (stacked + toggleable) ────────────────────────────────────

type ApyComponentKey = 'base' | 'rewards' | 'fees'

interface ApyComponent {
  key: ApyComponentKey
  label: string
  color: string
}

/**
 * Stacked APY chart with a toggleable legend.
 *
 * `net = base − fee + reward` (supply) / `base + fee − reward` (borrow).
 * `fees` is the absolute fee APY per slot (the pipeline stores it directly for
 * every protocol). Components are drawn as signed areas (positive stacks up,
 * negative stacks down) and the Net line is recomputed from whichever components
 * are currently enabled — disabling "Fees" lifts Net up.
 */
function ApyBreakdownChart({
  data,
  kind,
  timeframe,
  valueFormatter,
  height = 170,
  dead = [],
}: {
  data: ProductHistoryPoint[]
  kind: ProductKind
  timeframe: TimeframeLabel
  valueFormatter: (value: number) => string
  height?: number
  /** Stretches during which the pool was not listed by its protocol. */
  dead?: DeadStretch[]
}) {
  const hasRewards = data.some((p) => p.rewards > 0)
  const hasFees = data.some((p) => p.fees > 0)

  const components: ApyComponent[] = [
    { key: 'base', label: 'Base', color: 'var(--chart-2)' },
    ...(hasRewards
      ? [{ key: 'rewards' as const, label: 'Rewards', color: 'var(--chart-3)' }]
      : []),
    ...(hasFees
      ? [{ key: 'fees' as const, label: 'Fees', color: 'var(--chart-4)' }]
      : []),
  ]

  const [visible, setVisible] = useState<Record<ApyComponentKey, boolean>>({
    base: true,
    rewards: true,
    fees: true,
  })

  const config = {
    net: { label: 'Net', color: 'var(--chart-1)' },
    base: { label: 'Base', color: 'var(--chart-2)' },
    rewards: { label: 'Rewards', color: 'var(--chart-3)' },
    fees: { label: 'Fees', color: 'var(--chart-4)' },
  } satisfies ChartConfig

  const chartData = useMemo(
    () =>
      withGaps(
        data.map((p) => {
          const feeAbs = p.fees // absolute fee APY (pipeline-stored)
          const rewardsSigned = kind === 'supply' ? p.rewards : -p.rewards
          const feeSigned = kind === 'supply' ? -feeAbs : feeAbs

          const netBase = visible.base ? p.base : 0
          const netRewards = hasRewards && visible.rewards ? rewardsSigned : 0
          const netFees = hasFees && visible.fees ? feeSigned : 0

          return {
            timestamp: p.timestamp,
            base: p.base,
            rewards: rewardsSigned,
            fees: feeSigned,
            net: netBase + netRewards + netFees,
          }
        }),
        dead
      ),
    [data, kind, visible, hasRewards, hasFees, dead]
  )

  const hasData = data.length > 0

  return (
    <div className="flex flex-col gap-2">
      {/* Toggleable legend */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        <span className="text-muted-foreground flex items-center gap-1.5">
          <span
            className="h-2 w-2 rounded-full"
            style={{ backgroundColor: 'var(--chart-1)' }}
          />
          Net
        </span>
        {components.map((c) => {
          const on = visible[c.key]
          return (
            <button
              key={c.key}
              type="button"
              onClick={() => setVisible((v) => ({ ...v, [c.key]: !v[c.key] }))}
              className={`flex cursor-pointer items-center gap-1.5 transition-opacity ${
                on
                  ? 'text-foreground'
                  : 'text-muted-foreground line-through opacity-50'
              }`}
            >
              <span
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: c.color }}
              />
              {c.label}
            </button>
          )
        })}
      </div>

      <div className="relative w-full" style={{ height }}>
        <ChartContainer config={config} className="h-full w-full">
          <ComposedChart
            accessibilityLayer
            data={chartData}
            margin={{ top: 8, right: 8, left: 4, bottom: 0 }}
          >
            <CartesianGrid vertical={false} />
            <XAxis
              dataKey="timestamp"
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              minTickGap={32}
              tick={{ fill: 'var(--muted-foreground)', fontSize: 11 }}
              tickFormatter={(value) =>
                new Date(value * 1000).toLocaleDateString('en-US', {
                  month: 'short',
                  day: 'numeric',
                })
              }
            />
            <YAxis
              width={52}
              tickLine={false}
              axisLine={false}
              tick={{ fill: 'var(--muted-foreground)', fontSize: 11 }}
              tickFormatter={(value) => valueFormatter(Number(value))}
            />
            <ReferenceLine y={0} stroke="var(--border)" strokeWidth={1} />
            {dead.map((d) => (
              <ReferenceArea
                key={`${d.from}-${d.to}`}
                x1={d.from}
                x2={d.to}
                fill="var(--muted-foreground)"
                fillOpacity={0.1}
                stroke="none"
                ifOverflow="hidden"
                label={{
                  value: 'Not listed',
                  position: 'insideTop',
                  fontSize: 10,
                  fill: 'var(--muted-foreground)',
                }}
              />
            ))}
            <ChartTooltip
              cursor={false}
              content={
                <ChartTooltipContent
                  indicator="line"
                  labelFormatter={(value) =>
                    new Date(Number(value) * 1000).toLocaleDateString('en-US', {
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric',
                      ...(timeframe === '24h' && {
                        hour: 'numeric',
                        minute: 'numeric',
                      }),
                    })
                  }
                  valueFormatter={(value) => valueFormatter(Number(value))}
                />
              }
            />
            {components.map((c) =>
              visible[c.key] ? (
                <Area
                  key={c.key}
                  dataKey={c.key}
                  stackId="apy"
                  type="natural"
                  stroke={`var(--color-${c.key})`}
                  fill={`var(--color-${c.key})`}
                  fillOpacity={0.3}
                  strokeWidth={1}
                  isAnimationActive={false}
                  connectNulls={false}
                />
              ) : null
            )}
            <Line
              dataKey="net"
              type="natural"
              stroke="var(--color-net)"
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
              connectNulls={false}
            />
          </ComposedChart>
        </ChartContainer>
        {!hasData && (
          <div className="text-muted-foreground pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-sm">
            <AlertCircle className="mb-2 h-6 w-6 opacity-40" />
            <p>No data available</p>
          </div>
        )}
      </div>
    </div>
  )
}

/** Click-to-copy a productId, with brief "copied" feedback. */
function CopyIdButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value)
          setCopied(true)
          setTimeout(() => setCopied(false), 1200)
        } catch {
          /* clipboard unavailable — ignore */
        }
      }}
      title="Copy product ID"
      aria-label="Copy product ID"
      className="hover:bg-secondary text-muted-foreground hover:text-foreground shrink-0 rounded p-1 transition-colors"
    >
      {copied ? (
        <Check className="h-3.5 w-3.5 text-emerald-400" />
      ) : (
        <Copy className="h-3.5 w-3.5" />
      )}
    </button>
  )
}

function SectionTitle({
  children,
  icon,
}: {
  children: React.ReactNode
  icon?: React.ReactNode
}) {
  return (
    <div className="text-foreground flex items-center gap-2 text-sm font-medium">
      {children}
      {icon}
    </div>
  )
}

function Legend({ series }: { series: SeriesDef[] }) {
  return (
    <div className="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
      {series.map((s) => (
        <span key={s.key} className="flex items-center gap-1.5">
          <span
            className="h-2 w-2 rounded-full"
            style={{ backgroundColor: s.color }}
          />
          {s.label}
        </span>
      ))}
    </div>
  )
}

function StatCard({
  label,
  value,
  accent,
}: {
  label: string
  value: string
  accent?: boolean
}) {
  return (
    <div className="bg-muted/50 rounded-lg p-3">
      <div className="text-muted-foreground text-xs">{label}</div>
      <div
        className={`text-sm font-semibold ${accent ? 'text-emerald-400' : ''}`}
      >
        {value}
      </div>
    </div>
  )
}

// ─── Drawer ────────────────────────────────────────────────────────────────

const NET_ONLY_SERIES: SeriesDef[] = [
  { key: 'net', label: 'Net APY', color: 'var(--chart-1)', variant: 'area' },
]

export function ProductDetailDrawer({
  item,
  kind,
}: {
  item: SupplyProduct | BorrowProduct
  kind: ProductKind
}) {
  const isMobile = useIsMobile()
  const { baseCurrency, rate } = useCurrency()
  const [points, setPoints] = useState<ProductHistoryPoint[]>([])
  const [periods, setPeriods] = useState<Period[]>([])
  // NOT `window` — that would shadow the global inside a client component.
  const [chartWindow, setChartWindow] = useState<{
    from: number
    to: number
  } | null>(null)
  const [selectedTimeframe, setSelectedTimeframe] =
    useState<TimeframeLabel>('7d')
  const [usedFallback, setUsedFallback] = useState(false)
  const [pending, startTransition] = useTransition()

  const collaterals = 'collaterals' in item ? item.collaterals : ([] as never[])

  const handleLoad = (label: TimeframeLabel) => {
    const option = TIMEFRAME_OPTIONS.find((o) => o.label === label)
    if (!option) return

    startTransition(async () => {
      setSelectedTimeframe(label)
      const now = Math.floor(Date.now() / 1000)
      const fromTimestamp = option.days ? now - option.days * 24 * 60 * 60 : 0
      setChartWindow({ from: fromTimestamp, to: now })

      try {
        // Preferred: our own pipeline series (full breakdown + market state).
        if (item.productId) {
          // Availability rides along with the series: the chart cannot know where
          // to CUT its line without it, and would otherwise draw straight through
          // a stretch in which the pool was not listed at all.
          const [pts, avail] = await Promise.all([
            loadProductApyHistory({
              productId: item.productId,
              interval: label,
              fromTimestamp,
            }),
            loadProductAvailability(item.productId),
          ])
          if (pts.length > 0) {
            setPoints(pts)
            setPeriods(avail)
            setUsedFallback(false)
            return
          }
        }

        // Fallback: live provider rate only (no breakdown / market state).
        const rates =
          kind === 'supply'
            ? await loadMarketSupplyHistoryRates({
                protocolId: item.protocol,
                chainId: item.poolChainId,
                poolId: item.poolId,
                tokenId: item.assetAddress,
                interval: label,
                fromTimestamp,
              })
            : await loadMarketBorrowHistoryRates({
                protocolId: item.protocol,
                chainId: item.poolChainId,
                poolId: item.poolId,
                tokenId: item.assetAddress,
                interval: label,
                fromTimestamp,
              })

        setPoints(
          rates.map((r) => ({
            timestamp: r.timestamp,
            net: r.rate,
            base: r.rate,
            rewards: 0,
            fees: 0,
            supplyAssetsUsd: null,
            borrowAssetsUsd: null,
            collateralAssetsUsd: null,
            utilization: null,
            priceUsd: null,
            rewardItems: [],
          }))
        )
        // The provider's own history — it carries no availability, so no stretch
        // is claimed dead and the chart behaves exactly as it did before.
        setPeriods([])
        setUsedFallback(true)
      } catch (error) {
        console.error('Failed to load product history:', error)
        setPoints([])
        setPeriods([])
      }
    })
  }

  /**
   * Where the pool was NOT listed. Empty when we have no availability history —
   * "we don't know" must not render as "it was dead" (see deadStretches).
   */
  const dead = useMemo(
    () =>
      chartWindow
        ? deadStretches(periods, chartWindow.from, chartWindow.to)
        : [],
    [periods, chartWindow]
  )

  // Derived stats — computed over the REAL observations, never the chart array:
  // the gap markers carry no values, and averaging them in would drag the mean
  // toward zero for every pool that was ever delisted.
  const avgNet = mean(points.map((p) => p.net))

  // Utilization (used / supplied). Pipeline history doesn't carry it for every
  // protocol (Morpho vaults report 0), so derive from deposit vs liquidity —
  // same formula as the products tables.
  const historyUtil = lastDefined(points, 'utilization')
  const derivedUtil =
    item.assetAmountUsd > 0
      ? (item.assetAmountUsd - item.liquidityAmountUsd) / item.assetAmountUsd
      : null
  const latestUtil = derivedUtil ?? historyUtil

  // Asset price. Prefer the product's own USD price from the list query
  // (Morpho's pipeline history has no priceUsd), then pipeline history
  // (Aave/Compound), then derive from USD amount / token amount as a last
  // resort.
  const itemPrice =
    'assetPriceUsd' in item && item.assetPriceUsd ? item.assetPriceUsd : null
  const historyPrice = lastDefined(points, 'priceUsd')
  const assetAmountTokens = Number(item.assetAmount) / 10 ** item.assetDecimals
  const derivedPrice =
    assetAmountTokens > 0 ? item.assetAmountUsd / assetAmountTokens : null
  const latestPrice =
    itemPrice ??
    (historyPrice !== null && historyPrice > 0 ? historyPrice : derivedPrice)
  const latestRewardItems =
    [...points].reverse().find((p) => p.rewardItems.length > 0)?.rewardItems ??
    []

  const tvlKey: keyof ProductHistoryPoint =
    kind === 'supply' ? 'supplyAssetsUsd' : 'borrowAssetsUsd'
  // Keep every timestamp (not just ones with a real reading) so the chart's x
  // axis spans the same range as the Supply APY chart above it — Recharts gaps
  // a null value instead of connecting through it (connectNulls={false}), same
  // mechanism the "dead stretch" cut already relies on. Filtering the array
  // itself, like before, shrank the domain down to whatever few points still
  // had data — a 1M selection could render as a 5-day-wide chart.
  // Some products (Morpho vaults) never report utilization — the pipeline stores
  // 0 for every slot. A flat-zero line reads as a real "0% utilized" history,
  // which is wrong; hide the chart when no slot carries a reading. The stat card
  // still shows the current value, derived from deposits vs liquidity.
  const hasUtilizationHistory = points.some((p) => (p.utilization ?? 0) > 0)
  // Same reasoning for TVL: a backfilled/healed point whose provider carries no
  // market state at all (e.g. Aave's history API returns rates only) used to be
  // stored as a literal 0 rather than left unknown — a flat-zero line read as a
  // real "$0 deposited" history. Fixed at the source (null, not 0), but this
  // guards existing zero-filled rows too instead of rendering a false flat line.
  const hasTvlHistory = points.some((p) => ((p[tvlKey] as number) ?? 0) > 0)

  // Deposits on BOTH sides: the card below is bound to `assetAmount`, which is
  // the market's total SUPPLY for a borrow product too (`borrow-products.ts`
  // sets it from `state.supplyAssets`). Labelling it "Total Borrowed" made the
  // drawer contradict itself — 209.21K "borrowed" next to 0% utilization — and
  // contradict the table, which calls the same field "Deposits". The borrowed
  // figure has its own chart below, fed by `borrowAssetsUsd`.
  const sizeLabel = 'Total Deposits'
  const assetLabel = kind === 'supply' ? 'Asset' : 'Loan Asset'
  const apyLabel = kind === 'supply' ? 'Supply APY' : 'Borrow APY'

  const fmtUsd = (v: number) => formatCompactCurrency(v * rate, baseCurrency)

  return (
    <Drawer direction={isMobile ? 'bottom' : 'right'}>
      <DrawerTrigger asChild>
        <Button
          variant="link"
          className="text-foreground decoration-muted-foreground w-fit cursor-pointer px-0 text-left text-xs underline decoration-dashed underline-offset-6"
          onClick={() => {
            posthog.capture('product_details_viewed', {
              product_kind: kind,
              pool_name: item.poolName,
              protocol: item.protocol,
              network: item.network,
              asset_symbol: item.assetSymbol,
              apy: item.apy,
            })
            handleLoad('7d')
          }}
        >
          {item.poolName}
        </Button>
      </DrawerTrigger>
      <DrawerContent>
        <DrawerHeader className="gap-1">
          <DrawerTitle className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-1">
              {item.poolName}
              {item.productId && <CopyIdButton value={item.productId} />}
            </span>
            <div className="flex shrink-0 items-center gap-1">
              {item.link && (
                <a
                  href={item.link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-muted-foreground hover:text-foreground p-1"
                >
                  <ArrowUpRightFromSquare size={15} />
                </a>
              )}
              <DrawerClose
                aria-label="Close"
                className="text-muted-foreground hover:text-foreground hover:bg-secondary cursor-pointer rounded p-1 transition-colors"
              >
                <X size={16} />
              </DrawerClose>
            </div>
          </DrawerTitle>
          <DrawerDescription asChild>
            <div className="flex flex-wrap gap-2">
              <ProtocolBadge protocol={item.protocol} />
              <NetworkBadge networkSlug={item.network} />
            </div>
          </DrawerDescription>
        </DrawerHeader>
        <Separator className="mb-4" />

        <div className="flex flex-col gap-5 overflow-y-auto px-4 pb-4 text-sm">
          {/* Stat cards */}
          <div className="grid grid-cols-3 gap-3">
            <StatCard label="Net APY" value={fmtPct(item.apy)} accent />
            <StatCard
              label={`Avg (${selectedTimeframe})`}
              value={points.length ? fmtPct(avgNet) : '—'}
            />
            <StatCard label={assetLabel} value={item.assetSymbol} />
            <StatCard
              label={sizeLabel}
              value={formatCompactCurrency(
                item.assetAmount,
                item.assetSymbol,
                item.assetDecimals
              )}
            />
            <StatCard
              label="Liquidity"
              value={formatCompactCurrency(
                item.liquidityAmount,
                item.assetSymbol,
                item.assetDecimals
              )}
            />
            <StatCard
              label="Utilization"
              value={latestUtil !== null ? fmtPct(latestUtil, 1) : '—'}
            />
          </div>

          {latestPrice !== null && (
            <div className="text-muted-foreground -mt-2 text-xs">
              {item.assetSymbol} price:{' '}
              <span className="text-foreground font-medium">
                {formatCompactCurrency(latestPrice * rate, baseCurrency)}
              </span>
            </div>
          )}

          {/* Collaterals (borrow only) */}
          {collaterals.length > 0 && (
            <div>
              <div className="text-muted-foreground mb-2 text-xs">
                Accepted Collaterals
              </div>
              <div className="flex flex-wrap gap-2">
                {collaterals.map((c) => (
                  <Badge key={c.symbol} variant="secondary">
                    <TokenIcon symbol={c.symbol} className="mr-1 h-3 w-3" />
                    {c.symbol}
                  </Badge>
                ))}
              </div>
            </div>
          )}

          {/* Reward breakdown */}
          {latestRewardItems.length > 0 && (
            <div>
              <SectionTitle icon={<Gift className="size-4" />}>
                Rewards
              </SectionTitle>
              <div className="mt-2 flex flex-col gap-1.5">
                {latestRewardItems.map((r, i) => (
                  <div
                    key={`${r.token.symbol}-${r.program ?? i}`}
                    className="bg-muted/40 flex items-center justify-between rounded-md px-3 py-2"
                  >
                    <div className="flex items-center gap-2">
                      <TokenIcon symbol={r.token.symbol} size={18} />
                      <span className="text-xs font-medium">
                        {r.token.symbol}
                      </span>
                      <Badge
                        variant="outline"
                        className="text-[10px] capitalize"
                      >
                        {r.source}
                      </Badge>
                    </div>
                    <span className="font-mono text-xs font-semibold text-emerald-400">
                      +{fmtPct(r.apy)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <Separator />

          {/* Timeframe */}
          <div className="flex items-center justify-between gap-2">
            <SectionTitle icon={<TrendingUp className="size-4" />}>
              {apyLabel}
            </SectionTitle>
            <Select
              value={selectedTimeframe}
              onValueChange={(value) => handleLoad(value as TimeframeLabel)}
            >
              <SelectTrigger className="h-7 w-20 text-xs">
                <SelectValue placeholder="Timeframe" />
              </SelectTrigger>
              <SelectContent align="end">
                {TIMEFRAME_OPTIONS.map((option) => (
                  <SelectItem
                    key={option.label}
                    value={option.label}
                    className="text-xs"
                  >
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {pending ? (
            <div className="text-muted-foreground flex h-42.5 items-center justify-center text-sm">
              Loading…
            </div>
          ) : (
            <>
              {/* APY breakdown */}
              {usedFallback ? (
                <div className="flex flex-col gap-2">
                  <Legend series={NET_ONLY_SERIES} />
                  <HistoryChart
                    data={points}
                    series={NET_ONLY_SERIES}
                    timeframe={selectedTimeframe}
                    valueFormatter={(v) => fmtPct(v)}
                    dead={dead}
                  />
                </div>
              ) : (
                <ApyBreakdownChart
                  data={points}
                  kind={kind}
                  timeframe={selectedTimeframe}
                  valueFormatter={(v) => fmtPct(v)}
                  dead={dead}
                />
              )}

              {usedFallback ? (
                <p className="text-muted-foreground text-xs">
                  Detailed breakdown unavailable for this market — showing the
                  provider&apos;s net rate only.
                </p>
              ) : (
                <>
                  {/* TVL / size — only when the pipeline carries real readings
                      (backfilled points with no market state are hidden). */}
                  {hasTvlHistory && (
                    <>
                      <Separator />
                      <SectionTitle>
                        {kind === 'supply'
                          ? 'Total Deposits'
                          : 'Total Borrowed'}{' '}
                        (USD)
                      </SectionTitle>
                      <HistoryChart
                        data={points}
                        series={[
                          {
                            key: tvlKey,
                            label: 'USD',
                            color: 'var(--chart-2)',
                            variant: 'area',
                          },
                        ]}
                        timeframe={selectedTimeframe}
                        valueFormatter={fmtUsd}
                        dead={dead}
                      />
                    </>
                  )}

                  {/* Utilization — only when the pipeline carries real readings
                      (Morpho vaults report a flat 0 and are hidden). */}
                  {hasUtilizationHistory && (
                    <>
                      <Separator />
                      <SectionTitle icon={<Percent className="size-4" />}>
                        Utilization
                      </SectionTitle>
                      <HistoryChart
                        data={points}
                        series={[
                          {
                            key: 'utilization',
                            label: 'Utilization',
                            color: 'var(--chart-5)',
                            variant: 'area',
                          },
                        ]}
                        timeframe={selectedTimeframe}
                        valueFormatter={(v) => fmtPct(v, 1)}
                        dead={dead}
                      />
                    </>
                  )}
                </>
              )}
            </>
          )}
        </div>
      </DrawerContent>
    </Drawer>
  )
}
