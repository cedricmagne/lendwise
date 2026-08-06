export interface BlendSupplyMeta {
  wasmHash: string
  admin: string
  name: string
  backstop: string
  backstopRate: number
  maxPositions: number
  minCollateral: bigint
  oracle: string
  status: number
  reserveList: string[]
  latestLedger: number
}

export interface BlendBorrowMeta {
  wasmHash: string
  admin: string
  name: string
  backstop: string
  backstopRate: number
  maxPositions: number
  minCollateral: bigint
  oracle: string
  status: number
  reserveList: string[]
  latestLedger: number
}

export type TokenMetadata = {
  address: string
  symbol: string
  name: string
  decimals: number
}
