'use client'

import { useState, type ReactNode } from 'react'

/**
 * DashboardZone — Collapsible panel group
 *
 * Phase 130: Wraps a logical group of dashboard panels
 * with a header that can collapse/expand the content.
 */

type Props = {
  id: string
  icon: string
  title: string
  description: string
  panelCount: number
  defaultOpen?: boolean
  children: ReactNode
}

export function DashboardZone({ id, icon, title, description, panelCount, defaultOpen = false, children }: Props) {
  const [open, setOpen] = useState(defaultOpen)

  return (
    <div id={id} className="rounded-xl border border-border/50 bg-card/50 overflow-hidden">
      {/* Clickable header */}
      <button
        onClick={() => setOpen(!open)}
        className="w-full px-5 py-3.5 flex items-center gap-3 hover:bg-surface-1/50 transition-colors cursor-pointer text-left"
      >
        <span className="text-xl">{icon}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-foreground">{title}</h3>
            <span className="px-1.5 py-0.5 rounded text-[9px] font-mono bg-surface-2/60 text-muted-foreground/60">
              {panelCount} panels
            </span>
          </div>
          <p className="text-xs text-muted-foreground/70 mt-0.5">{description}</p>
        </div>

        {/* Chevron */}
        <svg
          className={`w-4 h-4 text-muted-foreground/40 transition-transform duration-300 ${open ? 'rotate-180' : ''}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Collapsible content */}
      <div
        className={`transition-all duration-300 ease-in-out overflow-hidden ${
          open ? 'max-h-[10000px] opacity-100' : 'max-h-0 opacity-0'
        }`}
      >
        <div className="px-4 pb-4 space-y-4 border-t border-border/30">
          <div className="pt-4">
            {children}
          </div>
        </div>
      </div>
    </div>
  )
}
