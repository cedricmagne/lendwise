'use client'

import type { CSSProperties, ReactNode } from 'react'

import { ArrowUpRight } from 'lucide-react'
import { motion, useReducedMotion } from 'motion/react'
import { useTheme } from 'next-themes'

import { CodeBlock } from '@/components/animate-ui/primitives/animate/code-block'
import { Reveal, useRevealed } from '@/components/motion/reveal'
import { sliderTransition } from '@/lib/motion'
import { cn } from '@/lib/utils'

import { Cube } from './Cube'

type Point = { b: string; s: string; href?: string }

function PointBody({ p }: { p: Point }) {
  return (
    <>
      <Cube className="mt-0.5 scale-[0.85]" />
      <span>
        <b className="text-foreground block font-semibold">{p.b}</b>
        <span className="text-muted-foreground">{p.s}</span>
      </span>
    </>
  )
}

function Points({ items }: { items: Point[] }) {
  const row = 'flex items-start gap-3.5 py-3.25 text-[14px]'
  return (
    <ul className="m-0 flex list-none flex-col p-0">
      {items.map((p) => (
        <li key={p.b} className="border-border/60 border-t">
          {p.href ? (
            <a href={p.href} className={cn(row, 'group')}>
              <PointBody p={p} />
              <ArrowUpRight className="text-ink-faint group-hover:text-brand-bright mt-1 ml-auto h-4 w-4 shrink-0 transition-all group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
            </a>
          ) : (
            <span className={row}>
              <PointBody p={p} />
            </span>
          )}
        </li>
      ))}
    </ul>
  )
}

function Feature({
  flip = false,
  first = false,
  last = false,
  id,
  idx,
  eyebrow,
  title,
  body,
  points,
  visual,
}: {
  flip?: boolean
  first?: boolean
  last?: boolean
  id: string
  idx: string
  eyebrow: string
  title: string
  body: string
  points: Point[]
  visual: ReactNode
}) {
  return (
    <Reveal
      id={id}
      className={cn(
        'border-border/60 grid scroll-mt-17 grid-cols-[5fr_6fr] items-center gap-18 border-t py-22',
        'max-desk:grid-cols-1 max-desk:gap-10 max-desk:py-16',
        first && 'max-desk:pt-0 border-t-0 pt-0',
        last && 'max-desk:pb-0 pb-0'
      )}
    >
      <div className={cn(flip && 'max-desk:order-1 order-2')}>
        <p className="mono-label">
          <span className="text-brand-bright">/ {idx}</span> {eyebrow}
        </p>
        <h3 className="text-foreground mt-4 mb-3 text-[30px] leading-[1.1] font-semibold tracking-[-0.03em]">
          {title}
        </h3>
        <p className="text-muted-foreground m-0 mb-6.5 text-[15.5px] leading-[1.6]">
          {body}
        </p>
        <Points items={points} />
      </div>
      <div className={cn(flip && 'max-desk:order-2 order-1')}>{visual}</div>
    </Reveal>
  )
}

function Panel({ children }: { children: ReactNode }) {
  return (
    <div className="bg-card border-border overflow-hidden rounded-md border shadow-xl">
      {children}
    </div>
  )
}

function PanelBar({ label, right }: { label: string; right: string }) {
  return (
    <div className="border-border/60 text-ink-faint flex items-center gap-2.5 border-b px-4.5 py-3 font-mono text-[11px] tracking-[0.08em] uppercase">
      <span className="bg-brand-bright h-1.75 w-1.75 rounded-full" /> {label}
      <span className="ml-auto tracking-normal normal-case">{right}</span>
    </div>
  )
}

const standardRows = [
  ['Aave V3', 'Ethereum', '3.21%', '3.18%'],
  ['Compound', 'Ethereum', '2.89%', '2.85%'],
  ['Venus', 'BSC', '5.41%', '4.92%'],
  ['Morpho', 'Base', '4.15%', '4.10%'],
  ['Spark', 'Gnosis', '5.00%', '4.97%'],
]

