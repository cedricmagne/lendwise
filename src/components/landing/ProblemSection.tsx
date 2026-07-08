import { cn } from '@/lib/utils'

import { Cube } from './Cube'

const chips = [
  { v: '7.37%', name: 'Morpho', sub: 'supply APY' },
  { v: '3.21%', name: 'Aave v3', sub: 'net yield' },
  { v: '6.12%', name: 'Compound', sub: 'borrow rate' },
  { v: '~12%', name: 'Yearn', sub: 'estimated' },
  { v: '5.00%', name: 'Spark', sub: 'APR base' },
  { v: '4.79%', name: 'Pendle', sub: 'PT fixed' },
]

const cols = [
  {
    h: 'Scattered data',
    p: 'Opportunities live across dozens of protocols and chains. There is no unified view of the market.',
  },
  {
    h: 'Inconsistent APYs',
    p: 'Supply APY, net yield, APR base, PT fixed — the same word, six different calculations.',
  },
  {
    h: 'Manual analysis',
    p: 'Hours lost switching dashboards and normalizing numbers by hand before every decision.',
  },
]

export function ProblemSection() {
  return (
    <section
      className="border-border/60 border-b"
      id="problem"
      data-screen-label="Problem"
    >
      <div className="wrap py-[110px]">
        <div className="reveal mb-14 max-w-[640px]">
          <p className="mono-label">
            <span className="text-brand-bright">/ 00</span> The problem
          </p>
          <h2 className="text-foreground mt-[18px] mb-[14px] text-[clamp(32px,4vw,48px)] leading-[1.05] font-semibold tracking-[-0.035em] text-balance">
            Lending markets are fragmented by design.
          </h2>
          <p className="text-muted-foreground m-0 max-w-[54ch] text-base leading-[1.6] text-pretty">
            Every protocol reports rates its own way — different conventions,
            time windows and assumptions. Raw APYs are not comparable.
          </p>
        </div>
        <div className="reveal mb-10 flex max-w-[760px] flex-wrap gap-2.5">
          {chips.map((c) => (
            <span
              className="border-border bg-card text-muted-foreground inline-flex flex-none items-baseline gap-2.5 rounded border px-4 py-3 font-mono text-[13px] whitespace-nowrap"
              key={c.name}
            >
              <b className="text-foreground text-[15px] font-semibold">{c.v}</b>{' '}
              {c.name}{' '}
              <span className="text-ink-faint text-[10.5px] tracking-[0.08em] whitespace-nowrap uppercase">
                {c.sub}
              </span>
            </span>
          ))}
        </div>
        <p className="reveal text-foreground mb-16 font-mono text-[clamp(20px,2.6vw,30px)]">
          &gt; which one is actually better?
          <span className="bg-brand-bright animate-blink inline-block h-[1.1em] w-[0.6em] align-text-bottom" />
        </p>
        <div className="reveal border-border/60 grid grid-cols-3 border-t max-[960px]:grid-cols-1">
          {cols.map((c, i) => (
            <div
              className={cn(
                'pt-7 pr-7 pb-1',
                i === 0 ? 'pl-0' : 'border-border/60 border-l pl-7',
                'max-[960px]:border-l-0 max-[960px]:pl-0',
                i !== 0 && 'max-[960px]:border-border/60 max-[960px]:border-t'
              )}
              key={c.h}
            >
              <Cube dim />
              <h3 className="text-foreground mt-[14px] mb-2 text-base font-semibold tracking-[-0.02em]">
                {c.h}
              </h3>
              <p className="text-muted-foreground m-0 text-[14px] leading-[1.6]">
                {c.p}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
