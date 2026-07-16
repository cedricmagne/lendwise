import { gql } from 'urql'

/**
 * Shared queries for Compound V3.
 * These work for Ethereum and Polygon subgraphs.
 * For chains with different schemas (like Base), use chain-specific queries.
 */

export const USER_SUPPLY_POSITIONS = gql`
  query UserSupplyPositions($where: Account_filter) {
    accounts(where: $where) {
      address
      positions(where: { accounting_: { baseBalance_gt: 0 } }) {
        market {
          id
          configuration {
            name
            symbol
            baseToken {
              token {
                symbol
                name
                decimals
                address
              }
            }
          }
          accounting {
            baseSupplyIndex
            supplyApr
            netSupplyApr
            totalBaseSupply
            rewardSupplyApr
            totalBaseSupplyUsd
            trackingSupplyIndex
            totalBasePrincipalSupply
          }
        }
        accounting {
          id
          lastUpdatedBlockNumber
          baseBalance
          baseBalanceUsd
          basePrincipal
          baseTrackingAccrued
        }
      }
    }
  }
`

export const USER_BORROW_POSITIONS = gql`
  query UserBorrowPositions($where: Account_filter) {
    accounts(where: $where) {
      address
      positions(where: { accounting_: { baseBalance_lt: 0 } }) {
        creationBlockNumber
        market {
          id
          configuration {
            name
            symbol
            baseToken {
              token {
                symbol
                name
                decimals
                address
              }
            }
          }
          accounting {
            baseBorrowIndex
            borrowApr
            netBorrowApr
            totalBaseBorrow
            rewardBorrowApr
            totalBaseBorrowUsd
            trackingBorrowIndex
            totalBasePrincipalBorrow
          }
        }
        accounting {
          id
          baseBalance
          baseBalanceUsd
          basePrincipal
          baseTrackingAccrued
          collateralBalances {
            balance
            balanceUsd
            collateralToken {
              borrowCollateralFactor
              liquidationFactor
              token {
                name
                symbol
                decimals
                address
              }
            }
          }
        }
      }
    }
  }
`
export const MARKETS_APY = gql`
  query MarketsApy {
    markets {
      id
      configuration {
        symbol
        baseToken {
          lastPriceUsd
        }
      }
      accounting {
        supplyApr
        netSupplyApr
        rewardSupplyApr
        baseSupplyIndex
        totalBaseSupply
        totalBasePrincipalSupply
        totalBaseSupplyUsd
        trackingSupplyIndex
        borrowApr
        netBorrowApr
        rewardBorrowApr
        baseBorrowIndex
        totalBaseBorrow
        totalBaseBorrowUsd
        trackingBorrowIndex
        totalBasePrincipalBorrow
        utilization
        collateralBalanceUsd
        collateralReservesBalanceUsd
      }
    }
  }
`

export const MARKETS_ALL = gql`
  query MarketsAll {
    markets {
      id
      configuration {
        baseToken {
          token {
            symbol
            name
            decimals
            address
          }
        }
        collateralTokens {
          borrowCollateralFactor
          liquidationFactor
          liquidateCollateralFactor
          token {
            address
            decimals
            name
            symbol
          }
        }
      }
    }
  }
`

export const LIST_BORROW_PRODUCTS = gql`
  query ListBorrowProducts {
    markets {
      id
      accounting {
        totalBaseSupply
        totalBaseSupplyUsd
        totalBaseBorrow
        totalBaseBorrowUsd
        netBorrowApr
      }
      configuration {
        baseToken {
          token {
            symbol
            name
            decimals
            address
          }
        }
        collateralTokens {
          borrowCollateralFactor
          liquidateCollateralFactor
          token {
            symbol
            name
            decimals
            address
          }
        }
      }
    }
  }
`

export const LIST_SUPPLY_PRODUCTS = gql`
  query ListSupplyProducts {
    markets {
      id
      accounting {
        totalBaseSupply
        totalBaseSupplyUsd
        totalBaseBorrow
        totalBaseBorrowUsd
        totalReserveBalanceUsd
        collateralization
        netSupplyApr
      }
      configuration {
        baseToken {
          token {
            symbol
            name
            decimals
            address
          }
        }
        collateralTokens {
          borrowCollateralFactor
          liquidationFactor
          liquidateCollateralFactor
          token {
            address
            decimals
            name
            symbol
          }
        }
      }
    }
  }
`

// ─── Historical data queries ──────────────────────────────────────────────────

export const MARKET_DAILY_ACCOUNTING = gql`
  query MarketDailyAccounting(
    $where: DailyMarketAccounting_filter
    $first: Int
    $skip: Int
    $orderBy: DailyMarketAccounting_orderBy
    $orderDirection: OrderDirection
  ) {
    dailyMarketAccountings(
      where: $where
      first: $first
      skip: $skip
      orderBy: $orderBy
      orderDirection: $orderDirection
    ) {
      timestamp
      market {
        id
        configuration {
          symbol
          baseToken {
            lastPriceUsd
          }
        }
      }
      accounting {
        supplyApr
        netSupplyApr
        rewardSupplyApr
        borrowApr
        netBorrowApr
        rewardBorrowApr
        totalBaseSupply
        totalBaseSupplyUsd
        totalBaseBorrow
        totalBaseBorrowUsd
        utilization
        collateralBalanceUsd
      }
    }
  }
`

export const MARKET_HOURLY_ACCOUNTING = gql`
  query MarketHourlyAccounting(
    $where: HourlyMarketAccounting_filter
    $first: Int
    $skip: Int
    $orderBy: HourlyMarketAccounting_orderBy
    $orderDirection: OrderDirection
  ) {
    hourlyMarketAccountings(
      where: $where
      first: $first
      skip: $skip
      orderBy: $orderBy
      orderDirection: $orderDirection
    ) {
      timestamp
      market {
        id
        configuration {
          symbol
          baseToken {
            lastPriceUsd
          }
        }
      }
      accounting {
        supplyApr
        netSupplyApr
        rewardSupplyApr
        borrowApr
        netBorrowApr
        rewardBorrowApr
        totalBaseSupply
        totalBaseSupplyUsd
        totalBaseBorrow
        totalBaseBorrowUsd
        utilization
        collateralBalanceUsd
      }
    }
  }
`
