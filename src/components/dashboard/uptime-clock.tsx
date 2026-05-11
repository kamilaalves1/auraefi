'use client'

import { useState, useEffect } from 'react'

/**
 * UptimeClock — Live ticking uptime counter
 *
 * Phase 135: Shows bridge uptime as a live ticking clock
 * + system age since first log file was created.
 */

export function UptimeClock() {
  const [startTime, setStartTime] = useState<string | null>(null)
  const [systemAge, setSystemAge] = useState<string | null>(null)
  const [elapsed, setElapsed] = useState(0)

  useEffect(() => {
    const fetchUptime = async () => {
      try {
        const res = await fetch('http://127.0.0.1:3100/api/uptime')
        const data = await res.json()
        setStartTime(data.bridge_started)
        setSystemAge(data.systemUptime || null)
        setElapsed(data.uptime_seconds || 0)
      } catch {
        // silent
      }
    }
    fetchUptime()
  }, [])

  // Tick every second
  useEffect(() => {
    const timer = setInterval(() => setElapsed(e => e + 1), 1000)
    return () => clearInterval(timer)
  }, [])

  const days = Math.floor(elapsed / 86400)
  const hours = Math.floor((elapsed % 86400) / 3600)
  const minutes = Math.floor((elapsed % 3600) / 60)
  const seconds = elapsed % 60

  const pad = (n: number) => String(n).padStart(2, '0')

  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse shadow-sm shadow-emerald-500/50" />
          <span className="text-xs text-muted-foreground/60">Bridge Uptime</span>
        </div>
        <div className="font-mono text-lg font-bold text-foreground tracking-wider">
          {days > 0 && <span className="text-emerald-400">{days}<span className="text-xs text-muted-foreground/40">d </span></span>}
          <span className="text-emerald-400">{pad(hours)}</span>
          <span className="text-muted-foreground/30 animate-pulse">:</span>
          <span className="text-emerald-400">{pad(minutes)}</span>
          <span className="text-muted-foreground/30 animate-pulse">:</span>
          <span className="text-emerald-400">{pad(seconds)}</span>
        </div>
      </div>
      <div className="text-right">
        {systemAge && (
          <div className="text-[10px] text-muted-foreground/40 font-mono">
            System age: {systemAge}
          </div>
        )}
        {startTime && (
          <div className="text-[10px] text-muted-foreground/30 font-mono">
            Started: {new Date(startTime).toLocaleTimeString()}
          </div>
        )}
      </div>
    </div>
  )
}
