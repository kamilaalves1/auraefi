'use client'

import { useState, useEffect } from 'react'

/**
 * EventTimeline — Chronological feed of recent events
 *
 * Phase 136: Shows the last 30 events across all Amy services,
 * merged and sorted by timestamp.
 */

interface TimelineEvent {
  timestamp: string | null
  source: string
  icon: string
  type: 'info' | 'error' | 'warning' | 'success'
  message: string
}

const typeStyles: Record<string, { dot: string; text: string }> = {
  error:   { dot: 'bg-red-500',     text: 'text-red-400/80' },
  warning: { dot: 'bg-amber-500',   text: 'text-amber-400/80' },
  success: { dot: 'bg-emerald-500', text: 'text-emerald-400/80' },
  info:    { dot: 'bg-zinc-500',    text: 'text-muted-foreground/60' },
}

export function EventTimeline() {
  const [events, setEvents] = useState<TimelineEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [count, setCount] = useState(0)

  useEffect(() => {
    const fetchTimeline = async () => {
      try {
        const res = await fetch('http://127.0.0.1:3100/api/event-timeline')
        const data = await res.json()
        setEvents(data.events || [])
        setCount(data.count || 0)
      } catch {
        setEvents([])
      } finally {
        setLoading(false)
      }
    }
    fetchTimeline()
    const interval = setInterval(fetchTimeline, 30_000)
    return () => clearInterval(interval)
  }, [])

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground/50 text-xs p-4">
        <span className="w-3 h-3 rounded-full border-2 border-primary/30 border-t-primary animate-spin" />
        Loading timeline...
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-lg">📜</span>
          <h3 className="text-sm font-semibold text-foreground">Event Timeline</h3>
          <span className="px-1.5 py-0.5 rounded text-[9px] font-mono bg-violet-500/15 text-violet-300">
            {count} events
          </span>
        </div>
        <div className="text-[10px] text-muted-foreground/40 font-mono">
          refreshes every 30s
        </div>
      </div>

      {/* Timeline */}
      <div className="space-y-0.5 max-h-[300px] overflow-y-auto pr-1 scrollbar-thin">
        {events.map((event, i) => {
          const style = typeStyles[event.type] || typeStyles.info
          return (
            <div
              key={i}
              className="flex items-start gap-2 py-1.5 px-2 rounded hover:bg-surface-1/30 transition-colors group"
            >
              {/* Timeline dot */}
              <div className="flex flex-col items-center mt-1.5">
                <span className={`w-1.5 h-1.5 rounded-full ${style.dot}`} />
                {i < events.length - 1 && (
                  <div className="w-px h-full min-h-[20px] bg-border/20" />
                )}
              </div>

              {/* Content */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-[11px]">{event.icon}</span>
                  <span className="text-[10px] font-medium text-muted-foreground/50">{event.source}</span>
                  {event.timestamp && (
                    <span className="text-[9px] font-mono text-muted-foreground/30 ml-auto">
                      {new Date(event.timestamp).toLocaleTimeString()}
                    </span>
                  )}
                </div>
                <p className={`text-[11px] leading-relaxed truncate ${style.text}`}>
                  {event.message}
                </p>
              </div>
            </div>
          )
        })}
      </div>

      {/* Tip */}
      <div className="px-3 py-1.5 rounded bg-surface-1/20 border border-border/10">
        <p className="text-[10px] text-muted-foreground/50 italic">
          💡 Live feed from all Amy log files. Red = errors, amber = warnings, green = successes, gray = info. Refreshes every 30s.
        </p>
      </div>
    </div>
  )
}
