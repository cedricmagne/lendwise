'use client'

import { Skeleton } from '@/components/ui/skeleton'

// ─── StatsBar skeleton ───────────────────────────────────────────────────────

export function StatsBarSkeleton({ cards = 3 }: { cards?: number }) {
  return (
    <div className="bg-card border-border flex items-stretch overflow-x-auto border-b">
      {Array.from({ length: cards }).map(() => (
        <div
          key={Math.random()}
          className="border-border flex flex-col gap-2 border-r px-6 py-4 last:border-r-0"
        >
          <Skeleton className="h-2.5 w-20" />
          <Skeleton className="h-6 w-24" />
          <Skeleton className="h-2.5 w-16" />
        </div>
      ))}
    </div>
  )
}

// ─── Column cell helpers ──────────────────────────────────────────────────────

function CheckboxCell() {
  return <Skeleton className="h-4 w-4 shrink-0 rounded-sm" />
}

function BadgeCell({ w = 20 }: { w?: number }) {
  return <Skeleton className="h-6 shrink-0 rounded-lg" style={{ width: w }} />
}

function ValueCell() {
  return (
    <div className="flex flex-1 items-center gap-2">
      <Skeleton className="h-4 w-20" />
      <Skeleton className="h-5 w-14 rounded-md" />
    </div>
  )
}

function UtilizationCell() {
  return (
    <div className="flex items-center gap-1">
      <Skeleton className="h-5 w-5 shrink-0 rounded-full" />
      <Skeleton className="h-4 w-12" />
    </div>
  )
}

function NameCell() {
  return (
    <div className="flex flex-1 items-center gap-2">
      <Skeleton className="h-5 w-5 shrink-0 rounded-full" />
      <Skeleton className="h-4 w-36" />
    </div>
  )
}

function CollateralsCell() {
  return (
    <div className="flex items-center gap-1">
      <Skeleton className="h-5 w-5 shrink-0 rounded-full" />
      <Skeleton className="h-5 w-5 shrink-0 rounded-full" />
      <Skeleton className="h-5 w-5 shrink-0 rounded-full" />
    </div>
  )
}

function ApyCell() {
  return <Skeleton className="h-4 w-14" />
}

function LinkCell() {
  return <Skeleton className="h-4 w-4 shrink-0 rounded-sm" />
}

// ─── Table header labels ──────────────────────────────────────────────────────

type HeaderCol = { label: string; flex?: boolean }

const SUPPLY_HEADERS: HeaderCol[] = [
  { label: '' }, // checkbox
  { label: 'PROTOCOL' },
  { label: 'NETWORK' },
  { label: 'NAME', flex: true },
  { label: 'DEPOSITS', flex: true },
  { label: 'LIQUIDITY', flex: true },
  { label: 'UTILIZATION' },
  { label: 'APY' },
  { label: '' },
]

const BORROW_HEADERS: HeaderCol[] = [
  { label: '' }, // checkbox
  { label: 'PROTOCOL' },
  { label: 'NETWORK' },
  { label: 'LOAN', flex: true },
  { label: 'COLLATERAL' },
  { label: 'DEPOSITS', flex: true },
  { label: 'LIQUIDITY', flex: true },
  { label: 'UTILIZATION' },
  { label: 'APY' },
  { label: '' },
]

// ─── Row cells per variant ────────────────────────────────────────────────────

function SupplyRow() {
  return (
    <div className="border-border/30 flex items-center gap-4 border-b px-8 py-3.5">
      <CheckboxCell />
      <BadgeCell w={88} />
      <BadgeCell w={88} />
      <NameCell />
      <ValueCell />
      <ValueCell />
      <UtilizationCell />
      <ApyCell />
      <LinkCell />
    </div>
  )
}

function BorrowRow() {
  return (
    <div className="border-border/30 flex items-center gap-4 border-b px-8 py-3.5">
      <CheckboxCell />
      <BadgeCell w={88} />
      <BadgeCell w={88} />
      <NameCell />
      <CollateralsCell />
      <ValueCell />
      <ValueCell />
      <UtilizationCell />
      <ApyCell />
      <LinkCell />
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

type Variant = 'supply' | 'borrow'

interface TableSkeletonProps {
  variant?: Variant
  statCards?: number
}

export function TableSkeleton({
  variant = 'supply',
  statCards = 3,
}: TableSkeletonProps) {
  const headers = variant === 'borrow' ? BORROW_HEADERS : SUPPLY_HEADERS
  const Row = variant === 'borrow' ? BorrowRow : SupplyRow

  return (
    <div className="flex flex-col">
      {/* Stats bar */}
      <StatsBarSkeleton cards={statCards} />

      {/* Page header */}
      <div className="border-border/50 flex items-center justify-between border-b px-8 py-5">
        <div className="space-y-2">
          <Skeleton className="h-6 w-40" />
          <Skeleton className="h-3 w-60" />
        </div>
        <div className="flex items-center gap-2">
          <Skeleton className="h-8 w-32 rounded-md" />
          <Skeleton className="h-8 w-24 rounded-md" />
          <Skeleton className="h-8 w-24 rounded-md" />
          <Skeleton className="h-8 w-24 rounded-md" />
        </div>
      </div>

      {/* Table header row */}
      <div className="border-border/50 flex items-center gap-4 border-b px-8 py-3">
        {headers.map(({ label, flex }) =>
          label ? (
            <Skeleton
              key={Math.random()}
              className={`h-2.5 w-12${flex ? 'flex-1' : 'shrink-0'}`}
            />
          ) : (
            <div key={Math.random()} className="h-2.5 w-4 shrink-0" />
          )
        )}
      </div>

      {/* Table body */}
      {Array.from({ length: 10 }).map(() => (
        <Row key={Math.random()} />
      ))}
    </div>
  )
}
