import { Cube } from '@/components/landing/Cube'

export function PageHeader({
  label,
  title,
  updated,
}: {
  label: string
  title: string
  updated?: string
}) {
  return (
    <header className="mb-12">
      <p className="mono-label mb-[26px]">
        <Cube /> {label}
      </p>
      <h1 className="text-foreground m-0 text-4xl leading-[1.05] font-semibold tracking-[-0.03em] text-balance sm:text-5xl">
        {title}
      </h1>
      {updated && (
        <p className="text-ink-faint mt-4 font-mono text-[11.5px] tracking-[0.08em] uppercase">
          Last updated: {updated}
        </p>
      )}
    </header>
  )
}

export function Prose({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-muted-foreground [&_a]:text-foreground [&_a]:decoration-border [&_h2]:text-foreground [&_h3]:text-foreground [&_strong]:text-foreground text-[15px] leading-[1.7] [&_a]:underline! [&_a]:underline-offset-4 [&_a]:transition-colors [&_a:hover]:decoration-current [&_h2]:mt-10 [&_h2]:mb-3 [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:tracking-[-0.01em] [&_h3]:mt-6 [&_h3]:mb-2 [&_h3]:text-[16px] [&_h3]:font-semibold [&_li]:mt-1.5 [&_p]:mt-3 [&_ul]:mt-3 [&_ul]:list-disc [&_ul]:pl-5">
      {children}
    </div>
  )
}
