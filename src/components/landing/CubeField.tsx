'use client'

import { useEffect, useRef } from 'react'

import { useTheme } from 'next-themes'

type Palette = { top: string; left: string; right: string }

type Theme = {
  palettes: Palette[]
  gridLine: string
  gridFill: string
  seam: string
  alpha: number
}

// Cube face palettes — light-gray tops (the brand mark) over the maroon chart
// ramp on the sides for on-brand variety.
const DARK: Theme = {
  palettes: [
    { top: '#d9d9d9', left: '#762b2b', right: '#521e1e' }, // chart-1 brand
    { top: '#d9d9d9', left: '#a13a3a', right: '#762b2b' }, // chart-3 bright
    { top: '#c6c6c6', left: '#521e1e', right: '#391515' }, // chart-2 deep
    { top: '#d9d9d9', left: '#8a3030', right: '#5f2222' }, // chart-4 mid
    { top: '#e2e2e2', left: '#b8484a', right: '#8f3232' }, // chart-5 light
  ],
  gridLine: 'rgba(217,217,217,0.10)',
  gridFill: 'rgba(217,217,217,0.022)',
  seam: 'rgba(20,20,20,0.45)',
  alpha: 1,
}

// Light theme — muted rose tops with lighter maroon sides so the field reads
// gently against the near-white ledger background.
const LIGHT: Theme = {
  palettes: [
    { top: '#c88f8b', left: '#8a3535', right: '#5f2323' },
    { top: '#d3a4a0', left: '#a13a3a', right: '#762b2b' },
    { top: '#bf8480', left: '#6f2a2a', right: '#4d1c1c' },
    { top: '#cd9a96', left: '#933636', right: '#682626' },
    { top: '#dbaca8', left: '#b8484a', right: '#8f3232' },
  ],
  gridLine: 'rgba(30,30,30,0.06)',
  gridFill: 'rgba(30,30,30,0.014)',
  seam: 'rgba(120,110,110,0.22)',
  alpha: 0.75,
}

type Cube = {
  i: number
  j: number
  pal: Palette
  hMax: number
  born: number
  appear: number
  hold: number
  vanish: number
}

const easeOutBack = (t: number) => {
  const c = 1.70158
  return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2)
}
const easeInCubic = (t: number) => t * t * t

/**
 * Isometric cube field — a single-layer diamond-tile floor with cubes in the
 * brand's maroon ramp that pop up on random cells, hold, then fade back into
 * the grid. Ambient hero background; respects reduced-motion and active theme.
 */
