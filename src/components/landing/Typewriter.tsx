'use client'

import { useEffect, useState } from 'react'

import { useReducedMotion } from 'motion/react'

import { useRevealed } from '@/components/motion/reveal'
import { motionTokens } from '@/lib/motion'

/**
 * Types `text` one character at a time. Starts only once the surrounding
 * <Reveal> has entered the viewport — previously this ran on mount, so the
 * line was already fully typed by the time it scrolled into view.
 */
export function Typewriter({
  text,
  speed = motionTokens.typewriterSpeed,
}: {
  text: string
  speed?: number
}) {
  const revealed = useRevealed()
  const reduced = useReducedMotion() ?? false
  const [typed, setTyped] = useState('')

  useEffect(() => {
    if (!revealed) return

    if (reduced) {
      setTyped(text)
      return
    }

    let index = 0
    const interval = setInterval(() => {
      index += 1
      setTyped(text.slice(0, index))
      if (index >= text.length) clearInterval(interval)
    }, speed)

    return () => clearInterval(interval)
  }, [revealed, reduced, text, speed])

  return <>{typed}</>
}
