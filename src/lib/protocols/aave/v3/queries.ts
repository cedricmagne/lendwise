import { gql } from 'urql'

export const USER_SUPPLY_POSITIONS = gql`
  query UserSupplyPositions($request: UserSuppliesRequest!) {
    userSupplies(request: $request) {
      balance {
        amount {
          raw
          value
          decimals
        }
        usd
        usdPerToken
      }
      apy {
        decimals
        formatted
        raw
        value
      }
      canBeCollateral
      currency {
        address
        chainId
        decimals
        imageUrl
        name
        symbol
      }
      isCollateral
      market {
        address
        icon
        name
        chain {
          chainId
          explorerUrl
          icon
          isTestnet
          name
          nativeWrappedToken
        }
      }
    }
  }
`

export const USER_BORROW_POSITIONS = gql`
  query UserBorrowPositions($request: UserBorrowsRequest!) {
    userBorrows(request: $request) {
      apy {
        decimals
        formatted
        raw
        value
      }
      currency {
        address
        chainId
        name
        imageUrl
        symbol
        decimals
      }
      debt {
        usdPerToken
        amount {
          raw
          decimals
          value
        }
        usd
      }
      market {
        name
        chain {
          name
          icon
          chainId
          explorerUrl
          isTestnet
          nativeWrappedToken
        }
        address
        icon
      }
    }
  }
`
export const USER_MARKET_HEALTH_FACTOR = gql`
  query UserMarketHealthFactor($request: UserMarketStateRequest!) {
    userMarketState(request: $request) {
      healthFactor
    }
  }
`
export const USER_LEND_COLLATERALS = gql`
  query UserSupplyCollaterals($request: UserSuppliesRequest!) {
    userSupplies(request: $request) {
      isCollateral
      balance {
        amount {
          raw
          value
          decimals
        }
        usd
        usdPerToken
      }
      currency {
        address
        chainId
        decimals
        imageUrl
        name
        symbol
      }
      market {
        address
        chain {
          chainId
        }
      }
    }
  }
`
export const MARKET_BORROW_HISTORY = gql`
  query MarketBorrowHistoryRates($request: BorrowAPYHistoryRequest!) {
    borrowAPYHistory(request: $request) {
      avgRate {
        value
      }
      date
    }
  }
`
export const MARKET_SUPPLY_HISTORY = gql`
  query MarketSupplyHistoryRates($request: SupplyAPYHistoryRequest!) {
    supplyAPYHistory(request: $request) {
      avgRate {
        value
      }
      date
    }
  }
`
export const ALL_MARKETS = gql`
  query Markets($request: MarketsRequest!) {
    markets(request: $request) {
      address
      chain {
        chainId
      }
      name
    }
  }
`

export const MARKETS_APY = gql`
  query MarketsApy($request: MarketsRequest!) {
    markets(request: $request) {
      reserves {
        market {
          name
          address
          chain {
            name
            chainId
          }
        }
        underlyingToken {
          symbol
          name
          address
          decimals
        }
        vToken {
          name
          symbol
          address
          decimals
        }
        aToken {
          name
          symbol
          address
          decimals
        }
        usdExchangeRate
        supplyInfo {
          canBeCollateral
          total {
            value
          }
          supplyCap {
            usd
            amount {
              value
            }
          }
          maxLTV {
            value
          }
          liquidationThreshold {
            value
          }
          apy {
            value
          }
        }
        borrowInfo {
          borrowingState
          borrowCapReached
          variableRateSlope1 {
            value
          }
          variableRateSlope2 {
            value
          }
          optimalUsageRate {
            value
          }
          baseVariableBorrowRate {
            value
          }
          apy {
            value
          }
          total {
            amount {
              value
            }
            usd
          }
          reserveFactor {
            value
          }
        }
        size {
          amount {
            value
          }
          usd
        }
        incentives {
          ... on AaveSupplyIncentive {
            rewardTokenAddress
            rewardTokenSymbol
            extraSupplyApr {
              value
            }
          }
          ... on AaveBorrowIncentive {
            rewardTokenAddress
            rewardTokenSymbol
            borrowAprDiscount {
              value
            }
          }
          ... on MeritSupplyIncentive {
            extraSupplyApr {
              value
            }
          }
          ... on MeritBorrowIncentive {
            borrowAprDiscount {
              value
            }
          }
          ... on MeritBorrowAndSupplyIncentiveCondition {
            borrowToken {
              symbol
            }
            supplyToken {
              symbol
            }
            extraApr {
              value
            }
          }
        }
      }
    }
  }
`

export const MARKETS_WITH_TOKENS = gql`
  query MarketsWithTokens($request: MarketsRequest!) {
    markets(request: $request) {
      address
      name
      chain {
        name
        chainId
      }
      reserves {
        underlyingToken {
          address
          symbol
        }
      }
    }
  }
`

export const APY_HISTORY = gql`
  query ApyHistory(
    $supplyRequest: SupplyAPYHistoryRequest!
    $borrowRequest: BorrowAPYHistoryRequest!
  ) {
    supplyAPYHistory(request: $supplyRequest) {
      date
      avgRate {
        value
      }
    }
    borrowAPYHistory(request: $borrowRequest) {
      date
      avgRate {
        value
      }
    }
  }
`

export const LIST_BORROW_PRODUCTS = gql`
  query ListBorrowProducts($request: MarketsRequest!) {
    markets(request: $request) {
      address
      name
      chain {
        name
        chainId
      }
      reserves {
        size {
          amount {
            raw
          }
          usd
          usdPerToken
        }
        supplyInfo {
          canBeCollateral
          maxLTV {
            value
          }
          liquidationThreshold {
            value
          }
          total {
            decimals
            value
            raw
          }
        }
        borrowInfo {
          borrowingState
          apy {
            value
          }
          total {
            usd
            amount {
              decimals
              value
              raw
            }
          }
        }
        underlyingToken {
          address
          name
          symbol
          decimals
        }
      }
    }
  }
`

export const LIST_SUPPLY_PRODUCTS = gql`
  query ListSupplyProducts($request: MarketsRequest!) {
    markets(request: $request) {
      address
      name
      chain {
        name
        chainId
      }
      reserves {
        size {
          usd
          usdPerToken
        }
        supplyInfo {
          apy {
            value
          }
          total {
            decimals
            value
            raw
          }
        }
        borrowInfo {
          total {
            usd
            amount {
              raw
              value
            }
          }
        }
        underlyingToken {
          address
          name
          symbol
          decimals
        }
      }
    }
  }
`
