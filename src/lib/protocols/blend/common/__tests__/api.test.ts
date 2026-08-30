import { Address, rpc as stellarRpc, xdr } from '@stellar/stellar-sdk'
import { describe, expect, it } from 'vitest'

import { deployedPoolsFromEvents } from '../api'

/**
 * `deployedPoolsFromEvents` is pure — it parses raw `getEvents` responses with
 * blend-sdk's `poolFactoryEventFromEventResponse` and returns the deployed pool
 * addresses, UPPERCASE / deduped / sorted. No network here; the RPC loop that
 * feeds it (`getFactoryDeployedPools`) hits live infra and is not unit-tested,
 * exactly like its siblings in `api.ts`.
 */

const POOL_1 = Address.contract(Buffer.alloc(32, 1)).toString()
const POOL_2 = Address.contract(Buffer.alloc(32, 2)).toString()
const POOL_3 = Address.contract(Buffer.alloc(32, 3)).toString()
const FACTORY_ID = Address.contract(Buffer.alloc(32, 9)).toString()

let seq = 0

/** Minimal well-formed `RawEventResponse` with caller-supplied topic + value. */
function rawEvent(
  parts: Pick<stellarRpc.Api.RawEventResponse, 'topic' | 'value'>
): stellarRpc.Api.RawEventResponse {
  seq += 1
  return {
    id: `${String(seq).padStart(19, '0')}-0000000001`,
    type: 'contract',
    ledger: 1_000 + seq,
    ledgerClosedAt: '2026-08-28T00:00:00Z',
    contractId: FACTORY_ID,
    transactionIndex: 0,
    operationIndex: 0,
    inSuccessfulContractCall: true,
    txHash: `${String(seq).padStart(64, '0')}`,
    ...parts,
  }
}

/** A real factory `Deploy` event: one `deploy` symbol topic, address as value. */
function deployEvent(poolId: string): stellarRpc.Api.RawEventResponse {
  return rawEvent({
    topic: [xdr.ScVal.scvSymbol('deploy').toXDR('base64')],
    value: Address.fromString(poolId).toScVal().toXDR('base64'),
  })
}

describe('deployedPoolsFromEvents', () => {
  it('returns the pool addresses of a page of Deploy events, sorted', () => {
    const result = deployedPoolsFromEvents([
      deployEvent(POOL_2),
      deployEvent(POOL_1),
    ])

    expect(result).toEqual([POOL_1, POOL_2])
  })

  it('filters out non-Deploy and unparseable events', () => {
    const result = deployedPoolsFromEvents([
      deployEvent(POOL_1),
      // a different factory event topic → parser returns undefined
      rawEvent({
        topic: [xdr.ScVal.scvSymbol('set_admin').toXDR('base64')],
        value: Address.fromString(POOL_2).toScVal().toXDR('base64'),
      }),
      // garbage payloads → parser throws internally, returns undefined
      rawEvent({ topic: ['bm90LWJhc2U2NA=='], value: 'bm90LWJhc2U2NA==' }),
    ])

    expect(result).toEqual([POOL_1])
  })

  it('collapses a pool deployed more than once to a single entry', () => {
    const result = deployedPoolsFromEvents([
      deployEvent(POOL_3),
      deployEvent(POOL_3),
      deployEvent(POOL_1),
    ])

    expect(result).toEqual([POOL_1, POOL_3])
    expect(new Set(result).size).toBe(result.length)
  })

  it('returns [] for an empty page', () => {
    expect(deployedPoolsFromEvents([])).toEqual([])
  })

  it('emits canonical UPPERCASE strkey addresses', () => {
    const [addr] = deployedPoolsFromEvents([deployEvent(POOL_1)])
    expect(addr).toBe(addr?.toUpperCase())
    expect(addr).toBe(POOL_1)
  })
})
