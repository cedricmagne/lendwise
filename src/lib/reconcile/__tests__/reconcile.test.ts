import { describe, expect, it } from 'vitest'

import { runReconcile } from '@/lib/reconcile'
import type { ReconcileDeps } from '@/lib/reconcile/types'

/**
 * What these tests are for.
 *
 * The bug reconcile exists to make impossible was never in any one step — each
 * of detect, repair, aggregate and prune worked. It was in their ORDER: as
 * three separately scheduled jobs, aggregation ran at 00:10 and repair after
 * 01:00, so no repaired row ever reached `apy_daily`. So the assertions here
 * are mostly about sequence and about the window the third step covers.
 */

const HOUR = 3600_000

function hoursAgo(n: number): Date {
  const d = new Date()
  d.setUTCMinutes(0, 0, 0)
  return new Date(d.getTime() - n * HOUR)
}

interface Recorder {
  calls: string[]
  aggregatedDays: string[]
  healed: { productId: string; source: string }[]
  historyParams: Record<string, unknown>[]
}

function makeDeps(over: Partial<ReconcileDeps> = {}): {
  deps: ReconcileDeps
  rec: Recorder
} {
  const rec: Recorder = {
    calls: [],
    aggregatedDays: [],
    healed: [],
    historyParams: [],
  }

  const deps: ReconcileDeps = {
    async findGaps() {
      rec.calls.push('detect')
      return [{ productId: 'p:a', hour: hoursAgo(30) }]
    },
    async findIncomplete() {
      return [{ productId: 'p:b', hour: hoursAgo(5), count: 3 }]
    },
    async markStale() {
      rec.calls.push('markStale')
      return 2
    },
    async collectedProductCount() {
      return 10
    },
    async productProviders(ids) {
      return new Map(ids.map((id) => [id, 'acme']))
    },
    async historyTargets(ids) {
      return ids.map((id) => ({
        productId: id,
        chainId: 1,
        kind: 'supply' as const,
        meta: { id: `key-${id}` },
      }))
    },
    adapterIdsForProvider() {
      return ['acme_v1']
    },
    async loadAdapter() {
      return {
        id: 'acme_v1',
        name: 'Acme',
        provider: 'acme',
        version: 'v1',
        chains: {},
        getProducts: async () => [],
        getApySpot: async () => [],
        getApyHistory: async (params) => {
          rec.calls.push('repair:fetch')
          rec.historyParams.push(params as unknown as Record<string, unknown>)
          return { points: [], failures: [] }
        },
      }
    },
    async fetchDonors() {
      rec.calls.push('repair:donors')
      return []
    },
    async writeHealed(rows) {
      rec.calls.push('repair:write')
      rec.healed.push(
        ...rows.map((r) => ({ productId: r.productId, source: r.source }))
      )
      return rows.length
    },
    async aggregateDaily(start) {
      rec.calls.push('aggregate')
      rec.aggregatedDays.push(start.toISOString().slice(0, 10))
      return 42
    },
    async pruneHourly() {
      rec.calls.push('prune')
      return 7
    },
    async countOrphans() {
      rec.calls.push('orphans')
      return { hourly: 0, daily: 0 }
    },
    ...over,
  }

  return { deps, rec }
}

