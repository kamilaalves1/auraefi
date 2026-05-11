'use client'

import { useState, useEffect, useCallback } from 'react'

/**
 * OpsHeartbeat — Real-Time Pulse Monitor
 *
 * Phase 123: Makes Amy feel ALIVE with a live heartbeat animation,
 * mood indicator, channel breakdown, and hourly activity sparkline.
 *
 * 🤖 PANEL TUNING GUIDE:
 * - Pulse animation speed: line ~60 (CSS animation-duration)
 * - Mood color mapping: line ~100
 * - Sparkline bar width: line ~200
 * - Refresh interval: line ~80 (default 10s)
 * - Channel icon mapping: line ~160
 */

type HeartbeatData = {
  pulse_rate: number
  mood: { state: string; icon: string; label: string; color: string }
  events_1h: number
  events_24h: number
  errors_24h: number
  channels: Record<string, number>
  hourly_distribution: number[]
  routines_run_today: number
  last_routine: { id: string; time: string } | null
  last_event: string | null
  uptime: string
  total_routines: number
  timestamp: string
}

const MOOD_COLORS: Record<string, { glow: string; ring: string; bg: string; text: string; pulse: string }> = {
  purple:  { glow: 'shadow-[0_0_30px_rgba(139,92,246,0.35)]', ring: 'border-violet-400', bg: 'bg-violet-400/10', text: 'text-violet-300', pulse: 'animate-pulse' },
  green:   { glow: 'shadow-[0_0_30px_rgba(52,211,153,0.35)]', ring: 'border-emerald-400', bg: 'bg-emerald-400/10', text: 'text-emerald-300', pulse: '' },
  blue:    { glow: 'shadow-[0_0_20px_rgba(96,165,250,0.25)]', ring: 'border-blue-400', bg: 'bg-blue-400/10', text: 'text-blue-300', pulse: '' },
  amber:   { glow: 'shadow-[0_0_20px_rgba(251,191,36,0.25)]', ring: 'border-amber-400', bg: 'bg-amber-400/10', text: 'text-amber-300', pulse: '' },
  red:     { glow: 'shadow-[0_0_30px_rgba(248,113,113,0.35)]', ring: 'border-red-400', bg: 'bg-red-400/10', text: 'text-red-300', pulse: 'animate-pulse' },
  dim:     { glow: '', ring: 'border-zinc-600', bg: 'bg-zinc-600/10', text: 'text-zinc-500', pulse: '' },
}

const CHANNEL_META: Record<string, { icon: string; label: string; color: string }> = {
  telegram:  { icon: '📱', label: 'Telegram', color: 'bg-blue-400' },
  email:     { icon: '📧', label: 'Email Lane', color: 'bg-emerald-400' },
  scheduler: { icon: '⏰', label: 'Scheduler', color: 'bg-violet-400' },
  council:   { icon: '🏛️', label: 'Council', color: 'bg-amber-400' },
  bridge:    { icon: '🌉', label: 'Bridge', color: 'bg-zinc-400' },
}

