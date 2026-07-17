'use client'

import { useEffect, useMemo, useState } from 'react'

import {
  BarChart3,
  CheckCircle2,
  Flame,
  Loader2,
  Shield,
  TrendingUp,
  Zap,
} from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import posthog from 'posthog-js'
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts'

import { loadLatestPrice } from '@/app/actions/price-return-history.actions'
import { TokenIcon } from '@/components/icon'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { HORIZON_CONFIG, HORIZON_OPTIONS, HorizonKey } from '@/config/horizon'
import {
  DIVERSIFICATION_LEVELS,
  type VaultAllocationResponse,
  optimizeVaults,
} from '@/lib/api/optimizer'
import { formatCompactCurrency } from '@/lib/format-currency'
import type { SupplyProduct } from '@/types'

// ============================================================================
// Constants
// ============================================================================

const STRATEGIES = [
  {
    id: 'conservative' as const,
    label: 'Conservative',
    Icon: Shield,
    desc: 'Lower risk, stable yields',
    color: 'text-emerald-400',
    activeBg: 'bg-emerald-400/10 border-emerald-400/30',
    diversification: DIVERSIFICATION_LEVELS.HIGH,
    expectedApy: '4–8%',
  },
  {
    id: 'balanced' as const,
    label: 'Balanced',
    Icon: BarChart3,
    desc: 'Optimized risk/reward',
    color: 'text-orange-400',
    activeBg: 'bg-orange-400/10 border-orange-400/30',
    diversification: DIVERSIFICATION_LEVELS.MODERATE,
    expectedApy: '8–20%',
  },
  {
    id: 'aggressive' as const,
    label: 'Aggressive',
    Icon: Flame,
    desc: 'Max yield, higher risk',
    color: 'text-primary',
    activeBg: 'bg-primary/10 border-primary/30',
    diversification: DIVERSIFICATION_LEVELS.LOW,
    expectedApy: '20%+',
  },
]

type StrategyId = (typeof STRATEGIES)[number]['id']

const ALLOCATION_COLORS = [
  '#3b82f6',
  '#06b6d4',
  '#8b5cf6',
  '#10b981',
  '#f59e0b',
]

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
      <p className="text-foreground max-w-[160px] truncate font-medium">
        {payload[0].name}
      </p>
      <p className="text-muted-foreground font-mono">
        {payload[0].value.toFixed(0)}%
      </p>
    </div>
  )
}

// ============================================================================
// Types
// ============================================================================

interface OptimizationResult {
  vault: SupplyProduct
  allocation: number
  allocationPercent: number
}

interface SupplyingOptimizerViewProps {
  markets: SupplyProduct[]
  onBack?: () => void
}

// ============================================================================
// Component
// ============================================================================

