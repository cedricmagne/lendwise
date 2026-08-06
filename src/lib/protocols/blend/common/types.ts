export interface BlendSupplyMeta {
  wasmHash: string
  admin: string
  name: string
  backstop: string
  backstopRate: number
  maxPositions: number
  /** Stroops-scale integer, kept as a string: jsonb goes through JSON.stringify, which throws on a BigInt. */
  minCollateral: string
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
  /** Stroops-scale integer, kept as a string: jsonb goes through JSON.stringify, which throws on a BigInt. */
  minCollateral: string
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