describe('runReconcile', () => {
  it('repairs BEFORE it aggregates — the whole reason the job exists', async () => {
    const { deps, rec } = makeDeps()

    await runReconcile(deps, { days: 2, dryRun: false })

    const lastWrite = rec.calls.lastIndexOf('repair:write')
    const firstAggregate = rec.calls.indexOf('aggregate')
    expect(lastWrite).toBeGreaterThanOrEqual(0)
    expect(firstAggregate).toBeGreaterThan(lastWrite)
  })

  it('prunes only after aggregating, so a pruned hour was counted first', async () => {
    const { deps, rec } = makeDeps()

    await runReconcile(deps, { days: 2, dryRun: false })

    expect(rec.calls.lastIndexOf('aggregate')).toBeLessThan(
      rec.calls.indexOf('prune')
    )
  })

  it('re-aggregates one day per day of the repair window', async () => {
    const { deps, rec } = makeDeps()

    const report = await runReconcile(deps, { days: 7, dryRun: false })

    // 7 days of lookback spans 7 or 8 UTC midnights depending on the hour.
    expect(rec.aggregatedDays.length).toBeGreaterThanOrEqual(7)
    expect(report.aggregated.perDay).toHaveLength(rec.aggregatedDays.length)
    // Oldest first.
    expect([...rec.aggregatedDays].sort()).toEqual(rec.aggregatedDays)
  })

  it('asks each adapter only for the products that have holes', async () => {
    const { deps, rec } = makeDeps()

    await runReconcile(deps, { days: 2, dryRun: false })

    expect(rec.historyParams).toHaveLength(1)
    expect(rec.historyParams[0].productIds).toEqual(['p:a', 'p:b'])
    expect(rec.historyParams[0].targets).toHaveLength(2)
  })

  it('still aggregates when the repair step throws', async () => {
    const { deps, rec } = makeDeps({
      async writeHealed() {
        throw new Error('db down')
      },
    })

    const report = await runReconcile(deps, { days: 2, dryRun: false })

    expect(rec.calls).toContain('aggregate')
    expect(report.success).toBe(false)
    expect(report.errors.join(' ')).toMatch(/db down/)
  })

  it('reports per-product fetch failures instead of swallowing them', async () => {
    const { deps } = makeDeps({
      async loadAdapter() {
        return {
          id: 'acme_v1',
          name: 'Acme',
          provider: 'acme',
          version: 'v1',
          chains: {},
          getProducts: async () => [],
          getApySpot: async () => [],
          getApyHistory: async () => ({
            points: [],
            failures: [{ productId: 'p:a', reason: 'rate limited' }],
          }),
        }
      },
    })

    const report = await runReconcile(deps, { days: 2, dryRun: false })

    expect(report.fetch.failed).toBe(1)
    expect(report.fetch.failuresSample[0].reason).toBe('rate limited')
  })

  it('writes nothing in a dry run but still reports what it found', async () => {
    const { deps, rec } = makeDeps()

    const report = await runReconcile(deps, { days: 2, dryRun: true })

    expect(rec.calls).not.toContain('repair:write')
    expect(rec.calls).not.toContain('aggregate')
    expect(rec.calls).not.toContain('prune')
    expect(rec.calls).not.toContain('markStale')
    expect(report.detected.missing).toBe(1)
    expect(report.detected.incomplete).toBe(1)
  })

  it('counts a hole with no reachable donor rather than inventing one', async () => {
    const { deps } = makeDeps()

    const report = await runReconcile(deps, { days: 2, dryRun: false })

    expect(report.repaired.noDonor).toBe(2)
    expect(report.repaired.byNeighbor).toBe(0)
    expect(report.repaired.byRefetch).toBe(0)
  })

  it('reports orphan rows without deleting them', async () => {
    // The probe is a smoke alarm, not a fire brigade: a listing predicate that
    // has drifted wants investigating, and purging the evidence first is how
    // you lose the only trace of which predicate it was.
    const { deps, rec } = makeDeps({
      async countOrphans() {
        rec.calls.push('orphans')
        return { hourly: 1234, daily: 56 }
      },
    })

    const report = await runReconcile(deps, { days: 2, dryRun: false })

    expect(report.orphans).toEqual({ hourly: 1234, daily: 56 })
    // Reporting orphans is not a failure — the job still did its four steps.
    expect(report.success).toBe(true)
  })

  it('probes for orphans even in a dry run', async () => {
    // Counting writes nothing, and a dry run is exactly when someone is
    // reading the output.
    const { deps, rec } = makeDeps()

    const report = await runReconcile(deps, { days: 2, dryRun: true })

    expect(rec.calls).toContain('orphans')
    expect(report.orphans).toEqual({ hourly: 0, daily: 0 })
  })

  it('records an orphan-probe failure without failing the repairs', async () => {
    const { deps } = makeDeps({
      async countOrphans() {
        throw new Error('relation does not exist')
      },
    })

    const report = await runReconcile(deps, { days: 2, dryRun: false })

    expect(report.errors).toEqual(['orphans: relation does not exist'])
    expect(report.pruned).toBe(7)
  })
})
