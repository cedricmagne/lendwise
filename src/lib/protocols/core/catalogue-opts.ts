import type { ProtocolName } from '@/config/protocols-meta'
import { YIELD_ADAPTERS } from '@/config/protocols-server'
import { distinctProtocolAddresses } from '@/lib/db/repositories/products'
import type { FetchOpts } from '@/lib/protocols/core/types'

/**
 * For each adapter that does NOT discover its own markets
 * (`ownsMarketDiscovery === false` — it has no on-chain enumeration), pre-resolve
 * its pool set from the `products` catalogue and hand it in via `opts.poolIds`.
 * The adapter stays DB-blind — same contract as `getApyHistory(params.targets)`.
 *
 * `activeOnly` — the 10-minute spot collector passes `true` (only probe what is
 * currently listed); the hourly catalogue sync passes `false` (probe everything
 * ever seen, so a relisting is caught).
 *
 * NOT guarded: a DB failure here throws and fails the run. Fail-safe — an empty
 * opts would make the adapter enumerate zero pools, which
 * `syncProviderProducts` reads as "the provider delisted its entire catalogue".
 */
export async function catalogueFetchOpts(
  ids: ProtocolName[],
  { activeOnly }: { activeOnly: boolean }
): Promise<Map<ProtocolName, FetchOpts>> {
  const out = new Map<ProtocolName, FetchOpts>()
  for (const id of ids) {
    const adapter = await YIELD_ADAPTERS[id]()
    if (adapter.ownsMarketDiscovery !== false) continue
    out.set(id, {
      poolIds: await distinctProtocolAddresses(
        adapter.provider,
        adapter.version,
        { activeOnly }
      ),
    })
  }
  return out
}