export function CubeField() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const { resolvedTheme } = useTheme()
  const isDark = resolvedTheme === 'dark'

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const theme = isDark ? DARK : LIGHT
    const reduced = window.matchMedia(
      '(prefers-reduced-motion: reduce)'
    ).matches

    const cols = 24
    const shift = 0.16

    let W = 0
    let H = 0
    let iN = 0
    let jN = 0
    let s = 0
    let hw = 0
    let hh = 0
    let ox = 0
    let oy = 0
    let maxDepth = 0
    let cubes: Cube[] = []
    let free: { i: number; j: number }[] = []
    let spawnAt = 0
    let last = 0
    let raf = 0

    const occupied = (i: number, j: number) => {
      for (const c of cubes) if (c.i === i && c.j === j) return true
      return false
    }

    const spawn = (bornOffset?: number) => {
      if (!free.length) return
      for (let tries = 0; tries < 8; tries++) {
        const cell = free[(Math.random() * free.length) | 0]
        if (occupied(cell.i, cell.j)) continue
        const born =
          typeof bornOffset === 'number' ? last - bornOffset : last
        cubes.push({
          i: cell.i,
          j: cell.j,
          pal: theme.palettes[(Math.random() * theme.palettes.length) | 0],
          hMax: 0.42 + Math.random() * 0.28,
          born,
          appear: 520 + Math.random() * 260,
          hold: 1800 + Math.random() * 4200,
          vanish: 560 + Math.random() * 340,
        })
        return
      }
    }

    const build = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      W = canvas.clientWidth
      H = canvas.clientHeight
      canvas.width = W * dpr
      canvas.height = H * dpr
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

      s = Math.max(11, Math.min(20, W / 60))
      hw = s * 0.866
      hh = s * 0.5

      iN = cols // depth, receding up-right
      jN = Math.max(6, Math.round(cols * 0.9)) // width, receding up-left
      maxDepth = iN - 1 + (jN - 1)

      // push the plane off the right edge so it's cropped on the right
      ox = W - (iN - 1) * hw + W * shift
      // center the whole plane vertically in the animation area
      oy = H / 2 - (maxDepth * hh * 0.98) / 2 + hh

      free = []
      for (let i = 0; i < iN; i++)
        for (let j = 0; j < jN; j++) free.push({ i, j })

      cubes = []
      const seed = Math.round(free.length * (reduced ? 0.16 : 0.09))
      for (let n = 0; n < seed; n++) spawn(reduced ? -1 : (n / seed) * 1800)
      spawnAt = 0
    }

    const tilePos = (i: number, j: number) => ({
      x: ox + (i - j) * hw,
      y: oy - (i + j - maxDepth) * hh * 0.98,
    })

    const drawTile = (x: number, y: number) => {
      ctx.beginPath()
      ctx.moveTo(x, y - hh)
      ctx.lineTo(x + hw, y)
      ctx.lineTo(x, y + hh)
      ctx.lineTo(x - hw, y)
      ctx.closePath()
      ctx.fillStyle = theme.gridFill
      ctx.fill()
      ctx.strokeStyle = theme.gridLine
      ctx.lineWidth = 1
      ctx.stroke()
    }

    const drawCube = (
      x: number,
      y: number,
      h: number,
      pal: Palette,
      alpha: number
    ) => {
      ctx.globalAlpha = alpha
      // top face
      ctx.fillStyle = pal.top
      ctx.beginPath()
      ctx.moveTo(x, y - hh - h)
      ctx.lineTo(x + hw, y - h)
      ctx.lineTo(x, y + hh - h)
      ctx.lineTo(x - hw, y - h)
      ctx.closePath()
      ctx.fill()
      // left face
      ctx.fillStyle = pal.left
      ctx.beginPath()
      ctx.moveTo(x - hw, y - h)
      ctx.lineTo(x, y + hh - h)
      ctx.lineTo(x, y + hh)
      ctx.lineTo(x - hw, y)
      ctx.closePath()
      ctx.fill()
      // right face
      ctx.fillStyle = pal.right
      ctx.beginPath()
      ctx.moveTo(x + hw, y - h)
      ctx.lineTo(x, y + hh - h)
      ctx.lineTo(x, y + hh)
      ctx.lineTo(x + hw, y)
      ctx.closePath()
      ctx.fill()
      // hairline seams
      ctx.strokeStyle = theme.seam
      ctx.lineWidth = 0.75
      ctx.beginPath()
      ctx.moveTo(x - hw, y - h)
      ctx.lineTo(x, y + hh - h)
      ctx.lineTo(x + hw, y - h)
      ctx.moveTo(x, y + hh - h)
      ctx.lineTo(x, y + hh)
      ctx.stroke()
      ctx.globalAlpha = 1
    }

    const render = (now: number) => {
      ctx.clearRect(0, 0, W, H)

      // 1) single-layer grid floor, back-to-front
      const tiles: { i: number; j: number }[] = []
      for (let i = 0; i < iN; i++)
        for (let j = 0; j < jN; j++) tiles.push({ i, j })
      tiles.sort((a, b) => a.i + a.j - (b.i + b.j))
      for (const t of tiles) {
        const p = tilePos(t.i, t.j)
        const depthFade = 1 - ((t.i + t.j) / maxDepth) * 0.65
        ctx.globalAlpha = Math.max(0.12, depthFade) * theme.alpha
        drawTile(p.x, p.y)
        ctx.globalAlpha = 1
      }

      // 2) cubes on top, farthest-first (painter's algorithm)
      cubes.sort((a, b) => b.i + b.j - (a.i + a.j))
      for (const c of cubes) {
        const age = now - c.born
        let grow = 1
        let alpha = 1
        if (age < c.appear) {
          const p = Math.min(1, age / c.appear)
          grow = Math.max(0, easeOutBack(p))
          alpha = Math.min(1, p * 1.6)
        } else if (age >= c.appear + c.hold) {
          const p = Math.min(1, (age - c.appear - c.hold) / c.vanish)
          grow = 1 - easeInCubic(p) * 0.6
          alpha = 1 - p
        }
        const pos = tilePos(c.i, c.j)
        drawCube(pos.x, pos.y, c.hMax * s * grow, c.pal, Math.max(0, alpha) * theme.alpha)
      }
    }

    const loop = (t: number) => {
      const dt = Math.min(t - last, 60)
      last = t

      cubes = cubes.filter(
        (c) => t - c.born < c.appear + c.hold + c.vanish
      )

      const target = Math.round(free.length * 0.1)
      spawnAt -= dt
      if (cubes.length < target && spawnAt <= 0) {
        spawn()
        spawnAt = 140 + Math.random() * 320
      }

      render(t)
      if (!reduced) raf = requestAnimationFrame(loop)
    }

    const onResize = () => {
      build()
      if (reduced) {
        last = performance.now()
        render(last)
      }
    }

    build()
    if (reduced) {
      last = performance.now()
      // freeze all seeded cubes into hold state
      for (const c of cubes) c.born = last - c.appear - 200
      render(last)
    } else {
      raf = requestAnimationFrame((t) => {
        last = t
        loop(t)
      })
    }
    window.addEventListener('resize', onResize)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', onResize)
    }
  }, [isDark])

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="absolute inset-0 block h-full w-full"
    />
  )
}