function StandardPanel() {
  const td = 'border-border/60 border-b px-4.5 py-3.25'
  const th =
    'text-ink-faint border-border/60 border-b px-4.5 py-3 text-left text-[10.5px] font-medium tracking-[0.1em] uppercase'
  return (
    <Panel>
      <PanelBar label="yield_standardization" right="60s refresh" />
      {/* the 4 columns don't fit under ~430px — scroll the table, not the page */}
      <div className="overflow-x-auto">
        <table className="w-full min-w-105 border-collapse font-mono text-[13px] [&_tr:last-child>td]:border-b-0">
          <thead>
            <tr>
              <th className={th}>Protocol</th>
              <th className={th}>Chain</th>
              <th className={th}>Raw APY</th>
              <th className={cn(th, 'text-right')}>Standardized</th>
            </tr>
          </thead>
          <tbody>
            {standardRows.map((r) => (
              <tr key={r[0]}>
                <td
                  className={cn(
                    td,
                    'text-foreground font-sans text-[13.5px] font-semibold whitespace-nowrap'
                  )}
                >
                  {r[0]}
                </td>
                <td
                  className={cn(td, 'text-muted-foreground whitespace-nowrap')}
                >
                  {r[1]}
                </td>
                <td
                  className={cn(td, 'text-muted-foreground whitespace-nowrap')}
                >
                  {r[2]}
                </td>
                <td
                  className={cn(
                    td,
                    'text-rose text-right font-semibold whitespace-nowrap'
                  )}
                >
                  {r[3]}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  )
}

const positions = [
  { name: 'Aave V3 USDC', chain: 'ETHEREUM', pct: 35, apy: '4.12%', hot: true },
  { name: 'Morpho Blue', chain: 'BASE', pct: 28, apy: '5.87%', hot: false },
  { name: 'Pendle PT', chain: 'ARBITRUM', pct: 22, apy: '8.21%', hot: false },
  { name: 'Yearn V3', chain: 'ETHEREUM', pct: 15, apy: '3.95%', hot: false },
]

const deltaStyle: CSSProperties = {
  borderColor: 'oklch(from var(--primary) l calc(c * 0.6) h / 0.5)',
  background: 'oklch(from var(--primary) l c h / 0.12)',
}

function OptimizerPanel() {
  const revealed = useRevealed()
  const reduced = useReducedMotion() ?? false

  return (
    <Panel>
      <PanelBar label="optimized_portfolio" right="4 positions" />
      <div className="px-4.5 py-5.5">
        <div className="mb-5 flex items-baseline gap-3.5">
          <span className="text-foreground font-mono text-[34px] font-semibold tracking-[-0.02em]">
            5.82%
          </span>
          <span className="text-ink-faint text-[12.5px]">blended APY</span>
          <span
            className="text-rose ml-auto rounded-sm border px-2 py-0.75 font-mono text-[12px]"
            style={deltaStyle}
          >
            +2.4% vs manual
          </span>
        </div>
        {positions.map((p, index) => (
          <div
            key={p.name}
            className="border-border/60 grid grid-cols-[1fr_auto_auto] items-center gap-x-4 gap-y-1 border-t py-2.75"
          >
            <span className="text-foreground text-[13.5px] font-semibold">
              {p.name}
            </span>
            <span className="text-ink-faint font-mono text-[11px]">
              {p.chain}
            </span>
            <span className="text-muted-foreground font-mono text-[13px]">
              {p.pct}% · {p.apy}
            </span>
            <span className="bg-border/60 col-span-full h-1 overflow-hidden rounded-sm">
              <motion.i
                className={cn(
                  'block h-full rounded-sm',
                  p.hot ? 'bg-brand-bright' : 'bg-primary'
                )}
                data-slider=""
                style={{ '--target-width': `${p.pct}%` } as CSSProperties}
                initial={{ width: reduced ? `${p.pct}%` : 0 }}
                animate={{ width: revealed || reduced ? `${p.pct}%` : 0 }}
                transition={sliderTransition(reduced, index)}
              />
            </span>
          </div>
        ))}
        <div className="mt-4.5 flex gap-2">
          {['Low risk', 'Auto-compound'].map((t) => (
            <span
              key={t}
              className="text-muted-foreground border-border rounded-full border px-3 py-1 font-mono text-[11px]"
            >
              {t}
            </span>
          ))}
        </div>
      </div>
    </Panel>
  )
}

function ApiPanel() {
  const { resolvedTheme } = useTheme()

  return (
    <Panel>
      <PanelBar label="graphql_playground" right="connected" />
      <div className="px-5.5 py-5">
        <CodeBlock
          code={`{
  latestSupplyApy {
    items {
      apy {
        base
        fees
        net
        rewards
      }
      asset
      product {
        protocol {
          chain {
            name
            id
          }
          name
          provider
        }
      }
    }
  }
}`}
          lang="graphql"
          theme={resolvedTheme === 'dark' ? 'dark' : 'light'}
          writing={true}
          duration={5000}
          delay={0}
          inView
          inViewOnce
          className="min-h-90 text-xs"
        />
      </div>
      <div className="border-border/60 text-ink-faint flex gap-4 border-t px-5.5 py-3 font-mono text-[12px]">
        <b className="text-rose font-medium">200</b> response · 12ms{' '}
        <span>{'{ data: { latestSupplyApy: { items: [...] } } }'}</span>
      </div>
    </Panel>
  )
}

const folio = [
  {
    ic: 'US',
    name: 'USDC',
    src: 'Aave V3 · Ethereum',
    val: '$12,450',
    d: '+$245',
    neg: false,
  },
  {
    ic: 'ET',
    name: 'ETH',
    src: 'Lido · Ethereum',
    val: '$8,200',
    d: '+$180',
    neg: false,
  },
  {
    ic: 'DA',
    name: 'DAI',
    src: 'Morpho · Base',
    val: '$5,100',
    d: '−$12',
    neg: true,
  },
]

function PortfolioPanel() {
  return (
    <Panel>
      <PanelBar label="portfolio_tracker" right="3 wallets" />
      <div className="px-4.5 pt-5.5 pb-2">
        <div className="text-foreground font-mono text-[34px] font-semibold tracking-[-0.02em]">
          $25,750
        </div>
        <div className="text-ink-faint mt-1 mb-4.5 text-[12.5px]">
          Total value ·{' '}
          <b className="text-rose font-mono font-medium">+12.4% (30d)</b>
        </div>
        {folio.map((f) => (
          <div
            key={f.name}
            className="border-border/60 flex items-center gap-3.5 border-t py-3"
          >
            <span className="bg-border/60 border-border text-muted-foreground grid h-8 w-8 place-items-center rounded border font-mono text-[10px] font-semibold">
              {f.ic}
            </span>
            <span>
              <b className="text-foreground block text-[13.5px] font-semibold">
                {f.name}
              </b>
              <span className="text-ink-faint text-[11.5px]">{f.src}</span>
            </span>
            <span className="ml-auto text-right font-mono">
              <b className="text-foreground block text-[13.5px] font-semibold">
                {f.val}
              </b>
              <span
                className={cn(
                  'text-[11.5px]',
                  f.neg ? 'text-ink-faint' : 'text-rose'
                )}
              >
                {f.d}
              </span>
            </span>
          </div>
        ))}
      </div>
    </Panel>
  )
}

const features = [
  {
    id: 'standard',
    eyebrow: 'Standard',
    title: 'Market intelligence',
    body: 'Our engine standardizes lending yield data across protocols, vaults and chains, adjusting for rate conventions and averaging windows. Compare protocols, vaults and chains using standardized metrics, historical trends and market context.',
    points: [
      {
        b: 'Multi-chain coverage',
        s: 'Standardized yields across Aave, Morpho, Compound and more.',
      },
      {
        b: 'Live market data',
        s: 'APYs and market conditions updated every 60 seconds.',
      },
      {
        b: 'Historical trends',
        s: 'Compare APY trends across markets and vaults.',
      },
    ],
    visual: <StandardPanel />,
  },
  {
    id: 'optimizer',
    eyebrow: 'Optimizer',
    title: 'Optimization engine',
    body: 'Optimize lending and borrowing across protocols, vaults and chains using configurable risk preferences and market constraints.',
    points: [
      {
        b: 'Smart strategy',
        s: 'Identify opportunities based on yield, risk and market conditions.',
      },
      {
        b: 'Risk-aware',
        s: 'Configure risk preferences and diversification levels.',
      },
      {
        b: 'Auto-rebalance',
        s: 'Automated on-chain rebalancing as markets evolve.',
      },
    ],
    visual: <OptimizerPanel />,
  },
  {
    id: 'api',
    eyebrow: 'API',
    title: 'Data layer',
    body: 'Standardized lending yield, protocol and market data through a simple GraphQL API built for production integrations.',
    points: [
      {
        b: 'GraphQL API',
        s: 'Flexible query interface for any stack.',
        href: '/docs/api/',
      },
      { b: '99.9% uptime SLA', s: 'Enterprise-grade reliability.' },
      { b: 'Webhooks', s: 'Real-time yield change notifications.' },
    ],
    visual: <ApiPanel />,
  },
  {
    id: 'portfolio',
    eyebrow: 'Portfolio',
    title: 'Portfolio tracker',
    body: 'Connect your wallets and monitor lending positions, PnL and yield performance from a unified dashboard.',
    points: [
      {
        b: 'Multi-wallet support',
        s: 'Connect unlimited addresses.',
        href: '/portfolio',
      },
      { b: 'Smart alerts', s: 'Stay informed on market movements.' },
      {
        b: 'Full history',
        s: 'Access historical yields and transactions.',
      },
    ],
    visual: <PortfolioPanel />,
  },
]

export function Features() {
  return (
    <section
      className="border-border/60 scroll-mt-17 border-b"
      id="features"
      data-screen-label="Features"
    >
      <div className="wrap py-27.5">
        {features.map((f, i) => (
          <Feature
            key={f.id}
            {...f}
            idx={String(i + 1).padStart(2, '0')}
            flip={i % 2 === 1}
            first={i === 0}
            last={i === features.length - 1}
          />
        ))}
      </div>
    </section>
  )
}
