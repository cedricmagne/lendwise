import Link from 'next/link'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

import { Cube } from './Cube'
import { CubeField } from './CubeField'

const stats = [
  { value: '8', label: 'Blockchains' },
  { value: '700+', label: 'Lending markets' },
  { value: '<1s', label: 'Latency' },
  { value: '60s', label: 'Data refresh' },
]

const lineSoft = 'oklch(from var(--border) l c h / 0.6)'

export function HeroSection() {
  return (
    <header
      className="border-border/60 relative flex min-h-screen flex-col overflow-hidden border-b"
      data-screen-label="Hero"
    >
      <div className="relative flex flex-1 items-center overflow-hidden pt-[112px] pb-12">
        <div
          className="pointer-events-none absolute inset-0 opacity-35"
          style={{
            backgroundImage: `linear-gradient(${lineSoft} 1px, transparent 1px), linear-gradient(90deg, ${lineSoft} 1px, transparent 1px)`,
            backgroundSize: '72px 72px',
            maskImage:
              'radial-gradient(ellipse 90% 80% at 30% 40%, black 0%, transparent 70%)',
            WebkitMaskImage:
              'radial-gradient(ellipse 90% 80% at 30% 40%, black 0%, transparent 70%)',
          }}
        />
        <CubeField />
        <div className="wrap w-full">
          <div className="desk:pl-[88px] relative z-2 max-w-[720px]">
            <p className="mono-label mb-[26px]">
              <Cube /> DEFI LENDING AGGREGATOR
            </p>
            <h1 className="text-foreground m-0 mb-6 flex flex-col text-5xl leading-[0.98] font-semibold tracking-[-0.045em] text-balance sm:text-6xl lg:text-7xl">
              Unified view for cross-chain{' '}
              <span className="text-brand-bright">lending markets.</span>
            </h1>
            <p className="text-muted-foreground mb-9 max-w-[44ch] text-[17px] leading-[1.6] text-pretty">
              Track, compare and analyze lending markets across protocols and
              chains. Transform fragmented APY data into actionable market
              insights and smarter decisions.
            </p>
            <div className="flex items-center gap-3 max-[560px]:flex-col max-[560px]:items-stretch">
              <Button
                asChild
                className="hover:bg-brand-bright active:bg-brand-deep bg-primary text-primary-foreground h-11 rounded px-[22px] text-sm font-medium"
              >
                <Link href="/supply">Explore yields</Link>
              </Button>
              <Button
                asChild
                variant="outline"
                className="border-border text-foreground hover:border-muted-foreground hover:text-foreground h-11 rounded bg-transparent px-[22px] text-sm font-medium hover:bg-transparent"
              >
                <Link href="/docs">Read the docs</Link>
              </Button>
            </div>
          </div>
        </div>
      </div>
      <div className="bg-background border-border/60 relative z-2 border-t">
        <div className="desk:grid-cols-4 wrap grid grid-cols-2">
          {stats.map((s, i) => (
            <div
              className={cn(
                'desk:border-t-0 py-[22px]',
                i % 2 === 0 ? 'pl-0' : 'border-border/60 border-l pl-6',
                i >= 2 && 'border-border/60 border-t',
                i === 0
                  ? 'desk:pl-0'
                  : 'desk:border-border/60 desk:border-l desk:pl-6'
              )}
              key={s.label}
            >
              <b className="text-foreground block font-mono text-[26px] font-semibold tracking-[-0.02em]">
                {s.value}
              </b>
              <span className="text-ink-faint text-[12.5px]">{s.label}</span>
            </div>
          ))}
        </div>
      </div>
    </header>
  )
}
