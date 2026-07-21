'use client'

import { useCallback, useEffect, useState } from 'react'

import {
  Activity,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  Loader2,
  RefreshCw,
  X,
  XCircle,
} from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'

// ─── Types ───────────────────────────────────────────────────────────────────

interface SlotInfo {
  hour: string
  /** Average spots/6 reported per pool this hour. */
  count: number
  status: 'complete' | 'partial' | 'missing' | 'in_progress'
  healed: boolean
  /** The current, still-filling hour — rendered as a live cell, not an anomaly. */
  inProgress?: boolean
  /** Pools that reported ≥1 spot this hour. */
  productCount: number
  /** Pools that reported all 6 spots — the real completeness signal. */
  fullProducts: number
  expectedProducts: number
  /** Spots expected this hour: 6 for settled hours, spots-so-far for the live one. */
  expectedSpots: number
}

interface ProtocolRow {
  protocol: string
  label: string
  totalProducts: number
  slots: SlotInfo[]
  summary: {
    complete: number
    partial: number
    missing: number
    total: number
  }
}

interface LatestReports {
  gapDetection: {
    id: string
    createdAt?: string
    missingSlots?: number
    incompleteSlots?: number
    expectedSlots?: number
  } | null
  gapHealing: {
    id: string
    createdAt?: string
    totalGaps?: number
    healed?: number
    healedByRefetch?: number
    healedByNeighbor?: number
    noDonor?: number
  } | null
}

interface QualityData {
  window: { start: string; end: string; hours: number }
  protocols: ProtocolRow[]
  latestReports: LatestReports
}

interface PoolRow {
  id: string
  protocolName: string
  chainName: string
  assetSymbol: string
  kind: string
  spots: number | null
  healed: boolean
}

interface SlotDetail {
  provider: string
  hour: string
  expected: number
  /** Spots a pool could have reported by now: 6 settled, spots-so-far when live. */
  expectedSpots: number
  full: number
  missing: PoolRow[]
  incomplete: PoolRow[]
}

interface SelectedSlot {
  provider: string
  protocolLabel: string
  hour: string
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatHour(iso: string | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString('en-GB', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
  })
}