export function SupplyingOptimizerView({
  markets,
  onBack,
}: SupplyingOptimizerViewProps) {
  const [amount, setAmount] = useState('100')
  const [horizon, setHorizon] = useState<HorizonKey>('medium')
  const [strategy, setStrategy] = useState<StrategyId>('balanced')
  const [results, setResults] = useState<OptimizationResult[] | null>(null)
  const [isOptimizing, setIsOptimizing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [ran, setRan] = useState(false)

  // Supplied asset — shared across all vaults in the set. The capital input is
  // denominated in this token; its USD value uses the token's spot price.
  const assetSymbol = markets[0]?.assetSymbol ?? '?'
  const [assetPrice, setAssetPrice] = useState<number | null>(null)

  useEffect(() => {
    const sym = markets[0]?.assetSymbol
    if (!sym) return
    setAssetPrice(null)
    loadLatestPrice(sym).then(setAssetPrice)
  }, [markets])

  const handleRun = async () => {
    setError(null)
    setResults(null)
    setIsOptimizing(true)
    setRan(false)

    try {
      if (markets.length === 0) throw new Error('No markets selected')

      const horizonEntry = HORIZON_CONFIG[horizon]
      const apyKey = (horizonEntry?.apyKey ?? 'apy') as keyof SupplyProduct

      const apys = markets.map((m) => {
        const v = m[apyKey]
        return typeof v === 'number' ? v : 0
      })

      const selectedStrategy = STRATEGIES.find((s) => s.id === strategy)
      const diversification =
        selectedStrategy?.diversification ?? DIVERSIFICATION_LEVELS.MODERATE

      const response: VaultAllocationResponse = await optimizeVaults({
        apy: apys,
        diversification,
      })

      if (!response.success) throw new Error('Optimization failed')

      const optimizationResults: OptimizationResult[] = response.allocations
        .filter((a) => a.allocation > 0.001)
        .map((a) => ({
          vault: markets[a.vault_index],
          allocation: a.allocation,
          allocationPercent: a.allocation_percent,
        }))
        .sort((a, b) => b.allocationPercent - a.allocationPercent)

      setResults(optimizationResults)
      setRan(true)
      posthog.capture('supply_optimizer_run', {
        asset_symbol: assetSymbol,
        strategy,
        horizon,
        markets_count: markets.length,
        amount: parseFloat(amount) || 0,
        result_count: optimizationResults.length,
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Optimization failed')
      posthog.captureException(err)
    } finally {
      setIsOptimizing(false)
    }
  }

  const handleReset = () => {
    setAmount('100')
    setHorizon('medium')
    setStrategy('balanced')
    setResults(null)
    setRan(false)
    setError(null)
  }

  const amountNum = parseFloat(amount) || 0
  // USD value of the token-denominated capital input.
  const amountUsd = amountNum * (assetPrice ?? 0)

  const weightedApy = useMemo(() => {
    if (!results) return null
    return results.reduce(
      (acc, r) => acc + r.vault.apy * (r.allocationPercent / 100),
      0
    )
  }, [results])

  const projectedReturn = useMemo(() => {
    if (!weightedApy || !amountUsd) return null
    const days = HORIZON_OPTIONS.find((h) => h.key === horizon)?.days ?? 30
    return amountUsd * weightedApy * (days / 365)
  }, [weightedApy, amountUsd, horizon])

  const horizonLabel =
    HORIZON_OPTIONS.find((h) => h.key === horizon)?.label ?? ''

  return (
    <div className="flex flex-col">
      {/* Main content */}
      <div className="divide-border flex divide-x">
        {/* Left — parameters */}
        <div className="flex-1 space-y-6 px-1 py-4 pr-6">
          {/* Capital */}
          <div>
            <div className="mb-2 flex items-baseline justify-between gap-2">
              <label className="text-muted-foreground text-xs font-semibold tracking-wider uppercase">
                Capital to deploy
              </label>
              {amountNum > 0 && (
                <span className="text-muted-foreground mr-1 font-mono text-[10px]">
                  {assetPrice == null
                    ? 'Loading price…'
                    : `≈ ${formatCompactCurrency(amountUsd, 'USD')} USD`}
                </span>
              )}
            </div>
            <div className="border-input dark:bg-input/30 focus-within:border-ring focus-within:ring-ring/50 flex items-center rounded-xl border focus-within:ring-[3px]">
              <span className="flex items-center px-3.5 select-none">
                <TokenIcon symbol={assetSymbol} size={18} />
              </span>
              <Input
                type="number"
                inputMode="decimal"
                placeholder="0.00"
                value={amount}
                onChange={(e) => {
                  setAmount(e.target.value)
                  setRan(false)
                }}
                className="border-0 font-mono shadow-none focus-visible:ring-0"
              />
              <span className="px-4 py-1 text-xs font-semibold select-none">
                {assetSymbol}
              </span>
            </div>
          </div>

          {/* Time horizon */}
          <div>
            <label className="text-muted-foreground mb-2 block text-xs font-semibold tracking-wider uppercase">
              Time horizon
            </label>
            <div className="flex gap-1.5">
              {HORIZON_OPTIONS.map((h) => (
                <button
                  key={h.key}
                  type="button"
                  onClick={() => {
                    setHorizon(h.key)
                    setRan(false)
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

          {/* Risk strategy */}
          <div>
            <label className="text-muted-foreground mb-2 block text-xs font-semibold tracking-wider uppercase">
              Risk strategy
            </label>
            <div className="space-y-2">
              {STRATEGIES.map((s) => {
                const active = strategy === s.id
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => {
                      setStrategy(s.id)
                      setRan(false)
                    }}
                    className={`flex w-full items-center gap-3.5 rounded-xl border px-4 py-3 text-left transition-all duration-150 ${
                      active
                        ? s.activeBg
                        : 'border-border bg-secondary/20 hover:border-border/80'
                    }`}
                  >
                    <div
                      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
                        active ? s.activeBg : 'bg-secondary'
                      }`}
                    >
                      <s.Icon
                        className={`h-4 w-4 ${active ? s.color : 'text-muted-foreground'}`}
                      />
                    </div>
                    <div className="flex-1">
                      <div
                        className={`text-sm font-semibold ${active ? s.color : 'text-foreground'}`}
                      >
                        {s.label}
                      </div>
                      <div className="text-muted-foreground text-xs">
                        {s.desc}
                      </div>
                    </div>
                    <div
                      className={`font-mono text-xs font-semibold ${active ? s.color : 'text-muted-foreground'}`}
                    >
                      {s.expectedApy}
                    </div>
                    {active && (
                      <CheckCircle2 className={`h-4 w-4 shrink-0 ${s.color}`} />
                    )}
                  </button>
                )
              })}
            </div>
          </div>
        </div>

        {/* Right — results */}
        <div className="flex w-1/2 shrink-0 flex-col px-6 py-4">
          <div className="text-muted-foreground mb-4 flex items-center gap-1.5 text-xs font-semibold tracking-wider uppercase">
            <TrendingUp className="h-3.5 w-3.5" />
            Recommended allocation
          </div>

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
                className="flex flex-1 flex-col items-center justify-center text-center"
              >
                <Loader2 className="text-muted-foreground mb-2 h-5 w-5 animate-spin" />
                <p className="text-muted-foreground text-xs">
                  Computing optimal allocation…
                </p>
              </motion.div>
            ) : ran && results && results.length > 0 ? (
              <motion.div
                key="results"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex flex-1 flex-col gap-3"
              >
                {/* Pie chart */}
                <div className="relative h-44">
                  <ResponsiveContainer
                    width="100%"
                    height="100%"
                    initialDimension={{ width: 1, height: 1 }}
                  >
                    <PieChart>
                      <Pie
                        data={results.map((r) => ({
                          name: r.vault.poolName,
                          pct: r.allocationPercent,
                        }))}
                        dataKey="pct"
                        nameKey="name"
                        cx="50%"
                        cy="50%"
                        innerRadius={48}
                        outerRadius={72}
                        paddingAngle={3}
                        isAnimationActive={true}
                        animationBegin={0}
                        animationDuration={700}
                        animationEasing="ease-out"
                      >
                        {results.map((r, i) => (
                          <Cell
                            key={r.vault.poolName}
                            fill={
                              ALLOCATION_COLORS[i % ALLOCATION_COLORS.length]
                            }
                            stroke="transparent"
                          />
                        ))}
                      </Pie>
                      <Tooltip content={<AllocationTooltip />} />
                    </PieChart>
                  </ResponsiveContainer>
                  {/* Center label */}
                  {weightedApy !== null && (
                    <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                      <span className="text-foreground font-mono text-lg font-bold">
                        {(weightedApy * 100).toFixed(1)}%
                      </span>
                      <span className="text-muted-foreground text-[10px] tracking-wider uppercase">
                        Avg APY
                      </span>
                    </div>
                  )}
                </div>

                {/* Legend */}
                <div className="space-y-2">
                  {results.map((r, i) => (
                    <div
                      key={r.vault.poolName}
                      className="flex items-center gap-2"
                    >
                      <div
                        className="h-2.5 w-2.5 shrink-0 rounded-sm"
                        style={{
                          background:
                            ALLOCATION_COLORS[i % ALLOCATION_COLORS.length],
                        }}
                      />
                      <span className="text-foreground flex-1 truncate text-[11px]">
                        {r.vault.poolName}
                      </span>
                      <span className="text-muted-foreground font-mono text-[11px]">
                        {r.allocationPercent.toFixed(0)}%
                      </span>
                    </div>
                  ))}
                </div>

                {/* Summary */}
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.5 }}
                  className="border-border mt-1 space-y-1.5 border-t pt-3"
                >
                  <div className="flex justify-between text-[12px]">
                    <span className="text-muted-foreground">Weighted APY</span>
                    <span className="font-mono font-semibold text-emerald-400">
                      {((weightedApy ?? 0) * 100).toFixed(2)}%
                    </span>
                  </div>
                  {projectedReturn !== null && amountNum > 0 && (
                    <div className="flex justify-between text-[12px]">
                      <span className="text-muted-foreground">
                        Est. return ({horizonLabel})
                      </span>
                      <span className="text-foreground font-mono font-semibold">
                        +{formatCompactCurrency(projectedReturn, 'USD')}
                      </span>
                    </div>
                  )}
                </motion.div>
              </motion.div>
            ) : (
              <motion.div
                key="empty"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="flex flex-1 flex-col items-center justify-center space-y-2 text-center"
              >
                <div className="bg-secondary/60 mb-1 flex h-12 w-12 items-center justify-center rounded-2xl">
                  <Zap className="h-5 w-5 opacity-40" />
                </div>
                <p className="text-muted-foreground text-xs leading-relaxed">
                  Set your parameters and run the optimizer to see recommended
                  allocations.
                </p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Footer */}
      <div className="border-border bg-secondary/10 flex items-center justify-between border-t px-1 py-4 pt-4">
        {onBack ? (
          <button
            type="button"
            onClick={onBack}
            disabled={isOptimizing}
            className="text-muted-foreground hover:text-foreground text-sm transition-colors disabled:opacity-40"
          >
            ← Back
          </button>
        ) : (
          <div />
        )}

        <div className="flex items-center gap-3">
          {ran && (
            <button
              type="button"
              onClick={handleReset}
              className="text-muted-foreground hover:text-foreground text-sm transition-colors"
            >
              Reset
            </button>
          )}
          <Button
            onClick={
              ran
                ? () => {
                    posthog.capture('supply_optimizer_applied', {
                      asset_symbol: assetSymbol,
                      strategy,
                      horizon,
                      weighted_apy: weightedApy,
                      projected_return_usd: projectedReturn,
                      markets_count: results?.length ?? 0,
                    })
                    onBack?.()
                  }
                : handleRun
            }
            disabled={isOptimizing || (!ran && !amount)}
            className={
              ran
                ? 'bg-emerald-500 text-white hover:bg-emerald-500/90'
                : undefined
            }
          >
            {isOptimizing ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Optimizing…
              </>
            ) : ran ? (
              <>
                <CheckCircle2 className="mr-2 h-4 w-4" />
                Apply Allocation
              </>
            ) : (
              <>
                <Zap className="mr-2 h-4 w-4" />
                Run Optimizer
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  )
}
