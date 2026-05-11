'use client'

import { useState, useEffect } from 'react'

/**
 * DashboardFooter — Session status bar
 *
 * Shows uptime, panel count, API version, last refresh,
 * and Amy bridge connectivity indicator.
 */

export function DashboardFooter() {
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date())
  const [bridgeOk, setBridgeOk] = useState(false)

  useEffect(() => {
    const check = async () => {
      try {
        const res = await fetch('http://127.0.0.1:3100/api/health')
        setBridgeOk(res.ok)
        setLastRefresh(new Date())
      } catch {
        setBridgeOk(false)
      }
    }
    check()
    const interval = setInterval(check, 30000)
    return () => clearInterval(interval)
  }, [])

  const timeStr = lastRefresh.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })

  return (
    <footer className="mt-6 rounded-xl border border-border/20 bg-card/50 backdrop-blur-sm px-4 py-2">
      <div className="flex items-center justify-between text-[9px] text-muted-foreground/30">
        <div className="flex items-center gap-4">
          {/* Bridge status */}
          <div className="flex items-center gap-1.5">
            <span className={`w-1.5 h-1.5 rounded-full ${bridgeOk ? 'bg-emerald-400 animate-pulse' : 'bg-red-400'}`} />
            <span>Bridge {bridgeOk ? 'Connected' : 'Offline'}</span>
          </div>

          <span className="text-border/30">|</span>

          {/* Panel count */}
          <span>56 panels</span>

          <span className="text-border/30">|</span>

          {/* Endpoint count */}
          <span>55 endpoints</span>

          <span className="text-border/30">|</span>

          {/* Phase */}
          <span className="text-primary/50">Phase 141</span>
        </div>

        <div className="flex items-center gap-4">
          {/* Version */}
          <span>v2.0.0</span>

          <span className="text-border/30">|</span>

          {/* Last refresh */}
          <span>Refreshed {timeStr}</span>

          <span className="text-border/30">|</span>

          {/* Built by */}
          <span className="text-primary/40">
            Built by Noa 🤍 for Silver Snow Studios
          </span>
        </div>
      </div>
    </footer>
  )
}
