import { Suspense } from 'react'

import { SupplyTableServer } from '@/components/products/SupplyTableServer'
import { TableSkeleton } from '@/components/products/TableSkeleton'

export default async function SupplyingPage() {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <Suspense fallback={<TableSkeleton />}>
        <SupplyTableServer />
      </Suspense>
    </div>
  )
}