export function OpsHeartbeat() {
  const [data, setData] = useState<HeartbeatData | null>(null)
  const [loading, setLoading] = useState(true)
  const [beat, setBeat] = useState(false)

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch('http://127.0.0.1:3100/api/heartbeat')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = await res.json()
      setData(json)
      // Trigger heartbeat animation
      setBeat(true)
      setTimeout(() => setBeat(false), 600)
    } catch { /* silent */ }
    finally { setLoading(false) }
  }, [])

  useEffect(() => {
    fetchData()
    const interval = setInterval(fetchData, 10000) // Fast refresh — 10s
    return () => clearInterval(interval)
  }, [fetchData])

  if (loading) {
    return (
      <div className="bg-surface-1 rounded-xl border border-border/50 p-6">
        <div className="animate-pulse space-y-3">
          <div className="h-4 bg-surface-2 rounded w-1/4" />
          <div className="h-24 bg-surface-2 rounded" />
        </div>
      </div>
    )
  }

  if (!data) {
    return (
      <div className="bg-surface-1 rounded-xl border border-border/50 p-6">
        <p className="text-muted-foreground text-sm">Heartbeat unavailable — Bridge offline</p>
      </div>
    )
  }

  const moodStyle = MOOD_COLORS[data.mood.color] || MOOD_COLORS.dim
  const maxHourly = Math.max(...data.hourly_distribution, 1)
  const totalChannelEvents = Object.values(data.channels).reduce((a, b) => a + b, 0) || 1

  // Determine heartbeat animation speed based on pulse rate
  const pulseSpeed = data.pulse_rate > 5 ? '0.8s' : data.pulse_rate > 1 ? '1.5s' : '3s'

  // Format last event as relative time
  const formatRelative = (iso: string | null) => {
    if (!iso) return 'never'
    const diff = (Date.now() - new Date(iso).getTime()) / 1000
    if (diff < 60) return `${Math.floor(diff)}s ago`
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
    return `${Math.floor(diff / 86400)}d ago`
  }

  return (
    <div className={`bg-surface-1 rounded-xl border border-border/50 overflow-hidden transition-shadow duration-500 ${moodStyle.glow}`}>
      {/* Custom CSS */}
      <style>{`
        @keyframes ecg-pulse {
          0% { transform: scaleY(1); }
          10% { transform: scaleY(1.8); }
          20% { transform: scaleY(0.6); }
          30% { transform: scaleY(2.5); }
          40% { transform: scaleY(0.3); }
          50% { transform: scaleY(1.2); }
          60% { transform: scaleY(1); }
          100% { transform: scaleY(1); }
        }
        @keyframes heartbeat {
          0%, 100% { transform: scale(1); }
          15% { transform: scale(1.15); }
          30% { transform: scale(1); }
          45% { transform: scale(1.1); }
        }
        .ecg-bar { animation: ecg-pulse var(--pulse-speed, 1.5s) ease-in-out infinite; }
        .ecg-bar:nth-child(2) { animation-delay: 0.1s; }
        .ecg-bar:nth-child(3) { animation-delay: 0.2s; }
        .ecg-bar:nth-child(4) { animation-delay: 0.3s; }
        .ecg-bar:nth-child(5) { animation-delay: 0.4s; }
        .heartbeat-icon { animation: heartbeat var(--pulse-speed, 1.5s) ease-in-out infinite; }
      `}</style>

      {/* Header — Mood + pulse rate */}
      <div className="px-5 py-4 border-b border-border/30">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            {/* Living pulse indicator */}
            <div className="relative">
              <div
                className={`w-14 h-14 rounded-full flex items-center justify-center border-2 ${moodStyle.ring} ${moodStyle.bg} transition-all duration-300 ${beat ? 'scale-110' : 'scale-100'}`}
              >
                <span className="text-2xl heartbeat-icon" style={{ '--pulse-speed': pulseSpeed } as React.CSSProperties}>
                  {data.mood.icon}
                </span>
              </div>
              {/* Outer pulse ring */}
              <div className={`absolute inset-[-3px] rounded-full border ${moodStyle.ring} opacity-30 ${moodStyle.pulse}`} />
            </div>

            {/* Status text */}
            <div>
              <h3 className={`text-base font-semibold ${moodStyle.text}`}>{data.mood.label}</h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                {data.pulse_rate > 0
                  ? `${data.pulse_rate} events/min · Last event ${formatRelative(data.last_event)}`
                  : `No recent activity · Bridge up ${data.uptime}`
                }
              </p>
            </div>
          </div>

          {/* ECG-style pulse bars */}
          <div className="flex items-end gap-[3px] h-8">
            {[1, 2, 3, 4, 5].map((i) => (
              <div
                key={i}
                className={`w-[3px] rounded-full ecg-bar ${moodStyle.ring.replace('border-', 'bg-')}`}
                style={{
                  height: `${8 + Math.random() * 20}px`,
                  '--pulse-speed': pulseSpeed,
                  opacity: data.pulse_rate > 0 ? 0.8 : 0.2,
                } as React.CSSProperties}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-5 divide-x divide-border/20">
        {[
          { label: 'Events (1h)', value: data.events_1h.toLocaleString(), icon: '⚡' },
          { label: 'Events (24h)', value: data.events_24h.toLocaleString(), icon: '📊' },
          { label: 'Errors', value: data.errors_24h.toLocaleString(), icon: data.errors_24h > 10 ? '🔴' : '🟢' },
          { label: 'Routines', value: `${data.routines_run_today}/${data.total_routines}`, icon: '⏰' },
          { label: 'Uptime', value: data.uptime, icon: '⬆️' },
        ].map(({ label, value, icon }) => (
          <div key={label} className="px-4 py-3 text-center">
            <div className="text-xs text-muted-foreground">{icon} {label}</div>
            <div className="text-sm font-semibold text-foreground mt-0.5 font-mono">{value}</div>
          </div>
        ))}
      </div>

      {/* Bottom section — Channel breakdown + sparkline */}
      <div className="border-t border-border/20 px-5 py-4 grid grid-cols-2 gap-6">
        {/* Channel breakdown */}
        <div>
          <span className="text-2xs text-muted-foreground uppercase tracking-wider">Channel Activity</span>
          <div className="mt-2 space-y-2">
            {Object.entries(CHANNEL_META).map(([key, meta]) => {
              const count = data.channels[key] || 0
              const pct = (count / totalChannelEvents) * 100
              return (
                <div key={key} className="flex items-center gap-2">
                  <span className="text-xs w-4 text-center">{meta.icon}</span>
                  <span className="text-2xs text-muted-foreground w-16 truncate">{meta.label}</span>
                  <div className="flex-1 h-1.5 bg-surface-2/60 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full ${meta.color} transition-all duration-700`}
                      style={{ width: `${Math.max(pct, count > 0 ? 2 : 0)}%` }}
                    />
                  </div>
                  <span className="text-2xs font-mono text-muted-foreground w-10 text-right">{count}</span>
                </div>
              )
            })}
          </div>
        </div>

        {/* Hourly sparkline */}
        <div>
          <span className="text-2xs text-muted-foreground uppercase tracking-wider">24h Activity Map</span>
          <div className="mt-2 flex items-end gap-[3px] h-14">
            {data.hourly_distribution.map((count, hour) => {
              const height = (count / maxHourly) * 100
              const isCurrentHour = new Date().getHours() === hour
              const isPeak = count === Math.max(...data.hourly_distribution) && count > 0
              return (
                <div
                  key={hour}
                  className="group relative flex-1"
                  style={{ height: '100%' }}
                >
                  <div
                    className={`absolute bottom-0 w-full rounded-t transition-all duration-500 ${
                      isCurrentHour
                        ? 'bg-violet-400 shadow-[0_0_8px_rgba(139,92,246,0.5)]'
                        : isPeak
                        ? 'bg-violet-400/80'
                        : count > 0
                        ? 'bg-violet-400/30'
                        : 'bg-surface-2/40'
                    }`}
                    style={{ height: `${Math.max(height, count > 0 ? 4 : 2)}%` }}
                  />
                  {/* Tooltip on hover */}
                  <div className="opacity-0 group-hover:opacity-100 absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-1.5 py-0.5 rounded bg-surface-2 border border-border/30 text-[8px] font-mono text-foreground whitespace-nowrap pointer-events-none z-10 transition-opacity">
                    {hour}:00 — {count}
                  </div>
                </div>
              )
            })}
          </div>
          {/* Hour labels */}
          <div className="flex justify-between mt-1">
            <span className="text-[8px] font-mono text-muted-foreground/40">0h</span>
            <span className="text-[8px] font-mono text-muted-foreground/40">6h</span>
            <span className="text-[8px] font-mono text-muted-foreground/40">12h</span>
            <span className="text-[8px] font-mono text-muted-foreground/40">18h</span>
            <span className="text-[8px] font-mono text-muted-foreground/40">23h</span>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="px-5 py-2 border-t border-border/20 flex items-center justify-between">
        <span className="text-2xs text-muted-foreground">
          📡 Live pulse · refreshes every 10s
          {data.last_routine && (
            <span className="ml-2 text-muted-foreground/60">
              · Last routine: <span className="font-mono">{data.last_routine.id}</span>
            </span>
          )}
        </span>
        <button
          onClick={fetchData}
          className="text-2xs text-muted-foreground hover:text-foreground transition-colors"
        >
          ↻ Refresh
        </button>
      </div>
    </div>
  )
}
