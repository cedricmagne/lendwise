const ticks = [
  { m: 'MORPHO · BASE', v: '7.37%', t: 'supply' },
  { m: 'AAVE V3 · ETH', v: '3.21%', t: 'net' },
  { m: 'COMPOUND · ETH', v: '6.12%', t: 'borrow' },
  { m: 'YEARN V3 · ETH', v: '~12.0%', t: 'est' },
  { m: 'SPARK · GNOSIS', v: '5.00%', t: 'base' },
  { m: 'PENDLE · ARB', v: '4.79%', t: 'PT fixed' },
  { m: 'VENUS · BSC', v: '5.41%', t: 'supply' },
  { m: 'LIDO · ETH', v: '3.05%', t: 'stETH' },
]

export function Ticker() {
  // rendered twice for a seamless -50% marquee loop
  const loop = [...ticks, ...ticks]
  return (
    <div
      className="bg-background border-border/60 group overflow-hidden border-b"
      aria-hidden="true"
    >
      <div className="animate-marquee flex w-max group-hover:[animation-play-state:paused] motion-reduce:animate-none">
        {loop.map((tk, i) => (
          <span
            className="border-border/60 text-muted-foreground inline-flex items-center gap-3 border-r px-7 py-[14px] font-mono text-[12.5px] whitespace-nowrap"
            key={`${tk.m}-${i}`}
          >
            {tk.m} <b className="text-foreground font-semibold">{tk.v}</b>{' '}
            <span className="text-rose">{tk.t}</span>
          </span>
        ))}
      </div>
    </div>
  )
}
