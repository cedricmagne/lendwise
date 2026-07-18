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
    'Lendwise standardizes DeFi lending rates to one comparable net APY and optimizes capital allocation by risk profile and investment horizon.',
}

export default async function AboutPage() {
  const catalog = await catalogStatsSafe()
  return (
    <>
      <PageHeader label="COMPANY" title="One standard for DeFi lending." />
      <Prose>
        <p>
          DeFi lending is fragmented. Every protocol quotes rates its own way —
          APR or APY, per-second or daily compounding — rewards live in separate
          systems, and fees quietly eat into headline numbers. Comparing two
          markets side by side is harder than it should be.
        </p>
        <p>Lendwise exists to fix that, with two promises:</p>
        <h2>One standard</h2>
        <p>
          We track {roundedCount(catalog?.activeProducts)} supply and borrow
          markets across Aave, Morpho and Compound on {STANDARDIZED_CHAIN_COUNT}{' '}
          chains, and standardize every rate
          to one net APY (base
          ± fees ± rewards), refreshed every 10 minutes with 180 days of
          history. Standardized numbers you can actually compare.
        </p>
        <h2>One allocation</h2>
        <p>
          Comparable rates are the input, not the goal. Our optimizer tells you
          how to allocate capital across those markets, matched to your risk
          profile and investment horizon.
        </p>
        <h2>Open source</h2>
        <p>
          The platform is open source under the MIT license. The data model, the
          adapter contract and the validation harness are public — anyone can
          audit how a number is produced, or{' '}
          <a
            href="https://github.com/lendwise-fi/lendwise"
            target="_blank"
            rel="noopener noreferrer"
          >
            contribute a new protocol adapter on GitHub
          </a>
          .
        </p>
        <h2>Non-custodial by design</h2>
        <p>
          Lendwise is a read-only analytics layer. We never hold funds, never
          ask for private keys, and never execute transactions on your behalf.
        </p>
        <p>
          Questions? <Link href="/contact">Get in touch</Link>.
        </p>
      </Prose>
    </>
  )
}
