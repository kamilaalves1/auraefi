'use client'

import { useEffect, useState, useCallback } from 'react'

/**
 * Public Status Page — Vertex Control Center
 *
 * Like GitHub Status or Vercel Status, shows the real-time health
 * of all Amy services in a beautiful, animated interface.
 *
 * No authentication required. Clients can bookmark this.
 */

type Service = {
  name: string
  status: 'healthy' | 'degraded' | 'offline'
  latencyMs: number
  detail?: string
  score?: number
  components?: Array<{
    name: string
    score: number
    status: string
    detail: string
  }>
}

type HealthData = {
  status: string
  score: number
  services: Service[]
  uptime: number
  timestamp: string
  version: string
}

const STATUS_CONFIG = {
  healthy: {
    color: 'text-emerald-400',
    bg: 'bg-emerald-500/15',
    border: 'border-emerald-500/30',
    dot: 'bg-emerald-500',
    glow: 'shadow-emerald-500/20',
    label: 'Operational',
    icon: '✓',
  },
  degraded: {
    color: 'text-amber-400',
    bg: 'bg-amber-500/15',
    border: 'border-amber-500/30',
    dot: 'bg-amber-500',
    glow: 'shadow-amber-500/20',
    label: 'Degraded',
    icon: '!',
  },
  offline: {
    color: 'text-red-400',
    bg: 'bg-red-500/15',
    border: 'border-red-500/30',
    dot: 'bg-red-500',
    glow: 'shadow-red-500/20',
    label: 'Offline',
    icon: '✕',
  },
  critical: {
    color: 'text-red-400',
    bg: 'bg-red-500/15',
    border: 'border-red-500/30',
    dot: 'bg-red-500',
    glow: 'shadow-red-500/20',
    label: 'Critical',
    icon: '✕',
  },
}

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400)
  const h = Math.floor((seconds % 86400) / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (d > 0) return `${d}d ${h}h ${m}m`
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

function formatLatency(ms: number): string {
  if (ms < 1) return '<1ms'
  if (ms < 1000) return `${Math.round(ms)}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

export default function StatusPage() {
  const [data, setData] = useState<HealthData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [lastCheck, setLastCheck] = useState<Date | null>(null)
  const [history, setHistory] = useState<Array<{ time: Date; score: number }>>([])

  const fetchHealth = useCallback(async () => {
    try {
      const res = await fetch('/api/amy/health')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const d = await res.json()
      setData(d)
      setError(null)
      setLastCheck(new Date())
      setHistory(prev => [...prev.slice(-29), { time: new Date(), score: d.score }])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch status')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchHealth()
    const interval = setInterval(fetchHealth, 30000)
    return () => clearInterval(interval)
  }, [fetchHealth])

  const overallConfig = data
    ? STATUS_CONFIG[data.status as keyof typeof STATUS_CONFIG] || STATUS_CONFIG.offline
    : STATUS_CONFIG.offline

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white selection:bg-purple-500/30">
      {/* Gradient background */}
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute inset-0 bg-gradient-to-b from-purple-900/10 via-transparent to-transparent" />
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[400px] bg-purple-500/5 rounded-full blur-[120px]" />
      </div>

      <div className="relative max-w-3xl mx-auto px-4 py-12">
        {/* Header */}
        <header className="text-center mb-12">
          <div className="inline-flex items-center gap-2 mb-4 px-3 py-1 rounded-full border border-purple-500/20 bg-purple-500/5 text-xs text-purple-400">
            <span className="h-2 w-2 rounded-full bg-purple-500 animate-pulse" />
            Vertex Control Center
          </div>
          <h1 className="text-3xl font-bold tracking-tight mb-2">
            System Status
          </h1>
          <p className="text-sm text-zinc-500">
            Real-time monitoring of Amy AI Operations Platform
          </p>
        </header>

        {/* Overall Status Banner */}
        {loading ? (
          <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-8 mb-8 animate-pulse">
            <div className="h-6 w-48 mx-auto rounded bg-zinc-800" />
            <div className="h-4 w-32 mx-auto rounded bg-zinc-800 mt-3" />
          </div>
        ) : error ? (
          <div className="rounded-2xl border border-red-500/20 bg-red-500/5 p-8 mb-8 text-center">
            <div className="text-4xl mb-3">⚠️</div>
            <h2 className="text-lg font-semibold text-red-400">Unable to Check Status</h2>
            <p className="text-sm text-red-400/60 mt-1">{error}</p>
            <button
              onClick={fetchHealth}
              className="mt-4 px-4 py-1.5 rounded-lg bg-red-500/10 text-sm text-red-400 hover:bg-red-500/20 transition-colors"
            >
              Retry
            </button>
          </div>
        ) : (
          <div className={`rounded-2xl border ${overallConfig.border} ${overallConfig.bg} p-8 mb-8 text-center shadow-lg ${overallConfig.glow}`}>
            <div className="flex items-center justify-center gap-3 mb-2">
              <span className={`flex items-center justify-center h-8 w-8 rounded-full ${overallConfig.dot} text-white text-sm font-bold shadow-lg ${overallConfig.glow}`}>
                {overallConfig.icon}
              </span>
              <h2 className={`text-2xl font-bold ${overallConfig.color}`}>
                {data?.status === 'healthy' ? 'All Systems Operational' :
                 data?.status === 'degraded' ? 'Partial Service Degradation' :
                 'System Outage Detected'}
              </h2>
            </div>
            <p className="text-sm text-zinc-400">
              Health Score: <span className={`font-semibold ${overallConfig.color}`}>{data?.score}%</span>
              {data?.uptime && (
                <span className="ml-3 text-zinc-500">
                  Uptime: {formatUptime(data.uptime)}
                </span>
              )}
            </p>
          </div>
        )}

        {/* Score History Bar */}
        {history.length > 1 && (
          <div className="mb-8">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-zinc-500">Health Score (last {history.length} checks)</span>
              <span className="text-xs text-zinc-600">30s interval</span>
            </div>
            <div className="flex gap-0.5 h-8 items-end">
              {history.map((point, i) => {
                const height = Math.max(4, (point.score / 100) * 32)
                const color = point.score >= 90 ? 'bg-emerald-500' :
                              point.score >= 60 ? 'bg-amber-500' : 'bg-red-500'
                return (
                  <div
                    key={i}
                    className={`flex-1 rounded-t ${color} transition-all duration-300`}
                    style={{ height: `${height}px`, opacity: 0.3 + (i / history.length) * 0.7 }}
                    title={`${point.score}% at ${point.time.toLocaleTimeString()}`}
                  />
                )
              })}
            </div>
          </div>
        )}

        {/* Services */}
        {data?.services && (
          <div className="space-y-3 mb-8">
            <h3 className="text-xs uppercase tracking-wider text-zinc-500 mb-4">Services</h3>
            {data.services.map((service, idx) => {
              const cfg = STATUS_CONFIG[service.status as keyof typeof STATUS_CONFIG] || STATUS_CONFIG.offline

              return (
                <div
                  key={idx}
                  className="rounded-xl border border-zinc-800/80 bg-zinc-900/50 backdrop-blur-sm p-4 hover:border-zinc-700/80 transition-colors"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <span className={`h-2.5 w-2.5 rounded-full ${cfg.dot} ${service.status === 'healthy' ? '' : 'animate-pulse'}`} />
                      <div>
                        <h4 className="text-sm font-medium text-zinc-200">{service.name}</h4>
                        {service.detail && (
                          <p className="text-xs text-zinc-500 mt-0.5">{service.detail}</p>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-zinc-600 font-mono">
                        {formatLatency(service.latencyMs)}
                      </span>
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${cfg.bg} ${cfg.color}`}>
                        {cfg.label}
                      </span>
                    </div>
                  </div>

                  {/* Sub-components (for Bridge) */}
                  {service.components && service.components.length > 0 && (
                    <div className="mt-3 pt-3 border-t border-zinc-800/50 grid grid-cols-2 sm:grid-cols-3 gap-2">
                      {service.components.map((comp, ci) => (
                        <div key={ci} className="flex items-center gap-1.5">
                          <span className={`h-1.5 w-1.5 rounded-full ${comp.score >= 80 ? 'bg-emerald-500' : comp.score >= 50 ? 'bg-amber-500' : 'bg-red-500'}`} />
                          <span className="text-[11px] text-zinc-400">{comp.name}</span>
                          <span className="text-[10px] text-zinc-600 ml-auto font-mono">{comp.score}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {/* Footer */}
        <footer className="text-center border-t border-zinc-800/50 pt-6">
          <div className="flex items-center justify-center gap-4 text-xs text-zinc-600">
            {data?.version && (
              <span className="font-mono">{data.version}</span>
            )}
            {lastCheck && (
              <span>Last checked: {lastCheck.toLocaleTimeString()}</span>
            )}
            <button
              onClick={fetchHealth}
              className="text-purple-400/60 hover:text-purple-400 transition-colors"
            >
              Check now
            </button>
          </div>
          <div className="mt-4 flex items-center justify-center gap-2 text-xs text-zinc-700">
            <span className="h-1.5 w-1.5 rounded-full bg-purple-500/50" />
            Silver Snow Vertex — Powered by Amy
          </div>
        </footer>
      </div>
    </div>
  )
}
