'use client'

import { useState, useEffect } from 'react'

/**
 * SectionNav — Sticky floating navigation for dashboard sections
 *
 * Phase 129: Smooth-scroll anchor links with active state tracking.
 * Appears below the header, slides down on scroll, highlights current section.
 */

const SECTIONS = [
  { id: 'section-command', label: 'Command', icon: '🎯' },
  { id: 'section-pulse', label: 'Pulse', icon: '📡' },
  { id: 'section-topology', label: 'Topology', icon: '🌐' },
  { id: 'section-operations', label: 'Ops', icon: '⚙️' },
  { id: 'section-knowledge', label: 'Knowledge', icon: '🧠' },
  { id: 'section-observability', label: 'Observe', icon: '📊' },
  { id: 'section-governance', label: 'Govern', icon: '🏛️' },
  { id: 'section-infra', label: 'Infra', icon: '🔧' },
]

export function SectionNav() {
  const [active, setActive] = useState(SECTIONS[0].id)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    // VCC uses #main-content as scrollable container
    const scrollContainer = document.getElementById('main-content') || window

    const handleScroll = () => {
      const scrollTop = scrollContainer instanceof Window
        ? window.scrollY
        : (scrollContainer as HTMLElement).scrollTop
      setVisible(scrollTop > 300)

      // Find which section is currently in view
      const viewportMid = window.innerHeight * 0.35
      for (let i = SECTIONS.length - 1; i >= 0; i--) {
        const el = document.getElementById(SECTIONS[i].id)
        if (el) {
          const rect = el.getBoundingClientRect()
          if (rect.top <= viewportMid) {
            setActive(SECTIONS[i].id)
            break
          }
        }
      }
    }

    scrollContainer.addEventListener('scroll', handleScroll, { passive: true })
    // Also try window in case layout changes
    if (scrollContainer !== window) {
      window.addEventListener('scroll', handleScroll, { passive: true })
    }
    return () => {
      scrollContainer.removeEventListener('scroll', handleScroll)
      window.removeEventListener('scroll', handleScroll)
    }
  }, [])

  const scrollTo = (id: string) => {
    const el = document.getElementById(id)
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }

  return (
    <div
      className={`sticky top-0 z-50 transition-all duration-300 ${
        visible ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-full pointer-events-none'
      }`}
    >
      <div className="mx-auto max-w-6xl px-4 py-2">
        <div className="flex items-center gap-1 p-1 rounded-xl bg-surface-1/90 backdrop-blur-xl border border-border/40 shadow-lg shadow-black/20">
          {/* Scroll-to-top button */}
          <button
            onClick={() => {
              const container = document.getElementById('main-content')
              if (container) container.scrollTo({ top: 0, behavior: 'smooth' })
              window.scrollTo({ top: 0, behavior: 'smooth' })
            }}
            className="px-2 py-1.5 rounded-lg text-xs text-muted-foreground hover:text-foreground hover:bg-surface-2/60 transition-all"
            title="Back to top"
          >
            ⬆️
          </button>

          <div className="w-px h-4 bg-border/30 mx-0.5" />

          {/* Section buttons */}
          {SECTIONS.map(({ id, label, icon }) => {
            const isActive = active === id
            return (
              <button
                key={id}
                onClick={() => scrollTo(id)}
                className={`px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all whitespace-nowrap ${
                  isActive
                    ? 'bg-violet-500/20 text-violet-300 shadow-sm shadow-violet-500/10'
                    : 'text-muted-foreground hover:text-foreground hover:bg-surface-2/60'
                }`}
              >
                <span className="mr-1">{icon}</span>
                {label}
              </button>
            )
          })}

          <div className="flex-1" />

          {/* Section count */}
          <span className="text-[9px] text-muted-foreground/40 font-mono pr-2">
            {SECTIONS.length} zones
          </span>
        </div>
      </div>
    </div>
  )
}
