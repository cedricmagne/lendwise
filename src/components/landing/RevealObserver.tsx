'use client'

import { useEffect } from 'react'

/**
 * Adds the `.in` class to every `.reveal` element as it enters the viewport
 * (see globals.css). Renders nothing — a client leaf so the landing page
 * itself can stay a server component.
 */
export function RevealObserver() {
  useEffect(() => {
    const els = Array.from(document.querySelectorAll<HTMLElement>('.reveal'))
    if (!els.length) return
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            e.target.classList.add('in')
            io.unobserve(e.target)
          }
        }
      },
      { threshold: 0.05, rootMargin: '0px 0px -4% 0px' }
    )
    els.forEach((el) => io.observe(el))
    return () => io.disconnect()
  }, [])

  return null
}
