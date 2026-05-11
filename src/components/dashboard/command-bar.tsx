'use client'

import { useState, useEffect, useCallback } from 'react'

/**
 * CommandBar — Animated KPI strip for the top of the dashboard
 *
 * Shows the full operational picture at a glance:
 * Health score, events, tasks, approvals, notifications, knowledge files
 */

type BarData = {
  health: { score: number; status: string }
  events: number
  tasks: { active: number; total: number }
  approvals: number
  notifications: number
  knowledge: number
}

function AnimatedCounter({ value, label, icon, color }: {
  value: number
  label: string
  icon: string
  color: string
}) {
  const [displayed, setDisplayed] = useState(0)

  useEffect(() => {
    if (value === displayed) return
    const diff = value - displayed
    const steps = Math.min(Math.abs(diff), 20)
    const step = diff / steps
    let current = displayed
    let i = 0
    const timer = setInterval(() => {
      current += step
      i++
      if (i >= steps) {
        setDisplayed(value)
        clearInterval(timer)
      } else {
        setDisplayed(Math.round(current))
      }
    }, 30)
    return () => clearInterval(timer)
  }, [value, displayed])

  return (
    <div className="flex items-center gap-2 px-3 py-1.5">
      <span className="text-sm">{icon}</span>
      <div className="min-w-0">
        <div className={`text-base font-bold tabular-nums ${color}`}>{displayed}</div>
        <div className="text-[9px] text-muted-foreground/40 truncate">{label}</div>
      </div>
    </div>
  )
}

function HealthGauge({ score, status }: { score: number; status: string }) {
  const color = score >= 90 ? 'text-emerald-400' :
                score >= 60 ? 'text-amber-400' : 'text-red-400'
  const bgColor = score >= 90 ? 'bg-emerald-500' :
                  score >= 60 ? 'bg-amber-500' : 'bg-red-500'
  const glow = score >= 90 ? 'shadow-emerald-500/30' :
               score >= 60 ? 'shadow-amber-500/30' : 'shadow-red-500/30'

  return (
    <div className="flex items-center gap-2.5 px-3 py-1.5">
      <div className={`relative h-9 w-9 rounded-full border-2 ${score >= 90 ? 'border-emerald-500/40' : score >= 60 ? 'border-amber-500/40' : 'border-red-500/40'} flex items-center justify-center shadow-lg ${glow}`}>
        <div
          className={`absolute inset-1 rounded-full ${bgColor} opacity-10`}
          style={{ clipPath: `inset(${100 - score}% 0 0 0)` }}
        />
        <span className={`text-xs font-bold ${color} tabular-nums`}>{score}</span>
      </div>
      <div className="min-w-0">
        <div className={`text-xs font-semibold ${color}`}>
          {status === 'healthy' ? 'Healthy' : status === 'degraded' ? 'Degraded' : 'Critical'}
        </div>
        <div className="text-[9px] text-muted-foreground/40">Health Score</div>
      </div>
    </div>
  )
}

export function CommandBar() {
  const [data, setData] = useState<BarData | null>(null)
  const [pulse, setPulse] = useState(false)

  const fetchData = useCallback(async () => {
    try {
      // Fetch health + knowledge in parallel
      const [healthRes, knowledgeRes] = await Promise.all([
        fetch('/api/amy/health'),
        fetch('http://127.0.0.1:3100/api/knowledge/browse'),
      ])

      const healthData = healthRes.ok ? await healthRes.json() : null
      const knowledgeData = knowledgeRes.ok ? await knowledgeRes.json() : null

      // Extract service counts from health data
      const services = healthData?.services || []
      const activityService = services.find((s: any) => s.name === 'Activity Log')
      const taskService = services.find((s: any) => s.name === 'Task Queue')
      const approvalService = services.find((s: any) => s.name === 'Approval Gate')
      const notifService = services.find((s: any) => s.name === 'Notifications')

      // Parse detail strings for counts
      const parseCount = (detail: string, pattern: RegExp): number => {
        const match = detail?.match(pattern)
        return match ? parseInt(match[1]) : 0
      }

      setData({
        health: {
          score: healthData?.score || 0,
          status: healthData?.status || 'offline',
        },
        events: parseCount(activityService?.detail || '', /(\d+)/),
        tasks: {
          active: parseCount(taskService?.detail || '', /(\d+)\s*active/),
          total: parseCount(taskService?.detail || '', /(\d+)\s*recent/) +
                 parseCount(taskService?.detail || '', /(\d+)\s*active/),
        },
        approvals: parseCount(approvalService?.detail || '', /(\d+)\s*pending/),
        notifications: parseCount(notifService?.detail || '', /(\d+)\s*total/),
        knowledge: knowledgeData?.totalFiles || 0,
      })

      setPulse(true)
      setTimeout(() => setPulse(false), 300)
    } catch {
      // Silently fail — bar is informational
    }
  }, [])

  useEffect(() => {
    fetchData()
    const interval = setInterval(fetchData, 30000)
    return () => clearInterval(interval)
  }, [fetchData])

  if (!data) {
    return (
      <div className="rounded-xl border border-border bg-card/50 px-2 py-2 animate-pulse">
        <div className="flex items-center justify-between">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="flex items-center gap-2 px-3">
              <div className="h-4 w-4 rounded bg-surface-1" />
              <div className="space-y-1">
                <div className="h-4 w-8 rounded bg-surface-1" />
                <div className="h-2 w-12 rounded bg-surface-1" />
              </div>
            </div>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className={`rounded-xl border border-border bg-gradient-to-r from-card via-card to-card/80 overflow-hidden transition-all duration-300 ${pulse ? 'ring-1 ring-primary/20' : ''}`}>
      <div className="flex items-center justify-between px-1 py-0.5">
        <HealthGauge score={data.health.score} status={data.health.status} />

        <div className="h-6 w-px bg-border/30" />

        <AnimatedCounter
          value={data.events}
          label="Events"
          icon="⚡"
          color="text-foreground"
        />

        <div className="h-6 w-px bg-border/30" />

        <AnimatedCounter
          value={data.tasks.active}
          label="Active Tasks"
          icon="📋"
          color="text-foreground"
        />

        <div className="h-6 w-px bg-border/30" />

        <AnimatedCounter
          value={data.approvals}
          label="Pending"
          icon="🔐"
          color={data.approvals > 0 ? 'text-amber-400' : 'text-foreground'}
        />

        <div className="h-6 w-px bg-border/30" />

        <AnimatedCounter
          value={data.notifications}
          label="Alerts"
          icon="🔔"
          color="text-foreground"
        />

        <div className="h-6 w-px bg-border/30" />

        <AnimatedCounter
          value={data.knowledge}
          label="Knowledge"
          icon="📚"
          color="text-foreground"
        />

        <div className="h-6 w-px bg-border/30" />

        {/* Live indicator */}
        <div className="flex items-center gap-1.5 px-3 py-1.5">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
          </span>
          <span className="text-[9px] text-emerald-400/60 font-medium">LIVE</span>
        </div>
      </div>
    </div>
  )
}
