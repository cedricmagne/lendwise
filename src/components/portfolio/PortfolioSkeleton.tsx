import { Skeleton } from '@/components/ui/skeleton'

// ─── Sidebar skeleton ─────────────────────────────────────────────────────────

function SidebarSkeleton() {
  return (
    <aside className="border-border bg-card/40 hidden w-72 shrink-0 flex-col overflow-y-auto border-r md:flex">
      {/* Header */}
      <div className="border-border border-b px-6 py-5">
        <Skeleton className="mb-1.5 h-5 w-36" />
        <Skeleton className="h-3 w-44" />
      </div>

      {/* Net position */}
      <div className="border-border border-b px-6 py-5">
        <Skeleton className="mb-2 h-2.5 w-20" />
        <Skeleton className="mb-2 h-9 w-32" />
        <div className="flex items-center gap-1.5">
          <Skeleton className="h-3.5 w-3.5 rounded-full" />
          <Skeleton className="h-3 w-36" />
        </div>
      </div>

      {/* Supply section */}
      <div className="border-border border-b px-6 py-5">
        <div className="mb-3 flex items-center justify-between">
          <div className="space-y-1.5">
            <Skeleton className="h-2.5 w-24" />
            <Skeleton className="h-3 w-16" />
          </div>
          <Skeleton className="h-6 w-20" />
        </div>
        <DonutSkeleton />
      </div>

      {/* Borrow section */}
      <div className="px-6 py-5">
        <div className="mb-3 flex items-center justify-between">
          <div className="space-y-1.5">
            <Skeleton className="h-2.5 w-24" />
            <Skeleton className="h-3 w-16" />
          </div>
          <Skeleton className="h-6 w-20" />
        </div>
        <DonutSkeleton />
      </div>
    </aside>
  )
}

function DonutSkeleton() {
  return (
    <div className="flex items-center gap-4">
      <Skeleton className="h-20 w-20 shrink-0 rounded-full" />
      <div className="flex-1 space-y-2.5">
        {Array.from({ length: 3 }).map(() => (
          <div
            key={Math.random()}
            className="flex items-center justify-between"
          >
            <div className="flex items-center gap-1.5">
              <Skeleton className="h-2 w-2 shrink-0 rounded-full" />
              <Skeleton className="h-3 w-16" />
            </div>
            <Skeleton className="h-3 w-8" />
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Mobile summary bar skeleton ─────────────────────────────────────────────

function MobileSummarySkeleton() {
  return (
    <div className="bg-card/40 grid grid-cols-4 gap-2 border-b px-4 py-3 md:hidden">
      {Array.from({ length: 4 }).map(() => (
        <div key={Math.random()} className="space-y-1.5">
          <Skeleton className="h-2 w-8" />
          <Skeleton className="h-4 w-14" />
        </div>
      ))}
    </div>
  )
}

// ─── Tab bar skeleton ─────────────────────────────────────────────────────────

function TabBarSkeleton() {
  return (
    <div className="border-border flex border-b">
      {Array.from({ length: 2 }).map(() => (
        <div
          key={Math.random()}
          className="space-y-1.5 px-4 py-3 md:px-8 md:py-5"
        >
          <div className="flex items-center gap-2">
            <Skeleton className="h-4 w-12 sm:h-6 sm:w-36" />
            <Skeleton className="h-4 w-5 rounded-full" />
          </div>
          <Skeleton className="hidden h-3 w-52 sm:block" />
        </div>
      ))}
    </div>
  )
}

// ─── Table rows ───────────────────────────────────────────────────────────────

function SupplyRow() {
  return (
    <div className="border-border/30 flex items-center gap-3 border-b px-4 py-3.5 md:px-8">
      {/* Protocol — hidden on mobile */}
      <Skeleton className="hidden h-6 w-22 shrink-0 rounded-lg sm:block" />
      {/* Network — hidden on mobile */}
      <Skeleton className="hidden h-6 w-22 shrink-0 rounded-lg sm:block" />
      {/* Address — hidden on mobile */}
      <Skeleton className="hidden h-6 w-24 shrink-0 rounded-lg md:block" />
      {/* Vault/Pool */}
      <div className="flex flex-1 items-center gap-2">
        <Skeleton className="h-5 w-5 shrink-0 rounded-full" />
        <Skeleton className="h-4 w-28 sm:w-40" />
      </div>
      {/* Deposits */}
      <div className="flex items-center gap-2">
        <Skeleton className="h-4 w-16 sm:w-20" />
        <Skeleton className="hidden h-5 w-14 rounded-md sm:block" />
      </div>
      {/* APY */}
      <Skeleton className="h-4 w-10 sm:w-12" />
      {/* Link */}
      <Skeleton className="h-4 w-4 shrink-0 rounded-sm" />
    </div>
  )
}

// ─── Table section skeleton ───────────────────────────────────────────────────

function TableSectionSkeleton({
  row: Row,
  rows = 5,
}: {
  row: () => React.ReactNode
  rows?: number
}) {
  return (
    <div className="flex flex-col">
      {/* Column headers */}
      <div className="border-border/50 flex items-center gap-4 border-b px-4 py-3 md:px-8">
        <Skeleton className="h-2.5 w-12" />
        <Skeleton className="h-2.5 w-16" />
        <Skeleton className="hidden h-2.5 w-12 sm:block" />
      </div>
      {/* Rows */}
      {Array.from({ length: rows }).map(() => (
        <Row key={Math.random()} />
      ))}
    </div>
  )
}

// ─── Full portfolio skeleton ──────────────────────────────────────────────────

export function PortfolioSkeleton() {
  return (
    <div className="flex h-full overflow-hidden">
      <SidebarSkeleton />

      <div className="flex flex-1 flex-col overflow-hidden">
        <MobileSummarySkeleton />
        <TabBarSkeleton />

        <div className="flex-1 overflow-y-auto">
          <TableSectionSkeleton row={SupplyRow} rows={4} />
        </div>
      </div>
    </div>
  )
}
