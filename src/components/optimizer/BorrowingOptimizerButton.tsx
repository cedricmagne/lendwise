'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import {
  ArrowLeftRight,
  CheckCircle2,
  CreditCard,
  GripVertical,
  Loader2,
  Wallet,
  Zap,
} from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import posthog from 'posthog-js'
import {
  Area,
  AreaChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

import {
  type PricePoint,
  loadLatestPrice,
  loadPriceReturnHistory,
} from '@/app/actions/price-return-history.actions'
import { NetworkBadge } from '@/components/badge/NetworkBadge'
import { ProtocolBadge } from '@/components/badge/ProtocolBadge'
import { TokenIcon } from '@/components/icon'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { HORIZON_OPTIONS, type HorizonKey } from '@/config/horizon'
import {
  type MarketData,
  type OptimizationResponse,
  getBreakpointsBorrow,
  getBreakpointsCollateral,
  optimizeBorrow,
  optimizeCollateral,
} from '@/lib/api/optimizer'
import { formatCompactCurrency } from '@/lib/format-currency'
import type { BorrowProduct } from '@/types'

// ============================================================================
// Constants & types
// ============================================================================

const DEFAULT_MAX_LTV = 0.8

type BorrowMode = 'collateral_target' | 'loan_target'
type ViewStep = 'buffer' | 'recommendedLtv' | 'configure'

const BORROW_MODES = [
  {
    id: 'collateral_target' as BorrowMode,
    Icon: Wallet,
    label: 'Fixed Collateral',
    desc: 'I have a collateral amount — maximize loan size or minimize cost',
    color: 'text-primary',
    activeBg: 'bg-primary/10 border-primary/30',
  },
  {
    id: 'loan_target' as BorrowMode,
    Icon: CreditCard,
    label: 'Fixed Loan',
    desc: 'I need a loan amount — minimize collateral required or minimize cost',
    color: 'text-cyan-400',
    activeBg: 'bg-cyan-400/10 border-cyan-400/30',
  },
]

// Objective slider stops are omega values (0 = min cost … 1 = max size /
// min collateral). They are computed by the backend per market set
// (/breakpoints/borrow|collateral); this list is only the fallback used while
// they load or if the request fails.
const DEFAULT_OMEGAS = [0, 0.33, 0.67, 1]

/** Sort, dedupe and clamp the backend omega breakpoints to [0, 1]. */
function sanitizeOmegas(raw: number[]): number[] {
  const cleaned = Array.from(
    new Set(
      raw
        .filter((b) => Number.isFinite(b))
        .map((b) => Math.max(0, Math.min(1, b)))
    )
  ).sort((a, b) => a - b)
  return cleaned.length >= 2 ? cleaned : DEFAULT_OMEGAS
}

/** Label for an objective stop: semantic at the ends, omega value in between. */
function objectiveLabel(
  i: number,
  count: number,
  omega: number,
  mode: BorrowMode
): string {
  if (i === 0) return 'Min cost'
  if (i === count - 1)
    return mode === 'loan_target' ? 'Min collateral' : 'Max size'
  return omega.toFixed(2)
}

const ALLOCATION_COLORS = [
  '#3b82f6',
  '#06b6d4',
  '#8b5cf6',
  '#10b981',
  '#f59e0b',
]

// ============================================================================
// Price chart helpers
// ============================================================================

// Plot area's vertical bounds = [margin.top, CHART_HEIGHT - margin.bottom].
// No YAxis padding is used: data extremes (minReturn / maxReturn) render at
// exactly these edges, keeping recharts ReferenceLine overlays perfectly
// aligned with the rendered data line.
const CHART_MARGIN = { top: 30, right: 4, left: 4, bottom: 36 }
const CHART_HEIGHT = 290
const TICK_COLOR = '#94a3b8'
const GRID_COLOR = '#334155'
const YAXIS_WIDTH = 68

function formatReturnPct(v: number): string {
  const abs = Math.abs(v)
  const sign = v > 0 ? '+' : v < 0 ? '-' : ''
  if (abs >= 100) return `${sign}${abs.toFixed(0)}%`
  if (abs >= 10) return `${sign}${abs.toFixed(1)}%`
  return `${sign}${abs.toFixed(2)}%`
}

function AllocationTooltip({
  active,
  payload,
}: {
  active?: boolean
  payload?: { name: string; value: number }[]
}) {
  if (!active || !payload?.length) return null
  return (
    <div className="border-border bg-popover rounded-lg border px-3 py-2 text-xs shadow-md">
      <p className="text-foreground max-w-40 truncate font-medium">
        {payload[0].name}
      </p>
      <p className="text-muted-foreground font-mono">
        {payload[0].value.toFixed(0)}%
      </p>
    </div>
  )
}

function ReturnTooltip({
  active,
  payload,
  pairLabel,
}: {
  active?: boolean
  payload?: { value: number; payload: { date: string; returnPct: number } }[]
  pairLabel: string
}) {
  if (!active || !payload?.length) return null
  const point = payload[0].payload
  const color =
    point.returnPct > 0
      ? '#10b981'
      : point.returnPct < 0
        ? '#ef4444'
        : undefined
  return (
    <div className="border-border bg-popover/95 rounded-lg border px-3 py-2 text-xs shadow-md backdrop-blur-sm">
      <p className="text-muted-foreground mb-0.5 text-[10px] tracking-wider uppercase">
        {point.date}
      </p>
      <p
        className="font-mono text-sm font-semibold"
        style={color ? { color } : undefined}
      >
        {formatReturnPct(point.returnPct)}{' '}
        <span className="text-muted-foreground text-[10px] font-normal">
          {pairLabel}
        </span>
      </p>
    </div>
  )
}

// ============================================================================
// Component
// ============================================================================

interface BorrowingOptimizerViewProps {
  markets: BorrowProduct[]
  selectedCollateralSymbol?: string
  onBack?: () => void
  onViewStepChange?: (step: ViewStep) => void
}

export function BorrowingOptimizerView({
  markets,
  selectedCollateralSymbol,
  onBack,
  onViewStepChange,
}: BorrowingOptimizerViewProps) {
  // --- Optimizer state ---
  const [mode, setMode] = useState<BorrowMode>('collateral_target')
  const [objectiveIndex, setObjectiveIndex] = useState(0)
  // Omega stops for the objective slider, computed by the backend.
  const [objectiveOmegas, setObjectiveOmegas] =
    useState<number[]>(DEFAULT_OMEGAS)
  const [amount, setAmount] = useState('100')
  const [horizon, setHorizon] = useState<HorizonKey>('medium')
  const [result, setResult] = useState<OptimizationResponse | null>(null)
  const [isOptimizing, setIsOptimizing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [ran, setRan] = useState(false)
  const [viewStep, setViewStep] = useState<ViewStep>('buffer')

  // --- Objective slider drag ---
  const sliderTrackRef = useRef<HTMLDivElement>(null)
  const [isSliderDragging, setIsSliderDragging] = useState(false)

  // --- Price buffer state ---
  const [priceData, setPriceData] = useState<PricePoint[]>([])
  const [isPriceLoading, setIsPriceLoading] = useState(false)

  // Resolved collateral token for the Fixed Collateral mode — the amount input
  // is denominated in this token, converted to USD before hitting the optimizer.
  const collateralSymbol =
    selectedCollateralSymbol ?? markets[0]?.collaterals[0]?.symbol ?? '?'

  // Latest USD spot price of the collateral token (null while loading / if
  // unavailable). Read via a ref inside async handlers.
  const [collateralPrice, setCollateralPrice] = useState<number | null>(null)
  const collateralPriceRef = useRef<number | null>(null)
  collateralPriceRef.current = collateralPrice

  useEffect(() => {
    const sym = selectedCollateralSymbol ?? markets[0]?.collaterals[0]?.symbol
    if (!sym) return
    setCollateralPrice(null)
    loadLatestPrice(sym).then(setCollateralPrice)
  }, [markets, selectedCollateralSymbol])

  // Loan token (the borrowed asset) — shared across all borrow markets. In
  // Fixed Loan mode the amount input is denominated in this token, converted to
  // USD before hitting the optimizer (which works in USD value units).
  const loanSymbol = markets[0]?.assetSymbol ?? '?'
  const [loanPrice, setLoanPrice] = useState<number | null>(null)
  const loanPriceRef = useRef<number | null>(null)
  loanPriceRef.current = loanPrice

  useEffect(() => {
    const sym = markets[0]?.assetSymbol
    if (!sym) return
    setLoanPrice(null)
    loadLatestPrice(sym).then(setLoanPrice)
  }, [markets])

  const { domainMin, domainMax, recommendedBuffer } = useMemo(() => {
    const vals = priceData.map((p) => p.returnPct)
    const minVal = vals.length > 0 ? Math.min(...vals) : 0
    const maxVal = vals.length > 0 ? Math.max(...vals) : 1
    // Extend the Y domain well below the observed minimum so the user has
    // room to drag the buffer into very conservative territory (much lower
    // than the worst observed return). The top of the domain is pinned to
    // maxVal so the highest point sits exactly on the upper bound of the
    // chart. Using domain padding (not YAxis `padding` prop, which recharts
    // v2 interprets as data units with unreliable pixel conversion) keeps
    // the scale fully under control.
    const range = Math.max(maxVal - minVal, 0.01)
    const padBottom = range * 1.5
    return {
      minReturn: minVal,
      maxReturn: maxVal,
      domainMin: minVal - padBottom,
      domainMax: maxVal,
      // Recommended buffer = buffer = min(0%, worst observed daily return).
      // In practice, the worst daily return is negative so the recommended
      // line sits at the lowest point of the curve (most conservative).
      recommendedBuffer: Math.min(0, minVal),
    }
  }, [priceData])

  // --- User-adjustable buffer (defaults to recommendedBuffer) ---
  const [buffer, setBuffer] = useState(0)
  const [isDragging, setIsDragging] = useState(false)
  const chartRef = useRef<HTMLDivElement>(null)

  // Editable buffer field — mirrors `buffer` (shown as a positive drawdown %),
  // but holds its own string while the user is typing so the caret/decimals
  // aren't clobbered by drag-driven re-renders.
  const [bufferInput, setBufferInput] = useState('')
  const bufferInputFocused = useRef(false)

  useEffect(() => {
    if (bufferInputFocused.current) return
    // `buffer` is already in percent units (same scale as the chart returns).
    setBufferInput(priceData.length > 0 ? Math.abs(buffer).toFixed(2) : '')
  }, [buffer, priceData.length])

  // --- Per-market LTV info & user-adjustable recommended LTV ---
  const ltvInfo = useMemo(
    () =>
      markets.map((m) => {
        const colls = m.collaterals
        const coll =
          colls.find((c) => c.symbol === selectedCollateralSymbol) ?? colls[0]
        return {
          maxLtv: coll?.ltv ?? null,
          lltv: coll?.lltv ?? null,
          collateralSymbol: coll?.symbol ?? '?',
        }
      }),
    [markets, selectedCollateralSymbol]
  )

  const [recommendedLtvs, setRecommendedLtvs] = useState<number[]>([])

  useEffect(() => {
    // Recommended LTV = LLTV * (1 - buffer), where buffer is the liquidation
    // drawdown set in step 2 (stored as a non-positive percent, so take its
    // magnitude as a fraction). Falls back to max LTV when LLTV is absent.
    const bufferFraction = Math.min(1, Math.max(0, Math.abs(buffer) / 100))
    setRecommendedLtvs(
      ltvInfo.map((info) => {
        const base =
          info.lltv != null && info.lltv > 0
            ? info.lltv
            : info.maxLtv != null && info.maxLtv > 0
              ? info.maxLtv
              : DEFAULT_MAX_LTV
        return Math.max(0, base * (1 - bufferFraction))
      })
    )
  }, [ltvInfo, buffer])

  useEffect(() => {
    const collateralSymbol =
      selectedCollateralSymbol ?? markets[0]?.collaterals[0]?.symbol
    const loanSymbol = markets[0]?.assetSymbol
    if (!collateralSymbol || !loanSymbol) return
    setIsPriceLoading(true)
    loadPriceReturnHistory(collateralSymbol, loanSymbol)
      .then((data) => {
        setPriceData(data)
      })
      .finally(() => setIsPriceLoading(false))
  }, [markets, selectedCollateralSymbol])

  // Reset buffer to recommended whenever new data arrives.
  useEffect(() => {
    setBuffer(recommendedBuffer)
  }, [recommendedBuffer])

  useEffect(() => {
    onViewStepChange?.(viewStep)
  }, [viewStep, onViewStepChange])

  // Document-level drag listeners — translate mouseY into a buffer value
  // using the same domain recharts uses for the Y axis, so the line always
  // follows the cursor exactly.
  useEffect(() => {
    if (!isDragging) return

    const onMove = (e: MouseEvent) => {
      if (!chartRef.current) return
      const rect = chartRef.current.getBoundingClientRect()
      const effectiveTop = rect.top + CHART_MARGIN.top
      const effectiveHeight =
        rect.height - CHART_MARGIN.top - CHART_MARGIN.bottom
      const ratio =
        1 -
        Math.max(0, Math.min(1, (e.clientY - effectiveTop) / effectiveHeight))
      // The buffer represents an accepted drawdown before liquidation, so it
      // can never be positive — clamp to 0 even if the cursor goes higher.
      setBuffer(Math.min(0, domainMin + ratio * (domainMax - domainMin)))
    }

    const onUp = () => setIsDragging(false)

    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    return () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
  }, [isDragging, domainMin, domainMax])

  // Objective slider drag
  useEffect(() => {
    if (!isSliderDragging) return
    const getIndex = (clientX: number) => {
      if (!sliderTrackRef.current) return objectiveIndex
      const rect = sliderTrackRef.current.getBoundingClientRect()
      const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
      return Math.round(ratio * (objectiveOmegas.length - 1))
    }
    const onMove = (e: MouseEvent) => {
      setObjectiveIndex(getIndex(e.clientX))
    }
    const onUp = () => setIsSliderDragging(false)
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    return () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
  }, [isSliderDragging, objectiveIndex, objectiveOmegas.length])

  // --- Optimizer handlers ---

  // Market payload shared by the optimize and breakpoints endpoints.
  const buildMarketData = useCallback((): MarketData => {
    const apyKey = (HORIZON_OPTIONS.find((h) => h.key === horizon)?.apyKey ??
      'apy') as keyof BorrowProduct
    // The optimizer API rejects non-finite values with a 422 ("Input should
    // be a valid number") — JSON serializes NaN/Infinity/undefined to null.
    // Coerce every field to a finite number so the request is always valid.
    const finite = (v: unknown, fallback: number): number =>
      typeof v === 'number' && Number.isFinite(v) ? v : fallback
    return {
      max_ltv: markets.map((_, i) =>
        finite(recommendedLtvs[i], DEFAULT_MAX_LTV)
      ),
      rates: markets.map((m) => finite(m[apyKey], finite(m.apy, 0))),
      liquidity: markets.map((m) => finite(m.liquidityAmountUsd, 0)),
      price: 1,
    }
  }, [markets, recommendedLtvs, horizon])

  // The optimizer works in USD value units (price = 1, liquidity in USD). Both
  // modes denominate the input in a token (collateral / loan), so convert it to
  // USD with that token's spot price before sending.
  const toUsd = useCallback(
    (rawAmount: number): number =>
      mode === 'collateral_target'
        ? rawAmount * (collateralPriceRef.current ?? 0)
        : rawAmount * (loanPriceRef.current ?? 0),
    [mode]
  )

  // Any change to a parameter that feeds the optimizer (mode, amount, horizon,
  // LTV) invalidates the fetched omega breakpoints and the current allocation:
  // reset omega to 0 (index 0) and clear the result so the next "Run Optimizer"
  // re-fetches breakpoints from scratch.
  const resetResult = useCallback(() => {
    setResult(null)
    setRan(false)
    setError(null)
    setObjectiveIndex(0)
    setObjectiveOmegas(DEFAULT_OMEGAS)
  }, [])

  // Set while we programmatically move the objective slider back to 0 at the
  // start of a full run, so the objectiveIndex effect doesn't fire a second,
  // redundant optimize call.
  const suppressObjectiveRun = useRef(false)

  // Optimizer-only call (no breakpoints). Used both for the initial run and for
  // omega-only changes from the objective slider.
  const runOptimize = useCallback(
    async (
      omega: number,
      amountNum: number,
      marketData: MarketData
    ): Promise<OptimizationResponse> => {
      const response =
        mode === 'collateral_target'
          ? await optimizeBorrow({
              collateral_amount: amountNum,
              omega,
              markets: marketData,
            })
          : await optimizeCollateral({
              borrow_amount: amountNum,
              omega,
              markets: marketData,
            })
      if (!response.success) throw new Error('Optimization failed')
      return response
    },
    [mode]
  )

  const handleModeChange = (m: BorrowMode) => {
    setMode(m)
    resetResult()
  }

  // "Run Optimizer": full flow. Fetch the omega breakpoints for the current
  // config, surface the Objective slider, then optimize at omega = 0 (the first
  // stop). Falls back to DEFAULT_OMEGAS if the breakpoints endpoint is down.
  const handleRun = async () => {
    setError(null)
    setResult(null)
    setIsOptimizing(true)
    setRan(false)

    try {
      if (markets.length === 0) throw new Error('No markets selected')
      const amountNum = parseFloat(amount)
      if (!amountNum || amountNum <= 0) throw new Error('Enter a valid amount')
      const usdAmount = toUsd(amountNum)
      if (!usdAmount || usdAmount <= 0)
        throw new Error('Token price unavailable — try again')

      const marketData = buildMarketData()

      // 1. Fetch omega breakpoints for the current configuration.
      let omegas = DEFAULT_OMEGAS
      try {
        const bp =
          mode === 'collateral_target'
            ? await getBreakpointsBorrow({
                collateral_amount: usdAmount,
                markets: marketData,
              })
            : await getBreakpointsCollateral({
                borrow_amount: usdAmount,
                markets: marketData,
              })
        omegas = sanitizeOmegas(bp.breakpoints)
      } catch {
        omegas = DEFAULT_OMEGAS
      }
      // Move the slider to the first stop (omega = 0); suppress the resulting
      // effect only if the index actually changes, so a later slider move
      // isn't swallowed.
      suppressObjectiveRun.current = objectiveIndex !== 0
      setObjectiveOmegas(omegas)
      setObjectiveIndex(0)

      // 2. Optimize at the first stop (omega = 0).
      const response = await runOptimize(omegas[0] ?? 0, usdAmount, marketData)
      setResult(response)
      setRan(true)
      posthog.capture('borrow_optimizer_run', {
        mode,
        horizon,
        markets_count: markets.length,
        collateral_symbol: collateralSymbol,
        loan_symbol: loanSymbol,
        amount: parseFloat(amount) || 0,
        amount_usd: usdAmount,
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Optimization failed')
      posthog.captureException(err)
    } finally {
      setIsOptimizing(false)
    }
  }

  const ranRef = useRef(ran)
  ranRef.current = ran

  // Omega-only change from the objective slider: re-run the optimizer alone
  // (no breakpoints refetch). Reads current params via a ref so the effect only
  // re-subscribes on objectiveIndex.
  const runOptimizeOnly = async () => {
    if (!ranRef.current) return
    setError(null)
    setIsOptimizing(true)
    try {
      const amountNum = parseFloat(amount)
      if (!amountNum || amountNum <= 0) throw new Error('Enter a valid amount')
      const usdAmount = toUsd(amountNum)
      if (!usdAmount || usdAmount <= 0)
        throw new Error('Token price unavailable — try again')
      const marketData = buildMarketData()
      const omega = objectiveOmegas[objectiveIndex] ?? 0
      const response = await runOptimize(omega, usdAmount, marketData)
      setResult(response)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Optimization failed')
    } finally {
      setIsOptimizing(false)
    }
  }
  const runOptimizeOnlyRef = useRef(runOptimizeOnly)
  runOptimizeOnlyRef.current = runOptimizeOnly

  // When the objective (omega) changes after the first run, recompute the
  // allocation automatically — optimizer only, no breakpoints. Stops are
  // discrete so no debounce is needed.
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional — only objectiveIndex should retrigger.
  useEffect(() => {
    if (suppressObjectiveRun.current) {
      suppressObjectiveRun.current = false
      return
    }
    runOptimizeOnlyRef.current()
  }, [objectiveIndex])

  const handleReset = () => {
    setMode('collateral_target')
    setObjectiveIndex(0)
    setObjectiveOmegas(DEFAULT_OMEGAS)
    setAmount('100')
    setHorizon('medium')
    setResult(null)
    setRan(false)
    setError(null)
    setViewStep('buffer')
    setBuffer(recommendedBuffer)
  }

  const amountNum = parseFloat(amount) || 0
  const isCollateralMode = mode === 'collateral_target'
  // USD value of the token-denominated amount input — collateral token in Fixed
  // Collateral mode, loan token in Fixed Loan mode.
  const amountUsd =
    amountNum * ((isCollateralMode ? collateralPrice : loanPrice) ?? 0)

  const totalLiquidityUsd = useMemo(
    () => markets.reduce((sum, m) => sum + m.liquidityAmountUsd, 0),
    [markets]
  )

  const loanExceedsLiquidity =
    mode === 'loan_target' && amountUsd > 0 && amountUsd > totalLiquidityUsd

  // Buffer visuals: red when user chose a riskier buffer than recommended
  // (line above Recommended on chart), green when equal or safer (line below).
  // `badgeTop` mirrors recharts' internal scale so the HTML badge lines up
  // exactly with the SVG ReferenceLine at the same y value.
  const { bufferColor, badgeTop } = useMemo(() => {
    const color = buffer > recommendedBuffer ? '#ef4444' : '#10b981'
    const plotTop = CHART_MARGIN.top
    const plotBottom = CHART_HEIGHT - CHART_MARGIN.bottom
    const ratio = (buffer - domainMin) / (domainMax - domainMin)
    const px = plotTop + (1 - ratio) * (plotBottom - plotTop)
    const BH = 22
    const GAP = 4
    const aboveRaw = px - GAP - BH
    const rawTop = aboveRaw < plotTop ? px + GAP : aboveRaw
    return {
      bufferColor: color,
      badgeTop: Math.max(plotTop, Math.min(plotBottom - BH, rawTop)),
    }
  }, [buffer, recommendedBuffer, domainMin, domainMax])

  const allocations = useMemo(() => {
    if (!result) return []
    return result.allocations
      .filter((a) => {
        const val = mode === 'collateral_target' ? a.borrow : a.collateral
        return val > 0.001
      })
      .map((a) => ({
        market: markets[a.market_index],
        value: mode === 'collateral_target' ? a.borrow : a.collateral,
      }))
      .sort((a, b) => b.value - a.value)
  }, [result, mode, markets])

  const total =
    mode === 'collateral_target'
      ? result?.total_borrow
      : result?.total_collateral

  const weightedRate = useMemo(() => {
    if (!result || !total || total === 0) return null
    return allocations.reduce(
      (acc, a) => acc + (a.market.apy ?? 0) * (a.value / total),
      0
    )
  }, [result, total, allocations])

  const projectedCost = useMemo(() => {
    if (!weightedRate || !result) return null
    const loanAmt =
      mode === 'collateral_target' ? (result.total_borrow ?? 0) : amountUsd
    const days = HORIZON_OPTIONS.find((h) => h.key === horizon)?.days ?? 30
    return loanAmt * weightedRate * (days / 365)
  }, [weightedRate, result, mode, amountUsd, horizon])

  const horizonLabel =
    HORIZON_OPTIONS.find((h) => h.key === horizon)?.label ?? ''

  // Objective slider — lives in the result panel (horizontal, above the
  // allocation). Sliding it retriggers the optimizer automatically.
  const lastStop = objectiveOmegas.length - 1
  const objectiveSlider = (
    <div className="border-border/60 bg-secondary/30 rounded-xl border px-4 pt-3 pb-2">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-muted-foreground text-[10px] font-semibold tracking-wider uppercase">
          Objective
        </span>
        <span className="text-primary text-[11px] font-semibold">
          {objectiveLabel(
            objectiveIndex,
            objectiveOmegas.length,
            objectiveOmegas[objectiveIndex] ?? 0,
            mode
          )}
        </span>
      </div>
      <div className="px-1 pt-1 pb-0.5">
        {/* Track */}
        <div
          role="slider"
          tabIndex={0}
          aria-label="Objective"
          aria-valuenow={objectiveIndex}
          aria-valuemin={0}
          aria-valuemax={lastStop}
          ref={sliderTrackRef}
          className="bg-secondary relative h-1.5 w-full cursor-pointer rounded-full border-0 p-0"
          onMouseDown={(e) => {
            e.preventDefault()
            setIsSliderDragging(true)
            if (!sliderTrackRef.current) return
            const rect = sliderTrackRef.current.getBoundingClientRect()
            const ratio = Math.max(
              0,
              Math.min(1, (e.clientX - rect.left) / rect.width)
            )
            setObjectiveIndex(Math.round(ratio * lastStop))
          }}
        >
          {/* Fill */}
          <div
            className="bg-primary pointer-events-none absolute top-0 left-0 h-full rounded-full transition-all duration-150"
            style={{
              width: `${(objectiveIndex / lastStop) * 100}%`,
            }}
          />

          {/* Stops */}
          {objectiveOmegas.map((omega, i) => {
            const pct = (i / lastStop) * 100
            const active = i === objectiveIndex
            const past = i < objectiveIndex
            return (
              <button
                key={`dot-${omega}`}
                type="button"
                title={`ω ${omega.toFixed(2)}`}
                onMouseDown={(e) => {
                  e.stopPropagation()
                  setObjectiveIndex(i)
                }}
                className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 focus:outline-none"
                style={{ left: `${pct}%` }}
              >
                <div
                  className={`rounded-full border-2 transition-all duration-150 ${
                    active
                      ? 'border-background bg-primary shadow-primary/40 h-4 w-4 scale-110 shadow-sm'
                      : past
                        ? 'border-background bg-primary/70 h-2.5 w-2.5'
                        : 'border-muted-foreground/30 bg-secondary h-2.5 w-2.5'
                  }`}
                />
              </button>
            )
          })}
        </div>

        {/* Labels — ends always shown, plus the active stop, to avoid crowding */}
        <div className="relative mt-4">
          {objectiveOmegas.map((omega, i) => {
            const active = i === objectiveIndex
            if (i !== 0 && i !== lastStop && !active) return null
            const pct = (i / lastStop) * 100
            return (
              <button
                key={`label-${omega}`}
                type="button"
                onClick={() => setObjectiveIndex(i)}
                className={`absolute -translate-x-1/2 text-[10px] whitespace-nowrap transition-colors ${
                  active
                    ? 'text-primary font-semibold'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
                style={{ left: `${pct}%` }}
              >
                {objectiveLabel(i, objectiveOmegas.length, omega, mode)}
              </button>
            )
          })}
          {/* Spacer so the parent has height */}
          <div className="h-4" />
        </div>
      </div>
    </div>
  )

  return (
    <div className="flex flex-col">
      <AnimatePresence mode="wait" initial={false}>
        {/* ================================================================
            STEP 1 — Configure
        ================================================================ */}
        {viewStep === 'configure' && (
          <motion.div
            key="configure"
            initial={{ opacity: 0, x: -16 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -16 }}
            transition={{ duration: 0.2 }}
            className="divide-border flex divide-x"
          >
            {/* Left — parameters */}
            <div className="flex-1 space-y-5 px-1 py-4 pr-6">
              {/* Optimization mode */}
              <div>
                <span className="text-muted-foreground mb-2 block text-xs font-semibold tracking-wider uppercase">
                  Optimization mode
                </span>
                <div className="space-y-2">
                  {BORROW_MODES.map((m) => {
                    const active = mode === m.id
                    return (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => handleModeChange(m.id)}
                        className={`flex w-full items-start gap-3 rounded-xl border px-4 py-3 text-left transition-all duration-150 ${
                          active
                            ? m.activeBg
                            : 'border-border bg-secondary/20 hover:border-border/80'
                        }`}
                      >
                        <div
                          className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
                            active ? m.activeBg : 'bg-secondary'
                          }`}
                        >
                          <m.Icon
                            className={`h-4 w-4 ${active ? m.color : 'text-muted-foreground'}`}
                          />
                        </div>
                        <div className="flex-1">
                          <div
                            className={`text-sm font-semibold ${active ? m.color : 'text-foreground'}`}
                          >
                            {m.label}
                          </div>
                          <div className="text-muted-foreground text-xs leading-relaxed">
                            {m.desc}
                          </div>
                        </div>
                        {active && (
                          <CheckCircle2
                            className={`mt-1 h-4 w-4 shrink-0 ${m.color}`}
                          />
                        )}
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* Amount input */}
              <div>
                <div className="mb-2 flex items-baseline justify-between gap-2">
                  <span className="text-muted-foreground text-xs font-semibold tracking-wider uppercase">
                    {mode === 'collateral_target'
                      ? 'Collateral amount'
                      : 'Loan amount needed'}
                  </span>
                  {amountNum > 0 && (
                    <span className="text-muted-foreground mr-3 font-mono text-[10px]">
                      {(isCollateralMode ? collateralPrice : loanPrice) == null
                        ? 'Loading price…'
                        : `≈ ${formatCompactCurrency(amountUsd, 'USD')} USD`}
                    </span>
                  )}
                </div>
                <div
                  className={`border-input dark:bg-input/30 focus-within:border-ring focus-within:ring-ring/50 flex items-center rounded-xl border focus-within:ring-3 ${loanExceedsLiquidity ? 'border-red-500 focus-within:border-red-500 focus-within:ring-red-500/50' : ''}`}
                >
                  <span className="flex items-center px-3.5 select-none">
                    <TokenIcon
                      symbol={isCollateralMode ? collateralSymbol : loanSymbol}
                      size={18}
                    />
                  </span>
                  <Input
                    type="number"
                    inputMode="decimal"
                    placeholder="0.00"
                    value={amount}
                    onChange={(e) => {
                      setAmount(e.target.value)
                      resetResult()
                    }}
                    className="border-0 font-mono shadow-none focus-visible:ring-0"
                  />
                  <span className="px-4 py-1 text-xs font-semibold select-none">
                    {isCollateralMode ? collateralSymbol : loanSymbol}
                  </span>
                </div>
                {loanExceedsLiquidity && (
                  <p className="mt-1.5 text-xs text-red-500">
                    Exceeds available liquidity (
                    {formatCompactCurrency(totalLiquidityUsd, 'USD')} across{' '}
                    {markets.length} pool{markets.length !== 1 ? 's' : ''})
                  </p>
                )}
              </div>

              {/* Time horizon */}
              <div>
                <span className="text-muted-foreground mb-2 block text-xs font-semibold tracking-wider uppercase">
                  Time horizon
                </span>
                <div className="flex gap-1.5">
                  {HORIZON_OPTIONS.map((h) => (
                    <button
                      key={h.key}
                      type="button"
                      onClick={() => {
                        setHorizon(h.key)
                        resetResult()
                      }}
                      className={`flex-1 rounded-lg border py-2 text-xs font-semibold transition-all ${
                        horizon === h.key
                          ? 'border-primary bg-primary text-primary-foreground'
                          : 'border-border bg-secondary/30 text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      {h.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Right — results */}
            <div className="flex w-1/2 shrink-0 flex-col px-6 py-4">
              <div className="text-muted-foreground mb-4 flex items-center gap-1.5 text-xs font-semibold tracking-wider uppercase">
                <ArrowLeftRight className="h-3.5 w-3.5" />
                Recommended allocation
              </div>

              {/* Objective slider — recomputes the allocation on change */}
              {(ran || isOptimizing) && (
                <div className="mb-4">{objectiveSlider}</div>
              )}

              <AnimatePresence mode="wait">
                {error ? (
                  <motion.div
                    key="error"
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300"
                  >
                    {error}
                  </motion.div>
                ) : isOptimizing ? (
                  <motion.div
                    key="loading"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="flex flex-1 flex-col gap-4"
                  >
                    {/* Key metric */}
                    <div className="border-border bg-secondary/40 flex flex-col items-center gap-2 rounded-xl border p-4">
                      <Skeleton className="h-3 w-24" />
                      <Skeleton className="h-7 w-32" />
                      <Skeleton className="h-3 w-20" />
                    </div>
                    {/* Pie chart */}
                    <div className="flex h-44 items-center justify-center">
                      <div className="relative">
                        <Skeleton className="h-30 w-30 rounded-full" />
                        <div className="bg-card absolute top-1/2 left-1/2 h-18 w-18 -translate-x-1/2 -translate-y-1/2 rounded-full" />
                      </div>
                    </div>
                    {/* Legend */}
                    <div className="space-y-2">
                      {['a', 'b', 'c'].map((k) => (
                        <div key={k} className="flex items-center gap-2">
                          <Skeleton className="h-2.5 w-2.5 rounded-sm" />
                          <Skeleton className="h-3 flex-1" />
                          <Skeleton className="h-3 w-8" />
                        </div>
                      ))}
                    </div>
                    {/* Summary */}
                    <div className="border-border mt-auto space-y-2 border-t pt-3">
                      <div className="flex justify-between">
                        <Skeleton className="h-3 w-20" />
                        <Skeleton className="h-3 w-12" />
                      </div>
                      <div className="flex justify-between">
                        <Skeleton className="h-3 w-24" />
                        <Skeleton className="h-3 w-14" />
                      </div>
                    </div>
                  </motion.div>
                ) : ran && result && allocations.length > 0 ? (
                  <motion.div
                    key="allocs"
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="flex flex-1 flex-col gap-4"
                  >
                    {/* Key metric */}
                    <div className="border-border bg-secondary/40 rounded-xl border p-4 text-center">
                      {mode === 'collateral_target' ? (
                        <>
                          <div className="text-muted-foreground mb-1 text-xs tracking-wider uppercase">
                            {(objectiveOmegas[objectiveIndex] ?? 0) >= 0.5
                              ? 'Max loan size'
                              : 'Optimal loan size'}
                          </div>
                          <div className="text-foreground font-mono text-2xl font-bold">
                            {formatCompactCurrency(
                              result.total_borrow ?? 0,
                              'USD'
                            )}
                          </div>
                          {amountUsd > 0 && (
                            <div className="text-muted-foreground mt-1 text-xs">
                              {(
                                ((result.total_borrow ?? 0) / amountUsd) *
                                100
                              ).toFixed(1)}
                              % of collateral
                            </div>
                          )}
                        </>
                      ) : (
                        <>
                          <div className="text-muted-foreground mb-1 text-xs tracking-wider uppercase">
                            {(objectiveOmegas[objectiveIndex] ?? 0) >= 0.5
                              ? 'Min collateral required'
                              : 'Optimal collateral'}
                          </div>
                          <div className="text-foreground font-mono text-2xl font-bold">
                            {formatCompactCurrency(
                              result.total_collateral ?? 0,
                              'USD'
                            )}
                          </div>
                          {amountUsd > 0 && (
                            <div className="text-muted-foreground mt-1 text-xs">
                              {(
                                ((result.total_collateral ?? 0) / amountUsd) *
                                100
                              ).toFixed(1)}
                              % of loan
                            </div>
                          )}
                        </>
                      )}
                    </div>

                    {/* Pie chart */}
                    <div className="relative h-44">
                      <ResponsiveContainer
                        width="100%"
                        height="100%"
                        initialDimension={{ width: 1, height: 1 }}
                      >
                        <PieChart>
                          <Pie
                            data={allocations.map((a) => ({
                              name: a.market.poolName,
                              pct:
                                total && total > 0
                                  ? (a.value / total) * 100
                                  : 0,
                            }))}
                            dataKey="pct"
                            nameKey="name"
                            cx="50%"
                            cy="50%"
                            innerRadius={48}
                            outerRadius={72}
                            paddingAngle={3}
                            isAnimationActive
                            animationBegin={0}
                            animationDuration={700}
                            animationEasing="ease-out"
                          >
                            {allocations.map((a, i) => (
                              <Cell
                                key={a.market.poolName}
                                fill={
                                  ALLOCATION_COLORS[
                                    i % ALLOCATION_COLORS.length
                                  ]
                                }
                                stroke="transparent"
                              />
                            ))}
                          </Pie>
                          <Tooltip content={<AllocationTooltip />} />
                        </PieChart>
                      </ResponsiveContainer>
                      {weightedRate !== null && (
                        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                          <span className="text-foreground font-mono text-lg font-bold">
                            {(weightedRate * 100).toFixed(1)}%
                          </span>
                          <span className="text-muted-foreground text-[10px] tracking-wider uppercase">
                            Avg rate
                          </span>
                        </div>
                      )}
                    </div>

                    {/* Legend */}
                    <div className="space-y-2">
                      {allocations.map((a, i) => {
                        const pct =
                          total && total > 0 ? (a.value / total) * 100 : 0
                        return (
                          <div
                            key={a.market.poolName}
                            className="flex items-center gap-2"
                          >
                            <div
                              className="h-2.5 w-2.5 shrink-0 rounded-sm"
                              style={{
                                background:
                                  ALLOCATION_COLORS[
                                    i % ALLOCATION_COLORS.length
                                  ],
                              }}
                            />
                            <span className="text-foreground flex-1 truncate text-[11px]">
                              {a.market.poolName}
                            </span>
                            <span className="text-muted-foreground font-mono text-[11px]">
                              {pct.toFixed(0)}%
                            </span>
                          </div>
                        )
                      })}
                    </div>

                    {/* Summary */}
                    <motion.div
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ delay: 0.4 }}
                      className="border-border mt-auto space-y-1.5 border-t pt-3"
                    >
                      {weightedRate !== null && (
                        <div className="flex justify-between text-xs">
                          <span className="text-muted-foreground">
                            Weighted rate
                          </span>
                          <span className="font-mono font-semibold text-emerald-400">
                            {(weightedRate * 100).toFixed(2)}%
                          </span>
                        </div>
                      )}
                      {projectedCost !== null && amountNum > 0 && (
                        <div className="flex justify-between text-xs">
                          <span className="text-muted-foreground">
                            Est. cost ({horizonLabel})
                          </span>
                          <span className="font-mono font-semibold text-rose-400">
                            -{formatCompactCurrency(projectedCost, 'USD')}
                          </span>
                        </div>
                      )}
                    </motion.div>
                  </motion.div>
                ) : (
                  <motion.div
                    key="hint"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="flex flex-1 flex-col items-center justify-center text-center"
                  >
                    <div className="bg-secondary/60 mb-3 flex h-12 w-12 items-center justify-center rounded-2xl">
                      <Zap className="h-5 w-5 opacity-40" />
                    </div>
                    <p className="text-muted-foreground max-w-40 text-xs leading-relaxed">
                      Configure your parameters and run the optimizer to see the
                      allocation.
                    </p>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </motion.div>
        )}

        {/* ================================================================
            STEP 2 — Liquidation buffer
        ================================================================ */}
        {viewStep === 'buffer' && (
          <motion.div
            key="buffer"
            initial={{ opacity: 0, x: 16 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 16 }}
            transition={{ duration: 0.2 }}
            className="flex flex-col gap-3 py-4"
          >
            {/* Header */}
            <div className="px-1">
              <div className="flex items-baseline gap-2">
                <div className="text-muted-foreground text-[10px] font-semibold tracking-wider uppercase">
                  Liquidation buffer
                </div>
                <span className="text-foreground font-mono text-xs font-semibold">
                  {selectedCollateralSymbol ??
                    markets[0]?.collaterals[0]?.symbol ??
                    '?'}
                  /{markets[0]?.assetSymbol ?? '?'}
                </span>
              </div>
              <p className="text-muted-foreground mt-1 text-xs">
                Drag the solid line vertically to set your liquidation buffer.
                The dashed line marks the{' '}
                <span className="font-semibold text-slate-300">
                  Recommended
                </span>{' '}
                value — the worst daily return observed over the period (buffer
                = min(0%, minimum return)), the most conservative choice.
              </p>
              {/* Legend */}
              <div className="mt-2 flex items-center gap-5">
                <div className="flex items-center gap-2">
                  <svg width="24" height="8" className="shrink-0">
                    <title>Recomended</title>
                    <line
                      x1="0"
                      y1="4"
                      x2="24"
                      y2="4"
                      stroke="#94a3b8"
                      strokeWidth="1"
                      strokeDasharray="4 3"
                    />
                  </svg>
                  <span className="text-muted-foreground text-[10px]">
                    Recommended{' '}
                    <span className="font-mono font-semibold text-slate-400">
                      {priceData.length > 0
                        ? formatReturnPct(recommendedBuffer)
                        : '—'}
                    </span>
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <svg width="24" height="8" className="shrink-0">
                    <title>Buffer</title>
                    <line
                      x1="0"
                      y1="4"
                      x2="24"
                      y2="4"
                      stroke={bufferColor}
                      strokeWidth="2"
                    />
                  </svg>
                  <span className="text-muted-foreground text-[10px]">
                    Your buffer
                  </span>
                  <div
                    className="flex items-center rounded border transition-colors duration-150"
                    style={{ borderColor: bufferColor }}
                  >
                    <Input
                      id="treshold"
                      type="number"
                      inputMode="decimal"
                      step="0.01"
                      min={0}
                      disabled={priceData.length === 0}
                      value={bufferInput}
                      onFocus={() => {
                        bufferInputFocused.current = true
                      }}
                      onBlur={() => {
                        bufferInputFocused.current = false
                        setBufferInput(
                          priceData.length > 0
                            ? Math.abs(buffer).toFixed(2)
                            : ''
                        )
                      }}
                      onChange={(e) => {
                        const raw = e.target.value
                        setBufferInput(raw)
                        const num = parseFloat(raw)
                        if (Number.isFinite(num)) {
                          // Buffer is a non-positive drawdown in percent units.
                          setBuffer(-Math.abs(num))
                        }
                      }}
                      className="h-6 w-14 border-0 px-1.5 text-left font-mono text-[9px] font-semibold shadow-none focus-visible:ring-0 md:text-[10px]"
                      style={{ color: bufferColor }}
                    />
                    <span
                      className="pr-1.5 text-[10px] font-semibold select-none"
                      style={{ color: bufferColor }}
                    >
                      %
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Chart */}
            <div
              ref={chartRef}
              role="slider"
              tabIndex={0}
              aria-label="Price return chart"
              aria-valuenow={Math.round(buffer * 100) / 100}
              aria-valuemin={Math.round(domainMin * 100) / 100}
              aria-valuemax={Math.round(domainMax * 100) / 100}
              className="relative select-none"
              style={{
                height: CHART_HEIGHT,
                cursor: isPriceLoading
                  ? 'default'
                  : isDragging
                    ? 'grabbing'
                    : 'ns-resize',
              }}
              onMouseDown={(e) => {
                if (isPriceLoading || priceData.length === 0) return
                e.preventDefault()
                setIsDragging(true)
                const rect = chartRef.current?.getBoundingClientRect()
                if (!rect) return
                const effectiveTop = rect.top + CHART_MARGIN.top
                const effectiveHeight =
                  rect.height - CHART_MARGIN.top - CHART_MARGIN.bottom
                const ratio =
                  1 -
                  Math.max(
                    0,
                    Math.min(1, (e.clientY - effectiveTop) / effectiveHeight)
                  )
                setBuffer(
                  Math.min(0, domainMin + ratio * (domainMax - domainMin))
                )
              }}
            >
              <ResponsiveContainer
                width="100%"
                height="100%"
                initialDimension={{ width: 1, height: 1 }}
              >
                <AreaChart data={priceData} margin={CHART_MARGIN}>
                  <defs>
                    <linearGradient id="priceGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop
                        offset="5%"
                        stopColor="#06b6d4"
                        stopOpacity={0.18}
                      />
                      <stop offset="95%" stopColor="#06b6d4" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke={GRID_COLOR}
                    strokeOpacity={0.8}
                    vertical={false}
                  />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 9, fill: TICK_COLOR }}
                    tickLine={false}
                    axisLine={false}
                    interval={Math.max(1, Math.floor(priceData.length / 8))}
                  />
                  <YAxis
                    orientation="right"
                    domain={[domainMin, domainMax]}
                    width={YAXIS_WIDTH}
                    tick={{ fontSize: 9, fill: TICK_COLOR }}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={formatReturnPct}
                    tickCount={6}
                    label={{
                      value: 'Return (%)',
                      position: 'top',
                      offset: 12,
                      fontSize: 10,
                      fontWeight: 600,
                      fill: TICK_COLOR,
                    }}
                  />
                  <Area
                    type="linear"
                    dataKey="returnPct"
                    stroke="#06b6d4"
                    strokeWidth={1.25}
                    fill="url(#priceGrad)"
                    dot={false}
                    isAnimationActive={false}
                  />
                  {!isPriceLoading && priceData.length > 0 && (
                    <ReferenceLine
                      y={recommendedBuffer}
                      stroke="#94a3b8"
                      strokeDasharray="4 3"
                      strokeWidth={1}
                      ifOverflow="extendDomain"
                      label={(props: {
                        viewBox?: { x?: number; y?: number; width?: number }
                      }) => {
                        const x = props.viewBox?.x ?? 0
                        const y = props.viewBox?.y ?? 0
                        return (
                          <text x={x + 2} y={y - 4} fill="#94a3b8" fontSize={9}>
                            Recommended
                          </text>
                        )
                      }}
                    />
                  )}
                  {!isPriceLoading && priceData.length > 0 && (
                    <ReferenceLine
                      y={buffer}
                      stroke={bufferColor}
                      strokeWidth={2}
                      ifOverflow="extendDomain"
                    />
                  )}
                  <Tooltip
                    cursor={{
                      stroke: '#94a3b8',
                      strokeWidth: 1,
                      strokeDasharray: '3 3',
                    }}
                    content={
                      <ReturnTooltip
                        pairLabel={`${selectedCollateralSymbol ?? markets[0]?.collaterals[0]?.symbol ?? ''}/${markets[0]?.assetSymbol ?? ''}`}
                      />
                    }
                    isAnimationActive={false}
                  />
                </AreaChart>
              </ResponsiveContainer>

              {/* Loading overlay */}
              {isPriceLoading && (
                <div className="bg-background/60 absolute inset-0 flex items-center justify-center backdrop-blur-sm">
                  <Loader2 className="text-muted-foreground h-5 w-5 animate-spin" />
                </div>
              )}

              {/* Buffer badge — sits above (or below) the line, draggable */}
              {!isPriceLoading && priceData.length > 0 && (
                <div
                  role="slider"
                  tabIndex={0}
                  aria-label="Liquidation buffer"
                  aria-valuenow={Math.round(buffer * 100) / 100}
                  aria-valuemin={Math.round(domainMin * 100) / 100}
                  aria-valuemax={Math.round(domainMax * 100) / 100}
                  className={`bg-background/95 absolute flex items-center gap-1 rounded border px-1.5 py-0.5 font-mono text-[10px] font-semibold shadow-sm transition-colors duration-150 ${
                    isDragging ? 'cursor-grabbing' : 'cursor-pointer'
                  }`}
                  style={{
                    top: badgeTop,
                    right: YAXIS_WIDTH + 4,
                    color: bufferColor,
                    borderColor: bufferColor,
                  }}
                  onMouseDown={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    setIsDragging(true)
                  }}
                >
                  <GripVertical className="h-3 w-3" />
                  Buffer {Math.abs(buffer).toFixed(2)}%
                </div>
              )}
            </div>
          </motion.div>
        )}

        {/* ================================================================
            STEP 3 — Recommended LTV per market
        ================================================================ */}
        {viewStep === 'recommendedLtv' && (
          <motion.div
            key="recommendedLtv"
            initial={{ opacity: 0, x: 16 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -16 }}
            transition={{ duration: 0.2 }}
            className="flex flex-col py-2"
          >
            {/* Sticky column headers — inner row mirrors the data card's
						    box model (border + p-3.5) so columns line up. */}
            <div className="border-border/40 border-b px-1">
              <div className="flex items-center gap-4 border border-transparent px-3.5 pt-2 pb-2.5">
                <div className="w-1 shrink-0" />
                <span className="text-muted-foreground/70 w-32 shrink-0 text-[11px] font-semibold tracking-wider uppercase">
                  Protocol
                </span>
                <span className="text-muted-foreground/70 w-24 shrink-0 text-[11px] font-semibold tracking-wider uppercase">
                  Network
                </span>
                <span className="text-muted-foreground/70 flex-1 text-[11px] font-semibold tracking-wider uppercase">
                  Market
                </span>
                <span className="text-muted-foreground/70 w-20 text-right text-[11px] font-semibold tracking-wider uppercase">
                  MaxLTV
                </span>
                <span className="text-muted-foreground/70 w-20 text-right text-[11px] font-semibold tracking-wider uppercase">
                  LLTV
                </span>
                <span className="text-muted-foreground/70 w-32 text-right text-[11px] font-semibold tracking-wider uppercase">
                  Recommended LTV
                </span>
              </div>
            </div>

            {/* Scrollable rows */}
            <div className="max-h-104 space-y-2 overflow-y-auto px-1 py-4">
              {markets.map((m, i) => {
                const info = ltvInfo[i]
                const recPct = (recommendedLtvs[i] ?? 0) * 100
                const cap =
                  info?.lltv != null && info.lltv > 0
                    ? info.lltv * 100
                    : info?.maxLtv != null && info.maxLtv > 0
                      ? info.maxLtv * 100
                      : 100
                const overCap = recPct > cap + 1e-6
                return (
                  <div
                    key={`${m.poolId}`}
                    className="border-border/50 hover:border-border bg-secondary/30 flex items-center gap-4 rounded-xl border p-3.5 transition-colors"
                  >
                    <div className="from-primary to-primary/30 h-10 w-1 shrink-0 rounded-full bg-linear-to-b" />
                    <div className="w-32 shrink-0">
                      <ProtocolBadge protocol={m.protocol} />
                    </div>
                    <div className="w-24 shrink-0">
                      <NetworkBadge networkSlug={m.network} />
                    </div>
                    <span className="text-foreground flex-1 truncate text-sm font-medium">
                      {m.poolName}
                    </span>
                    <span className="text-muted-foreground w-20 text-right font-mono text-xs">
                      {info?.maxLtv != null
                        ? `${(info.maxLtv * 100).toFixed(2)}%`
                        : '—'}
                    </span>
                    <span className="text-muted-foreground w-20 text-right font-mono text-xs">
                      {info?.lltv != null
                        ? `${(info.lltv * 100).toFixed(2)}%`
                        : '—'}
                    </span>
                    <div className="w-32 shrink-0">
                      <div
                        className={`border-input dark:bg-input/30 focus-within:ring-ring/50 flex items-center rounded-lg border focus-within:ring-3 ${
                          overCap
                            ? 'border-red-500 focus-within:border-red-500 focus-within:ring-red-500/50'
                            : 'focus-within:border-ring'
                        }`}
                      >
                        <Input
                          type="number"
                          inputMode="decimal"
                          step="0.01"
                          min={0}
                          max={cap}
                          value={
                            Number.isFinite(recPct)
                              ? Number(recPct.toFixed(2))
                              : ''
                          }
                          onChange={(e) => {
                            const raw = parseFloat(e.target.value)
                            setRecommendedLtvs((prev) => {
                              const next = [...prev]
                              next[i] = Number.isFinite(raw)
                                ? Math.max(0, raw / 100)
                                : 0
                              return next
                            })
                            resetResult()
                          }}
                          className="h-9 border-0 text-right font-mono text-xs shadow-none focus-visible:ring-0"
                        />
                        <span className="text-muted-foreground pr-2 text-xs select-none">
                          %
                        </span>
                      </div>
                      {overCap && (
                        <p className="mt-1 text-right text-[10px] text-red-500">
                          Above LLTV cap ({cap.toFixed(2)}%)
                        </p>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Footer */}
      <div className="border-border bg-secondary/10 flex items-center justify-between border-t px-1 py-4 pt-4">
        <button
          type="button"
          onClick={() => {
            if (viewStep === 'configure') setViewStep('recommendedLtv')
            else if (viewStep === 'recommendedLtv') setViewStep('buffer')
            else onBack?.()
          }}
          disabled={isOptimizing}
          className="text-muted-foreground hover:text-foreground text-sm transition-colors disabled:opacity-40"
        >
          ← Back
        </button>

        <div className="flex items-center gap-3">
          {viewStep === 'configure' && ran && (
            <button
              type="button"
              onClick={handleReset}
              className="text-muted-foreground hover:text-foreground text-sm transition-colors"
            >
              Reset
            </button>
          )}

          {viewStep === 'buffer' && (
            <Button onClick={() => setViewStep('recommendedLtv')}>
              Continue →
            </Button>
          )}

          {viewStep === 'recommendedLtv' && (
            <Button
              onClick={() => setViewStep('configure')}
              disabled={recommendedLtvs.some((v, i) => {
                const info = ltvInfo[i]
                const cap =
                  info?.lltv != null && info.lltv > 0
                    ? info.lltv
                    : info?.maxLtv != null && info.maxLtv > 0
                      ? info.maxLtv
                      : 1
                return v > cap + 1e-9
              })}
            >
              Continue →
            </Button>
          )}

          {viewStep === 'configure' && (
            <>
              <Button
                onClick={handleRun}
                disabled={
                  !amount ||
                  parseFloat(amount) <= 0 ||
                  loanExceedsLiquidity ||
                  isOptimizing ||
                  (isCollateralMode
                    ? collateralPrice == null || collateralPrice <= 0
                    : loanPrice == null || loanPrice <= 0)
                }
              >
                {isOptimizing ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Optimizing…
                  </>
                ) : (
                  <>
                    <Zap className="mr-2 h-4 w-4" />
                    Run Optimizer
                  </>
                )}
              </Button>
              {ran && !isOptimizing && (
                <Button
                  onClick={() => {
                    posthog.capture('borrow_optimizer_applied', {
                      mode,
                      horizon,
                      collateral_symbol: collateralSymbol,
                      loan_symbol: loanSymbol,
                      total_borrow_usd: result?.total_borrow,
                      total_collateral_usd: result?.total_collateral,
                      weighted_rate: weightedRate,
                      markets_count: allocations.length,
                    })
                    onBack?.()
                  }}
                  className="bg-emerald-500 text-white hover:bg-emerald-500/90"
                >
                  <CheckCircle2 className="mr-2 h-4 w-4" />
                  Apply
                </Button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
