import type { CSSProperties, ReactNode } from 'react'

import { ArrowUpRight } from 'lucide-react'

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
  const row = 'flex items-start gap-[14px] py-[13px] text-[14px]'
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
    <div
      id={id}
      className={cn(
        'reveal border-border/60 grid grid-cols-[5fr_6fr] items-center gap-[72px] border-t py-[88px]',
        'max-[960px]:grid-cols-1 max-[960px]:gap-10 max-[960px]:py-16',
        first && 'border-t-0 pt-0 max-[960px]:pt-0',
        last && 'pb-0 max-[960px]:pb-0'
      )}
    >
      <div className={cn(flip && 'order-2 max-[960px]:order-1')}>
        <p className="mono-label">
          <span className="text-brand-bright">/ {idx}</span> {eyebrow}
        </p>
        <h3 className="text-foreground mt-4 mb-3 text-[30px] leading-[1.1] font-semibold tracking-[-0.03em]">
          {title}
        </h3>
        <p className="text-muted-foreground m-0 mb-[26px] text-[15.5px] leading-[1.6]">
          {body}
        </p>
        <Points items={points} />
      </div>
      <div className={cn(flip && 'order-1 max-[960px]:order-2')}>{visual}</div>
    </div>
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
    <div className="border-border/60 text-ink-faint flex items-center gap-2.5 border-b px-[18px] py-3 font-mono text-[11px] tracking-[0.08em] uppercase">
      <span className="bg-brand-bright h-[7px] w-[7px] rounded-full" /> {label}
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
  const td = 'border-border/60 border-b px-[18px] py-[13px]'
  const th =
    'text-ink-faint border-border/60 border-b px-[18px] py-3 text-left text-[10.5px] font-medium tracking-[0.1em] uppercase'
  return (
    <Panel>
      <PanelBar label="yield_standardization" right="60s refresh" />
      <table className="w-full border-collapse font-mono text-[13px] [&_tr:last-child>td]:border-b-0">
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
                  'text-foreground font-sans text-[13.5px] font-semibold'
                )}
              >
                {r[0]}
              </td>
              <td className={cn(td, 'text-muted-foreground')}>{r[1]}</td>
              <td className={cn(td, 'text-muted-foreground')}>{r[2]}</td>
              <td className={cn(td, 'text-rose text-right font-semibold')}>
                {r[3]}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
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
  return (
    <Panel>
      <PanelBar label="optimized_portfolio" right="4 positions" />
      <div className="px-[18px] py-[22px]">
        <div className="mb-5 flex items-baseline gap-[14px]">
          <span className="text-foreground font-mono text-[34px] font-semibold tracking-[-0.02em]">
            5.82%
          </span>
          <span className="text-ink-faint text-[12.5px]">blended APY</span>
          <span
            className="text-rose ml-auto rounded-[3px] border px-2 py-[3px] font-mono text-[12px]"
            style={deltaStyle}
          >
            +2.4% vs manual
          </span>
        </div>
        {positions.map((p) => (
          <div
            key={p.name}
            className="border-border/60 grid grid-cols-[1fr_auto_auto] items-center gap-x-4 gap-y-1 border-t py-[11px]"
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
            <span className="bg-border/60 col-span-full h-[4px] overflow-hidden rounded-[2px]">
              <i
                className={cn(
                  'block h-full rounded-[2px]',
                  p.hot ? 'bg-brand-bright' : 'bg-primary'
                )}
                style={{ width: `${p.pct}%` }}
              />
            </span>
          </div>
        ))}
        <div className="mt-[18px] flex gap-2">
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
  const fld = 'text-foreground'
  return (
    <Panel>
      <PanelBar label="graphql_playground" right="connected" />
      <div className="text-muted-foreground px-[22px] py-5 font-mono text-[13px] leading-[1.75]">
        <span className="text-rose">query</span> {'{'}
        <br />
        &nbsp;&nbsp;<span className={fld}>pools</span>(
        <span className={fld}>chain</span>:{' '}
        <span className="text-[oklch(0.62_0.06_140)]">
          &quot;ethereum&quot;
        </span>
        , <span className={fld}>orderBy</span>: <span className={fld}>apy</span>
        , <span className={fld}>first</span>:{' '}
        <span className="text-[oklch(0.68_0.08_80)]">5</span>) {'{'}
        <br />
        &nbsp;&nbsp;&nbsp;&nbsp;<span className={fld}>protocol</span>
        <br />
        &nbsp;&nbsp;&nbsp;&nbsp;<span className={fld}>tvl</span>
        <br />
        &nbsp;&nbsp;&nbsp;&nbsp;<span className={fld}>apy</span>
        <br />
        &nbsp;&nbsp;&nbsp;&nbsp;<span className={fld}>apyStandardized</span>
        <br />
        &nbsp;&nbsp;{'}'}
        <br />
        {'}'}
      </div>
      <div className="border-border/60 text-ink-faint flex gap-4 border-t px-[22px] py-3 font-mono text-[12px]">
        <b className="text-rose font-medium">200</b> response · 42ms{' '}
        <span>{'{ pools: [ 5 results ] }'}</span>
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
      <div className="px-[18px] pt-[22px] pb-2">
        <div className="text-foreground font-mono text-[34px] font-semibold tracking-[-0.02em]">
          $25,750
        </div>
        <div className="text-ink-faint mt-1 mb-[18px] text-[12.5px]">
          Total value ·{' '}
          <b className="text-rose font-mono font-medium">+12.4% (30d)</b>
        </div>
        {folio.map((f) => (
          <div
            key={f.name}
            className="border-border/60 flex items-center gap-[14px] border-t py-3"
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

export function Features() {
  return (
    <section
      className="border-border/60 border-b"
      id="features"
      data-screen-label="Features"
    >
      <div className="wrap py-[110px]">
        <Feature
          first
          id="standard"
          idx="01"
          eyebrow="Standard"
          title="One number you can trust."
          body="Our engine standardizes yield data across protocols, vaults and chains — adjusting for rate conventions and averaging windows so every market speaks the same language."
          points={[
            {
              b: 'Cross-protocol analytics',
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
          ]}
          visual={<StandardPanel />}
        />
        <Feature
          flip
          id="optimizer"
          idx="02"
          eyebrow="Optimizer"
          title="Strategies, not spreadsheets."
          body="Optimize lending and borrowing across protocols, vaults and chains using configurable risk preferences and market constraints."
          points={[
            {
              b: 'Smart strategy',
              s: 'Opportunities ranked by yield, risk and market conditions.',
            },
            {
              b: 'Risk-aware',
              s: 'Configure risk preferences and diversification levels.',
            },
            {
              b: 'Auto-rebalance',
              s: 'Automated on-chain rebalancing as markets evolve.',
            },
          ]}
          visual={<OptimizerPanel />}
        />
        <Feature
          id="api"
          idx="03"
          eyebrow="API"
          title="The data layer, exposed."
          body="Standardized lending yield, protocol and market data through a simple GraphQL API built for production integrations."
          points={[
            {
              b: 'GraphQL API',
              s: 'Flexible query interface for any stack.',
              href: '/docs/api/',
            },
            { b: '99.9% uptime SLA', s: 'Enterprise-grade reliability.' },
            { b: 'Webhooks', s: 'Real-time yield change notifications.' },
          ]}
          visual={<ApiPanel />}
        />
        <Feature
          flip
          last
          id="portfolio"
          idx="04"
          eyebrow="Portfolio"
          title="Your positions, one ledger."
          body="Connect your wallets and monitor lending positions, PnL and yield performance from a unified dashboard."
          points={[
            {
              b: 'Multi-wallet support',
              s: 'Connect unlimited addresses.',
              href: '/portfolio',
            },
            { b: 'Smart alerts', s: 'Stay informed on market movements.' },
            { b: 'Full history', s: 'Historical yields and transactions.' },
          ]}
          visual={<PortfolioPanel />}
        />
      </div>
    </section>
  )
}
