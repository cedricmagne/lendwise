import type { Metadata } from 'next'

import Link from 'next/link'

import { STANDARDIZED_CHAIN_COUNT } from '@/config/chains-coverage'
import { catalogStatsSafe } from '@/lib/catalog-stats'

import { PageHeader, Prose } from '../prose'

export const revalidate = 3600

/** 937 → "900+" — prose ages better than an exact number redeployed hourly. */
function roundedCount(n: number | undefined): string {
  return n && n >= 100 ? `${Math.floor(n / 100) * 100}+` : '700+'
}

export const metadata: Metadata = {
  title: 'About - Lendwise',
  description:
    'Standardize, compare and optimize APYs across Aave, Morpho and Compound on 25+ chains.',
}

export default async function AboutPage() {
  const catalog = await catalogStatsSafe()
  return (
    <>
      <PageHeader label="COMPANY" title="Unified view for lending markets." />
      <Prose>
        <p>
          DeFi lending is fragmented. Protocols use different rate conventions,
          compounding methods, rewards and fees. As a result, lending markets
          are not directly comparable.
        </p>
        <p>Lendwise addresses this through four core principles:</p>
        <h2>One standard</h2>
        <p>
          We track {roundedCount(catalog?.activeProducts)} supply and borrow
          markets across Aave, Morpho and Compound on {STANDARDIZED_CHAIN_COUNT}{' '}
          chains. Every rate is standardized into one comparable net APY,
          accounting for fees and rewards. Market data is refreshed every 60
          seconds, with 180 days of history.
        </p>
        <h2>One allocation</h2>
        <p>
          Standardized rates are the foundation for smart capital allocation.
          Our optimizer then determines how capital should be allocated across
          markets based on yield, risk preferences, diversification constraints
          and investment horizon.
        </p>
        <h2>Open source</h2>
        <p>
          Lendwise is open source under the MIT license. The data model,
          protocol adapters and validation tools are public. Anyone can audit
          how each rate is calculated and{' '}
          <a
            href="https://github.com/lendwise-fi/lendwise"
            target="_blank"
            rel="noopener noreferrer"
          >
            contribute a new protocol adapter on GitHub.
          </a>
        </p>
        <h2>Non-custodial by design</h2>
        <p>
          Lendwise is non-custodial. We never hold user funds or ask for private
          keys. Any on-chain transaction must be approved and signed by the
          user.
        </p>
        <p>
          Questions? <Link href="/contact">Get in touch</Link>.
        </p>
      </Prose>
    </>
  )
}
