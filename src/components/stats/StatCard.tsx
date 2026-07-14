import { ArrowUpRight } from 'lucide-react'

import { StatCard as StatCardType } from '@/types'

export function StatCard({
  label,
  value,
  sub,
  note,
  noteAccent,
  accent,
  onClick,
}: StatCardType) {
  const body = (
    <>
      <p className="text-muted-foreground text-xs font-medium tracking-wider uppercase">
        {label}
      </p>
      <p
        className={`font-mono text-xl font-semibold ${accent ? 'text-primary' : 'text-foreground'}`}
      >
        {value}
      </p>
      {sub && <p className="text-muted-foreground text-xs">{sub}</p>}
      {note && (
        <p
          className={`text-xs font-medium ${noteAccent ? 'text-primary' : 'text-muted-foreground/70'}`}
        >
          {note}
        </p>
      )}
    </>
  )

  if (!onClick) {
    return (
      <div className="border-border flex flex-col gap-1 border-r px-6 py-4 last:border-r-0">
        {body}
      </div>
    )
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className="border-border hover:bg-secondary/40 group relative flex cursor-pointer flex-col gap-1 border-r px-6 py-4 text-left transition-colors last:border-r-0"
    >
      {body}
      <ArrowUpRight className="text-muted-foreground group-hover:text-primary absolute top-4 right-3 h-3.5 w-3.5 transition-colors" />
    </button>
  )
}