function formatRelative(iso: string | undefined): string {
  if (!iso) return '—'
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return '—'
  const diff = Date.now() - t
  const mins = Math.floor(diff / 60_000)
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

/** Safe integer formatter — tolerates undefined/null from partial API responses. */
function fmtNum(n: number | undefined | null): string {
  return (n ?? 0).toLocaleString()
}

interface SlotMetrics {
  key: 'complete' | 'degraded' | 'sparse' | 'missing'
  color: string
  label: string
  missingProducts: number
  incompleteProducts: number
  fullPct: number
}

/**
 * Classify a slot by **pool completeness** (not raw spot average): a slot is
 * only green when (almost) every expected pool reported every spot expected by
 * now (all 6 for settled hours, spots-so-far for the live one). This is why a
 * cell can show "Avg spots 6/6" yet be amber — the average rounds up while
 * individual pools are still missing or short on spots. The live hour is scored
 * the same way; its blinking blue ring (not its color) marks it as in-progress.
 */
function slotMetrics(slot: SlotInfo): SlotMetrics {
  const expected = slot.expectedProducts || 0
  const missingProducts = Math.max(0, expected - slot.productCount)
  const incompleteProducts = Math.max(0, slot.productCount - slot.fullProducts)
  const fullPct = expected > 0 ? slot.fullProducts / expected : 0

  if (slot.productCount === 0) {
    return {
      key: 'missing',
      color: 'bg-red-500/80',
      label: 'No data',
      missingProducts,
      incompleteProducts,
      fullPct,
    }
  }
  if (missingProducts === 0 && fullPct >= 0.95) {
    return {
      key: 'complete',
      color: 'bg-emerald-500/80',
      label: 'Complete',
      missingProducts,
      incompleteProducts,
      fullPct,
    }
  }
  if (fullPct >= 0.7) {
    return {
      key: 'degraded',
      color: 'bg-amber-400/80',
      label: 'Degraded',
      missingProducts,
      incompleteProducts,
      fullPct,
    }
  }
  return {
    key: 'sparse',
    color: 'bg-orange-500/80',
    label: 'Sparse',
    missingProducts,
    incompleteProducts,
    fullPct,
  }
}

function poolLabel(p: PoolRow): string {
  return `${p.assetSymbol} · ${p.protocolName} · ${p.chainName}`
}

// ─── Components ─────────────────────────────────────────────────────────────

function ProtocolHeatmap({
  row,
  selectedHour,
  onSelect,
}: {
  row: ProtocolRow
  selectedHour: string | null
  onSelect: (slot: SlotInfo) => void
}) {
  const { label, totalProducts, slots, summary } = row
  const pct =
    summary.total > 0 ? Math.round((summary.complete / summary.total) * 100) : 0

  const anomalies = summary.partial + summary.missing

  // Group slots by calendar day (midnight-aligned)
  const dayMap = new Map<string, SlotInfo[]>()
  for (const slot of slots) {
    const d = new Date(slot.hour)
    const dayKey = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
    const list = dayMap.get(dayKey) ?? []
    list.push(slot)
    dayMap.set(dayKey, list)
  }
  const days: { label: string; slots: SlotInfo[] }[] = []
  for (const [dayKey, daySlots] of dayMap) {
    const dayDate = new Date(dayKey + 'T00:00:00Z')
    days.push({
      label: dayDate.toLocaleDateString('en-GB', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        timeZone: 'UTC',
      }),
      slots: daySlots,
    })
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-lg">{label}</CardTitle>
            <CardDescription>
              {totalProducts} pools · {summary.complete}/{summary.total} hours
              complete ({pct}%)
              {anomalies > 0 && (
                <span className="text-amber-400">
                  {' '}
                  · {anomalies} hour{anomalies !== 1 ? 's' : ''} need attention
                </span>
              )}
            </CardDescription>
          </div>
          <Badge
            variant={
              pct >= 95 ? 'default' : pct >= 70 ? 'secondary' : 'destructive'
            }
            className="text-xs"
          >
            {pct >= 95 ? 'Healthy' : pct >= 70 ? 'Degraded' : 'Critical'}
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {days.map((day) => (
            <div key={day.label} className="flex items-center gap-2">
              <span className="text-muted-foreground w-24 shrink-0 text-right font-mono text-xs">
                {day.label}
              </span>
              <div
                className="grid flex-1 grid-cols-24 gap-px"
                style={{ gridTemplateColumns: 'repeat(24, 1fr)' }}
              >
                {day.slots.map((slot) => {
                  const slotHour = new Date(slot.hour).getUTCHours()
                  const m = slotMetrics(slot)
                  const isSelected = selectedHour === slot.hour
                  // Live hour still filling (spots-so-far < 6): label it "In
                  // progress" rather than "Complete", even though the cell keeps
                  // its completeness color.
                  const live = slot.inProgress && slot.expectedSpots < 6
                  return (
                    <Tooltip key={slot.hour}>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          onClick={() => onSelect(slot)}
                          style={{ gridColumn: slotHour + 1 }}
                          className={`h-5 cursor-pointer rounded-sm transition-all hover:scale-y-125 hover:brightness-110 ${m.color} ${slot.healed ? 'ring-1 ring-blue-400/50' : ''} ${isSelected ? 'ring-2 ring-white ring-offset-1 ring-offset-transparent' : ''}`}
                        />
                      </TooltipTrigger>
                      <TooltipContent
                        side="top"
                        className="bg-popover text-popover-foreground max-w-xs border shadow-md"
                      >
                        <div className="space-y-1 py-1">
                          <div className="text-xs font-semibold">
                            {formatHour(slot.hour)} UTC
                          </div>
                          <div className="space-y-0.5 text-xs">
                            <div className="flex justify-between gap-4">
                              <span className="text-muted-foreground">
                                Status
                              </span>
                              <span
                                className={`font-medium ${live ? 'animate-pulse text-sky-400' : ''}`}
                              >
                                {live ? 'In progress' : m.label}
                              </span>
                            </div>
                            <div className="flex justify-between gap-4">
                              <span className="text-muted-foreground">
                                Full pools
                              </span>
                              <span className="font-medium">
                                {slot.fullProducts}/{slot.expectedProducts}
                              </span>
                            </div>
                            <div className="flex justify-between gap-4">
                              <span className="text-muted-foreground">
                                Missing pools
                              </span>
                              <span
                                className={`font-medium ${m.missingProducts > 0 ? 'text-red-400' : ''}`}
                              >
                                {m.missingProducts}
                              </span>
                            </div>
                            <div className="flex justify-between gap-4">
                              <span className="text-muted-foreground">
                                Incomplete pools
                              </span>
                              <span
                                className={`font-medium ${m.incompleteProducts > 0 ? 'text-amber-400' : ''}`}
                              >
                                {m.incompleteProducts}
                              </span>
                            </div>
                            <div className="flex justify-between gap-4">
                              <span className="text-muted-foreground">
                                Avg spots
                              </span>
                              <span className="font-medium">
                                {slot.count}/{slot.expectedSpots}
                              </span>
                            </div>
                            {slot.healed && (
                              <div className="flex justify-between gap-4">
                                <span className="text-muted-foreground">
                                  Healed
                                </span>
                                <span className="font-medium text-blue-400">
                                  Yes
                                </span>
                              </div>
                            )}
                          </div>
                          <div className="text-muted-foreground border-border/50 mt-1 border-t pt-1 text-[10px]">
                            Click to inspect pools
                          </div>
                        </div>
                      </TooltipContent>
                    </Tooltip>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
        {/* Hour labels */}
        <div className="mt-1 flex items-center gap-2">
          <span className="w-24 shrink-0" />
          <div className="text-muted-foreground text-2xs flex flex-1 justify-between font-mono">
            <span>00:00</span>
            <span>06:00</span>
            <span>12:00</span>
            <span>18:00</span>
            <span>23:00</span>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

/** Click-to-copy a productId, with brief "copied" feedback. */
function CopyButton({ value }: { value: string }) {
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
      title="Copy productId"
      aria-label="Copy productId"
      className="hover:bg-secondary text-muted-foreground hover:text-foreground shrink-0 self-start rounded p-1 transition-colors"
    >
      {copied ? (
        <Check className="h-3.5 w-3.5 text-emerald-400" />
      ) : (
        <Copy className="h-3.5 w-3.5" />
      )}
    </button>
  )
}

function PoolList({
  title,
  pools,
  expectedSpots,
}: {
  title: string
  pools: PoolRow[]
  expectedSpots: number
}) {
  if (pools.length === 0) return null
  return (
    <div>
      <div className="text-muted-foreground mb-1.5 text-xs font-semibold tracking-wider uppercase">
        {title} ({pools.length})
      </div>
      <div className="max-h-64 space-y-1 overflow-y-auto pr-1">
        {pools.map((p) => (
          <div
            key={p.id}
            className="border-border/50 bg-secondary/30 flex items-center gap-3 rounded-md border px-3 py-2 text-xs"
          >
            <span
              className={`h-2 w-2 shrink-0 self-start rounded-full ${p.spots == null ? 'bg-red-500' : 'bg-amber-400'} mt-1`}
            />
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="text-foreground truncate font-medium">
                {poolLabel(p)}
              </span>
              <span
                className="text-muted-foreground truncate font-mono text-[10px]"
                title={p.id}
              >
                {p.id}
              </span>
            </span>
            <Badge
              variant="outline"
              className="shrink-0 self-start text-[10px]"
            >
              {p.kind}
            </Badge>
            <span className="text-muted-foreground w-12 shrink-0 self-start text-right font-mono">
              {p.spots ?? 0}/{expectedSpots}
            </span>
            {p.healed && (
              <span className="shrink-0 self-start text-[10px] text-blue-400">
                healed
              </span>
            )}
            <CopyButton value={p.id} />
          </div>
        ))}
      </div>
    </div>
  )
}

function SlotDetailPanel({
  selected,
  detail,
  loading,
  error,
  onClose,
}: {
  selected: SelectedSlot
  detail: SlotDetail | null
  loading: boolean
  error: string | null
  onClose: () => void
}) {
  return (
    <Card className="border-primary/40">
      <CardHeader>
        <div className="flex items-start justify-between">
          <div>
            <CardTitle className="text-base">
              {selected.protocolLabel} — {formatHour(selected.hour)} UTC
            </CardTitle>
            <CardDescription>
              Pools missing or short on data for this hour
            </CardDescription>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="hover:bg-secondary text-muted-foreground hover:text-foreground rounded-md p-1 transition-colors"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </CardHeader>
      <CardContent>
        {loading && (
          <div className="text-muted-foreground flex items-center gap-2 py-6 text-sm">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading pool breakdown…
          </div>
        )}
        {error && !loading && (
          <div className="text-destructive flex items-center gap-2 py-4 text-sm">
            <XCircle className="h-4 w-4 shrink-0" />
            {error}
          </div>
        )}
        {detail && !loading && !error && (
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2 text-xs">
              <Badge variant="outline" className="gap-1">
                <span className="h-2 w-2 rounded-full bg-emerald-500" />
                {detail.full} full
              </Badge>
              <Badge variant="outline" className="gap-1">
                <span className="h-2 w-2 rounded-full bg-red-500" />
                {detail.missing.length} missing
              </Badge>
              <Badge variant="outline" className="gap-1">
                <span className="h-2 w-2 rounded-full bg-amber-400" />
                {detail.incomplete.length} incomplete
              </Badge>
              <Badge variant="outline">{detail.expected} expected</Badge>
            </div>

            {detail.missing.length === 0 && detail.incomplete.length === 0 ? (
              <p className="text-muted-foreground py-2 text-sm">
                All {detail.expected} pools reported a full{' '}
                {detail.expectedSpots}/{detail.expectedSpots} this hour. 🎉
              </p>
            ) : (
              <div className="space-y-4">
                <PoolList
                  title="Missing — no data"
                  pools={detail.missing}
                  expectedSpots={detail.expectedSpots}
                />
                <PoolList
                  title={`Incomplete — fewer than ${detail.expectedSpots} spots`}
                  pools={detail.incomplete}
                  expectedSpots={detail.expectedSpots}
                />
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function ReportCard({ reports }: { reports: LatestReports }) {
  const gap = reports.gapDetection
  const heal = reports.gapHealing

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm">
            <Activity className="h-4 w-4" />
            Latest Gap Detection
          </CardTitle>
        </CardHeader>
        <CardContent>
          {gap ? (
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Run</span>
                <span className="font-mono text-xs">
                  {formatRelative(gap.createdAt)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Expected slots</span>
                <span className="font-mono">{fmtNum(gap.expectedSlots)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Missing</span>
                <span
                  className={`font-mono ${(gap.missingSlots ?? 0) > 0 ? 'text-red-400' : 'text-emerald-400'}`}
                >
                  {fmtNum(gap.missingSlots)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Incomplete</span>
                <span
                  className={`font-mono ${(gap.incompleteSlots ?? 0) > 0 ? 'text-amber-400' : 'text-emerald-400'}`}
                >
                  {fmtNum(gap.incompleteSlots)}
                </span>
              </div>
            </div>
          ) : (
            <p className="text-muted-foreground text-sm">No reports yet</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm">
            <CheckCircle2 className="h-4 w-4" />
            Latest Heal Job
          </CardTitle>
        </CardHeader>
        <CardContent>
          {heal ? (
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Run</span>
                <span className="font-mono text-xs">
                  {formatRelative(heal.createdAt)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Total gaps</span>
                <span className="font-mono">{fmtNum(heal.totalGaps)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Healed</span>
                <span className="font-mono text-emerald-400">
                  {fmtNum(heal.healed)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">By refetch</span>
                <span className="font-mono">
                  {fmtNum(heal.healedByRefetch)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">By neighbor</span>
                <span className="font-mono">
                  {fmtNum(heal.healedByNeighbor)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">No donor</span>
                <span
                  className={`font-mono ${(heal.noDonor ?? 0) > 0 ? 'text-red-400' : 'text-emerald-400'}`}
                >
                  {fmtNum(heal.noDonor)}
                </span>
              </div>
            </div>
          ) : (
            <p className="text-muted-foreground text-sm">No reports yet</p>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function StatusPage() {
  const [data, setData] = useState<QualityData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)

  const [selected, setSelected] = useState<SelectedSlot | null>(null)
  const [slotDetail, setSlotDetail] = useState<SlotDetail | null>(null)
  const [slotLoading, setSlotLoading] = useState(false)
  const [slotError, setSlotError] = useState<string | null>(null)

  // silent = background poll: refresh data without flashing the full-page loader.
  const fetchData = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/status/quality')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setData(await res.json())
      setLastUpdated(new Date())
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      if (!silent) setLoading(false)
    }
  }, [])

  // Initial load + silent auto-refresh every 5 minutes (matches the 10-min cron
  // closely enough to surface new spots without a manual refresh).
  useEffect(() => {
    fetchData()
    const id = setInterval(() => fetchData(true), 5 * 60_000)
    return () => clearInterval(id)
  }, [fetchData])

  // Fetch the per-pool breakdown whenever a slot is selected.
  useEffect(() => {
    if (!selected) return
    let cancelled = false
    setSlotLoading(true)
    setSlotError(null)
    setSlotDetail(null)
    fetch(
      `/api/status/quality/slot?provider=${encodeURIComponent(selected.provider)}&hour=${encodeURIComponent(selected.hour)}`
    )
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return res.json()
      })
      .then((json: SlotDetail) => {
        if (!cancelled) setSlotDetail(json)
      })
      .catch((err) => {
        if (!cancelled)
          setSlotError(err instanceof Error ? err.message : String(err))
      })
      .finally(() => {
        if (!cancelled) setSlotLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [selected])

  const handleSelect = useCallback(
    (provider: string, protocolLabel: string, slot: SlotInfo) => {
      setSelected({ provider, protocolLabel, hour: slot.hour })
    },
    []
  )

  return (
    <div className="mx-auto max-w-350 space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Data Quality Status</h1>
          <p className="text-muted-foreground text-sm">
            APY pipeline health — last 7 days (168 hourly slots per protocol).
            Click any cell to see which pools are missing data.
          </p>
        </div>
        <div className="text-muted-foreground flex items-center gap-2 text-xs">
          <RefreshCw
            className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`}
          />
          <span>
            Auto-updating every 5 min
            {lastUpdated && (
              <>
                {' · updated '}
                {lastUpdated.toLocaleTimeString('en-GB', {
                  hour: '2-digit',
                  minute: '2-digit',
                  second: '2-digit',
                  timeZone: 'UTC',
                })}
                {' UTC'}
              </>
            )}
          </span>
        </div>
      </div>

      {/* Legend — color reflects POOL completeness, not the spot average */}
      <div className="text-muted-foreground flex flex-wrap items-center gap-x-6 gap-y-2 text-xs">
        <div className="flex items-center gap-1.5">
          <div className="h-3 w-3 rounded-sm bg-emerald-500/80" />
          Complete (≥95% pools full, none missing)
        </div>
        <div className="flex items-center gap-1.5">
          <div className="h-3 w-3 rounded-sm bg-amber-400/80" />
          Degraded (≥70% pools full)
        </div>
        <div className="flex items-center gap-1.5">
          <div className="h-3 w-3 rounded-sm bg-orange-500/80" />
          Sparse (&lt;70% pools full)
        </div>
        <div className="flex items-center gap-1.5">
          <div className="h-3 w-3 rounded-sm bg-red-500/80" />
          No data
        </div>
        <div className="flex items-center gap-1.5">
          <div className="bg-muted h-3 w-3 rounded-sm ring-1 ring-blue-400/50" />
          Contains healed data
        </div>
      </div>

      {error && (
        <div className="border-destructive/50 bg-destructive/10 text-destructive flex items-center gap-2 rounded-md border p-4 text-sm">
          <XCircle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      {loading && !data && (
        <div className="text-muted-foreground flex items-center justify-center gap-2 py-20">
          <Clock className="h-5 w-5 animate-pulse" />
          Loading quality data…
        </div>
      )}

      {data && (
        <>
          {/* Window info */}
          <p className="text-muted-foreground font-mono text-xs">
            Window: {formatHour(data.window?.start)} →{' '}
            {formatHour(data.window?.end)} UTC
          </p>

          {/* Drill-down panel for the selected cell */}
          {selected && (
            <SlotDetailPanel
              selected={selected}
              detail={slotDetail}
              loading={slotLoading}
              error={slotError}
              onClose={() => setSelected(null)}
            />
          )}

          {/* Protocol heatmaps */}
          <div className="space-y-4">
            {(data.protocols ?? []).map((row) => (
              <ProtocolHeatmap
                key={row.protocol}
                row={row}
                selectedHour={
                  selected?.provider === row.protocol ? selected.hour : null
                }
                onSelect={(slot) => handleSelect(row.protocol, row.label, slot)}
              />
            ))}
          </div>

          {/* Reports */}
          <ReportCard reports={data.latestReports} />
        </>
      )}
    </div>
  )
}
