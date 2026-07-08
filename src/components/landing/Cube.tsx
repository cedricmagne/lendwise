import type { CSSProperties } from 'react'

import { cn } from '@/lib/utils'

type Faces = { top: string; left: string; right: string }

const DIM_FACES: Faces = {
  top: 'oklch(from var(--ink-faint) l c h)',
  left: 'oklch(from var(--primary) calc(l - 0.05) calc(c * 0.5) h)',
  right: 'oklch(from var(--brand-deep) calc(l - 0.02) calc(c * 0.5) h)',
}

const DEFAULT_FACES: Faces = {
  top: 'var(--cube-top)',
  left: 'var(--primary)',
  right: 'var(--brand-deep)',
}

/** Isometric 3-face brand cube glyph. `dim` renders the muted variant. */
export function Cube({
  dim = false,
  width = 14,
  height = 16,
  faces,
  className,
  style,
}: {
  dim?: boolean
  width?: number | string
  height?: number | string
  faces?: Faces
  className?: string
  style?: CSSProperties
}) {
  const f = faces ?? (dim ? DIM_FACES : DEFAULT_FACES)
  return (
    <span
      className={cn('relative inline-block flex-none', className)}
      style={{ width, height, ...style }}
    >
      <span
        className="absolute top-0 left-0 block h-1/2 w-full"
        style={{
          background: f.top,
          clipPath: 'polygon(50% 0, 100% 50%, 50% 100%, 0 50%)',
        }}
      />
      <span
        className="absolute left-0 block h-3/4 w-1/2"
        style={{
          top: '25%',
          background: f.left,
          clipPath: 'polygon(0 0, 100% 33.3%, 100% 100%, 0 66.6%)',
        }}
      />
      <span
        className="absolute right-0 block h-3/4 w-1/2"
        style={{
          top: '25%',
          background: f.right,
          clipPath: 'polygon(0 33.3%, 100% 0, 100% 66.6%, 0 100%)',
        }}
      />
    </span>
  )
}
