import type { BigQuery } from '@google-cloud/bigquery'
import { describe, expect, it, vi } from 'vitest'

import { fetchBlendPoolDeploys } from '../blend-deploys'

const FACTORY_V1 = 'CCZD6ESMOGMPWH2KRO4O7RGTAPGTUPFWFQBELQSS7ZUK63V3TZWETGAG'
const FACTORY_V2 = 'CDSYOAVXFY7SM5S64IZPPPYB4GVGGLMQVFREPSQQEZVIWXX5R23G4QSU'
const FACTORIES = { v1: FACTORY_V1, v2: FACTORY_V2 }

const POOL_A = `C${'A'.repeat(55)}`
const POOL_B = `C${'B'.repeat(55)}`
const POOL_C = `C${'C'.repeat(55)}`

/**
 * Fake BigQuery client matching the surface `fetchBlendPoolDeploys` uses:
 * `createQueryJob` returns `[job]`, `job.getQueryResults` returns `[rows]`.
 */
function fakeClient(rows: Record<string, unknown>[]) {
  const getQueryResults = vi.fn(async () => [rows])
  const createQueryJob = vi.fn(async (_opts: unknown) => [{ getQueryResults }])
  return {
    client: { createQueryJob } as unknown as BigQuery,
    createQueryJob,
    getQueryResults,
  }
}

describe('fetchBlendPoolDeploys', () => {
  it('maps rows for both factories, sorted per version', async () => {
    const { client } = fakeClient([
      { pool_id: POOL_B, factory_id: FACTORY_V1 },
      { pool_id: POOL_A, factory_id: FACTORY_V1 },
      { pool_id: POOL_C, factory_id: FACTORY_V2 },
    ])
    expect(await fetchBlendPoolDeploys(client, FACTORIES)).toEqual({
      v1: [POOL_A, POOL_B],
      v2: [POOL_C],
    })
  })

  it('ignores a row whose factory_id matches neither', async () => {
    const { client } = fakeClient([
      { pool_id: POOL_A, factory_id: FACTORY_V1 },
      { pool_id: POOL_B, factory_id: `C${'Z'.repeat(55)}` },
    ])
    expect(await fetchBlendPoolDeploys(client, FACTORIES)).toEqual({
      v1: [POOL_A],
      v2: [],
    })
  })

  it('dedupes a repeated pool_id within one factory', async () => {
    const { client } = fakeClient([
      { pool_id: POOL_A, factory_id: FACTORY_V1 },
      { pool_id: POOL_A, factory_id: FACTORY_V1 },
    ])
    expect(await fetchBlendPoolDeploys(client, FACTORIES)).toEqual({
      v1: [POOL_A],
      v2: [],
    })
  })

  it('uppercases a lowercase pool_id', async () => {
    const { client } = fakeClient([
      { pool_id: POOL_A.toLowerCase(), factory_id: FACTORY_V1 },
    ])
    expect(await fetchBlendPoolDeploys(client, FACTORIES)).toEqual({
      v1: [POOL_A],
      v2: [],
    })
  })

  it('returns empty lists for zero rows', async () => {
    const { client } = fakeClient([])
    expect(await fetchBlendPoolDeploys(client, FACTORIES)).toEqual({
      v1: [],
      v2: [],
    })
  })

  it('skips a row with a null pool_id', async () => {
    const { client } = fakeClient([
      { pool_id: null, factory_id: FACTORY_V1 },
      { pool_id: POOL_A, factory_id: FACTORY_V1 },
    ])
    expect(await fetchBlendPoolDeploys(client, FACTORIES)).toEqual({
      v1: [POOL_A],
      v2: [],
    })
  })

  it('passes the factory ids as a bound parameter, never interpolated', async () => {
    const { client, createQueryJob } = fakeClient([])
    await fetchBlendPoolDeploys(client, FACTORIES)
    const arg = createQueryJob.mock.calls[0][0] as {
      query: string
      params: { factory_ids: string[] }
      location: string
    }
    expect(arg.params).toEqual({ factory_ids: [FACTORY_V1, FACTORY_V2] })
    expect(arg.location).toBe('US')
    expect(arg.query).toContain('@factory_ids')
    expect(arg.query).not.toContain(FACTORY_V1)
  })
})
