import { BigQuery } from '@google-cloud/bigquery'

// `undefined` = not yet resolved; `null` = resolved to "no client available".
let client: BigQuery | null | undefined

/**
 * Lazy BigQuery client, or `null` when GCP credentials are absent or
 * unparseable. Never throws: Hubble discovery is an optional enrichment term,
 * so a missing `GCP_PROJECT` / `GCP_SERVICE_ACCOUNT_BASE64` or a malformed
 * base64 blob must degrade the caller, not crash the sync.
 */
export function getHubbleClient(): BigQuery | null {
  if (client !== undefined) return client

  const projectId = process.env.GCP_PROJECT
  const b64 = process.env.GCP_SERVICE_ACCOUNT_BASE64
  if (!projectId || !b64) {
    client = null
    return client
  }

  try {
    const credentials = JSON.parse(
      Buffer.from(b64, 'base64').toString('utf8')
    ) as Record<string, unknown>
    client = new BigQuery({ projectId, credentials })
  } catch {
    client = null
  }
  return client
}
