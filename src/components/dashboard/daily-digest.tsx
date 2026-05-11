'use client'

import { useState, useEffect, useCallback } from 'react'

/**
 * DailyDigest — Amy's Day at a Glance
 *
 * Phase 126: Executive briefing card — narrative summary,
 * highlights list, channel breakdown bars, and health badge.
 */

type DigestData = {
  date: string
  narrative: string
  highlights: string[]
  total_events: number
  channels: Record<string, number>
  busiest_channel: string
  errors_today: number
  routines: { ran: number; total: number; last: { id: string; time: string } | null }
  drafts_today: number
  health: string
  uptime: string
  timestamp: string
}

const HEALTH_STYLES: Record<string, { bg: string; text: string; border: string; icon: string; label: string }> = {
  excellent: { bg: 'bg-emerald-400/10', text: 'text-emerald-400', border: 'border-emerald-400/20', icon: '💚', label: 'Excellent' },
  good:      { bg: 'bg-blue-400/10', text: 'text-blue-400', border: 'border-blue-400/20', icon: '💙', label: 'Good' },
  attention: { bg: 'bg-amber-400/10', text: 'text-amber-400', border: 'border-amber-400/20', icon: '💛', label: 'Needs Attention' },
}

const CHANNEL_COLORS: Record<string, string> = {
  'Email Lane': 'bg-emerald-400',
  'Telegram/Proxy': 'bg-blue-400',
  'Bridge API': 'bg-violet-400',
  'Council': 'bg-amber-400',
  'Scheduler': 'bg-pink-400',
}

export function DailyDigest() {
  const [data, setData] = useState<DigestData | null>(null)
  const [loading, setLoading] = useState(true)

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch('http://127.0.0.1:3100/api/daily-digest')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setData(await res.json())
    } catch { /* silent */ }
    finally { setLoading(false) }
  }, [])

  useEffect(() => {
    fetchData()
    const interval = setInterval(fetchData, 60000) // 1min refresh
    return () => clearInterval(interval)
  }, [fetchData])

  if (loading) return (
    <div className="bg-surface-1 rounded-xl border border-border/50 p-6">
      <div className="animate-pulse space-y-3">
        <div className="h-4 bg-surface-2 rounded w-1/3" />
        <div className="h-16 bg-surface-2 rounded" />
      </div>
    </div>
  )

  if (!data) return (
    <div className="bg-surface-1 rounded-xl border border-border/50 p-6">
      <p className="text-muted-foreground text-sm">Daily digest unavailable</p>
    </div>
  )

  const healthStyle = HEALTH_STYLES[data.health] || HEALTH_STYLES.good
  const maxChannel = Math.max(...Object.values(data.channels), 1)

  // Format date nicely
  const dateStr = (() => {
    try {
      const d = new Date(data.date + 'T12:00:00')
      return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
    } catch { return data.date }
  })()

  return (
    <div className="bg-surface-1 rounded-xl border border-border/50 overflow-hidden">
      {/* Header — date + health badge */}
      <div className="px-5 py-4 border-b border-border/30">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-lg">📝</span>
            <div>
              <h3 className="text-sm font-semibold text-foreground">Daily Digest</h3>
              <p className="text-xs text-muted-foreground">{dateStr}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {/* Health badge */}
            <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-2xs font-semibold ${healthStyle.bg} ${healthStyle.text} ${healthStyle.border} border`}>
              {healthStyle.icon} {healthStyle.label}
            </span>
            {/* Events count */}
            <span className="px-2 py-0.5 rounded-full text-2xs font-mono bg-violet-400/10 text-violet-300 border border-violet-400/20">
              {data.total_events > 999 ? `${(data.total_events / 1000).toFixed(1)}K` : data.total_events} events
            </span>
          </div>
        </div>
      </div>

      {/* Narrative quote */}
      <div className="px-5 py-4 border-b border-border/20">
        <div className="relative pl-4">
          <div className="absolute left-0 top-0 bottom-0 w-[3px] rounded-full bg-violet-400/40" />
          <p className="text-sm text-foreground/90 italic leading-relaxed">
            &ldquo;{data.narrative}&rdquo;
          </p>
        </div>
      </div>

      {/* Bottom — Highlights + Channel bars */}
      <div className="grid grid-cols-2 divide-x divide-border/20">
        {/* Highlights */}
        <div className="px-5 py-3">
          <span className="text-2xs text-muted-foreground uppercase tracking-wider">Highlights</span>
          <div className="mt-2 space-y-1.5">
            {data.highlights.map((h, i) => (
              <div key={i} className="text-xs text-foreground/80 flex items-start gap-2">
                <span className="flex-shrink-0 mt-0.5">{h.slice(0, 2)}</span>
                <span>{h.slice(2).trim()}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Channel breakdown */}
        <div className="px-5 py-3">
          <span className="text-2xs text-muted-foreground uppercase tracking-wider">Channel Breakdown</span>
          <div className="mt-2 space-y-1.5">
            {Object.entries(data.channels)
              .sort(([, a], [, b]) => b - a)
              .map(([name, count]) => {
                const pct = (count / maxChannel) * 100
                const color = CHANNEL_COLORS[name] || 'bg-zinc-400'
                const isBusiest = name === data.busiest_channel
                return (
                  <div key={name} className="flex items-center gap-2">
                    <span className="text-2xs text-muted-foreground w-24 truncate">
                      {isBusiest && '👑 '}{name}
                    </span>
                    <div className="flex-1 h-1.5 bg-surface-2/60 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all duration-700 ${color} ${isBusiest ? 'shadow-sm' : ''}`}
                        style={{ width: `${Math.max(pct, count > 0 ? 2 : 0)}%` }}
                      />
                    </div>
                    <span className="text-2xs font-mono text-muted-foreground w-12 text-right">
                      {count > 999 ? `${(count / 1000).toFixed(1)}K` : count}
                    </span>
                  </div>
                )
              })}
          </div>
        </div>
      </div>

      {/* Stats strip */}
      <div className="grid grid-cols-4 divide-x divide-border/20 border-t border-border/20">
        {[
          { icon: '⏰', label: 'Routines', value: `${data.routines.ran}/${data.routines.total}` },
          { icon: '✍️', label: 'Drafts', value: String(data.drafts_today) },
          { icon: data.errors_today === 0 ? '✅' : '⚠️', label: 'Errors', value: data.errors_today > 999 ? `${(data.errors_today / 1000).toFixed(1)}K` : String(data.errors_today) },
          { icon: '⬆️', label: 'Uptime', value: data.uptime || '—' },
        ].map(({ icon, label, value }) => (
          <div key={label} className="px-3 py-2.5 text-center">
            <div className="text-xs text-muted-foreground">{icon} {label}</div>
            <div className="text-sm font-semibold font-mono text-foreground mt-0.5">{value}</div>
          </div>
        ))}
      </div>

      {/* Footer */}
      <div className="px-5 py-2 border-t border-border/20 flex items-center justify-between">
        <span className="text-2xs text-muted-foreground">
          📝 Refreshes every 60s
          {data.routines.last && (
            <span className="ml-2">· Last routine: <span className="font-mono">{data.routines.last.id}</span></span>
          )}
        </span>
        <button onClick={fetchData} className="text-2xs text-muted-foreground hover:text-foreground transition-colors">
          ↻ Refresh
        </button>
      </div>
    </div>
  )
}
