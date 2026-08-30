import type { BigQuery } from '@google-cloud/bigquery'

/**
 * One row of the discovery query. `JSON_VALUE` yields `NULL` (→ `null`) when
 * `data_decoded` has no `$.address`, so `pool_id` is nullable.
 */
interface DeployRow {
  pool_id: string | null
  factory_id: string
}

/**
 * Every pool address the Blend pool factories have ever deployed, read from
 * Hubble's `history_contract_events` mirror (`crypto-stellar` public dataset).
 *
 * This is the cold-start discovery source for the one-off Blend bootstrap
 * script (`scripts/blend-bootstrap.ts`), which seeds `products` on a fresh
 * environment: it returns the full historical set, unbounded by the RPC's
 * ~7-day event retention. It also surfaces superseded redeployments still in
 * `status: Setup` — those are filtered downstream by the per-pool
 * `status === 6` guard in the enumerators.
 *
 * The query is parameterized on `@factory_ids` — the factory addresses are
 * never string-interpolated. Pool ids come back as UPPERCASE strkey already;
 * `.toUpperCase()` is a cheap guard. Output is deduped and sorted per version.
 */
export async function fetchBlendPoolDeploys(
  client: BigQuery,
  factories: { v1: string; v2: string }
): Promise<{ v1: string[]; v2: string[] }> {
  const query = `
    SELECT DISTINCT
      JSON_VALUE(data_decoded, '$.address') AS pool_id,
      contract_id                           AS factory_id
    FROM \`crypto-stellar.crypto_stellar.history_contract_events\`
    WHERE contract_id IN UNNEST(@factory_ids)
      AND closed_at >= '2024-05-01'
      AND type_string = 'ContractEventTypeContract'
      AND successful AND in_successful_contract_call
  `

  const [job] = await client.createQueryJob({
    query,
    params: { factory_ids: [factories.v1, factories.v2] },
    location: 'US',
  })
  const [rows] = (await job.getQueryResults()) as [DeployRow[]]

  const v1 = new Set<string>()
  const v2 = new Set<string>()
  for (const row of rows) {
    if (!row.pool_id) continue
    const poolId = row.pool_id.toUpperCase()
    if (row.factory_id === factories.v1) v1.add(poolId)
    else if (row.factory_id === factories.v2) v2.add(poolId)
  }

  return {
    v1: [...v1].sort(),
    v2: [...v2].sort(),
  }
}
