'use client'

import { useEffect } from 'react'

import {
  animate,
  motion,
  useMotionValue,
  useReducedMotion,
  useTransform,
} from 'motion/react'

import { useRevealed } from '@/components/motion/reveal'
import { motionTokens } from '@/lib/motion'

/**
 * Counts from 0 to `value` when its <RevealGroup> enters the viewport, so the
 * number climbs in step with the row's fade instead of on its own observer.
 * Renders the final value immediately for reduced-motion users.
 */
export function CountUp({
  value,
  suffix = '',
  duration = motionTokens.countUp,
}: {
  value: number
  suffix?: string
  /** Seconds. */
  duration?: number
}) {
  const revealed = useRevealed()
  const reduced = useReducedMotion() ?? false
  const count = useMotionValue(0)
  const text = useTransform(count, (v) => `${Math.round(v)}${suffix}`)

  useEffect(() => {
    if (!revealed) return

    if (reduced) {
      count.set(value)
      return
    }

    const controls = animate(count, value, {
      duration,
      ease: motionTokens.ease,
    })

    return () => controls.stop()
  }, [count, duration, reduced, revealed, value])

  return <motion.span>{text}</motion.span>
}
