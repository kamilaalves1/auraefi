'use client'

import { useState, useEffect, useCallback } from 'react'

/**
 * SafetyRails — Amy's 5-Layer Safety Guardrail Visualization
 *
 * Phase 119: Visualizes all safety systems protecting Amy's operations.
 * Each layer is a real guardrail from the production codebase.
 *
 * ⛨ PANEL TUNING GUIDE:
 * - Tier colors: line ~148 (green/amber/red gradient)
 * - Layer card heights: line ~120 (min-h-*)
 * - Score ring size: line ~72 (w-16 h-16)
 * - Expand animation: line ~110 (max-h-0/max-h-[600px])
 */

type Tier = {
  level: number
  label: string
  description: string
  actions: string[]
}

type Rule = {
  name: string
  description: string
  count: number
  examples: string[]
}

type SensitivityLevel = {
  level: string
  description: string
  actions: string[]
  color: string
}

type Advisor = {
  name: string
  icon: string
  role: string
}

type SafetyLayer = {
  name: string
  icon: string
  description: string
  status: string
  tiers?: Tier[]
  rules?: Rule[]
  sensitivity_levels?: SensitivityLevel[]
  execution_modes?: string[]
  total_action_types?: number
  advisors?: Advisor[]
  total_cases?: number
  quorum_required?: boolean
  stats?: Record<string, unknown>
}

type SafetyData = {
  score: number
  active_layers: number
  total_layers: number
  layers: SafetyLayer[]
  timestamp: string
}

export function SafetyRails() {
  const [data, setData] = useState<SafetyData | null>(null)
  const [loading, setLoading] = useState(true)
  const [expandedLayer, setExpandedLayer] = useState<number | null>(null)

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch('http://127.0.0.1:3100/api/safety-rails')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = await res.json()
      setData(json)
    } catch { /* silent */ }
    finally { setLoading(false) }
  }, [])

  useEffect(() => {
    fetchData()
    const interval = setInterval(fetchData, 60000) // refresh every 60s
    return () => clearInterval(interval)
  }, [fetchData])

  const toggleExpand = (idx: number) => {
    setExpandedLayer(expandedLayer === idx ? null : idx)
  }

  if (loading) {
    return (
      <div className="bg-surface-1 rounded-xl border border-border/50 p-6">
        <div className="animate-pulse space-y-3">
          <div className="h-4 bg-surface-2 rounded w-1/3" />
          <div className="h-20 bg-surface-2 rounded" />
        </div>
      </div>
    )
  }

  if (!data) {
    return (
      <div className="bg-surface-1 rounded-xl border border-border/50 p-6">
        <p className="text-muted-foreground text-sm">Safety Rails unavailable — Bridge offline</p>
      </div>
    )
  }

  const tierColors = ['text-green-400', 'text-blue-400', 'text-amber-400', 'text-red-400']
  const tierBgColors = ['bg-green-400/10', 'bg-blue-400/10', 'bg-amber-400/10', 'bg-red-400/10']
  const tierBorderColors = ['border-green-400/20', 'border-blue-400/20', 'border-amber-400/20', 'border-red-400/20']
  const sensitivityColors: Record<string, string> = { green: 'text-green-400', amber: 'text-amber-400', red: 'text-red-400' }
  const sensitivityBg: Record<string, string> = { green: 'bg-green-400/10', amber: 'bg-amber-400/10', red: 'bg-red-400/10' }

  return (
    <div className="bg-surface-1 rounded-xl border border-border/50 overflow-hidden">
      {/* Header */}
      <div className="px-5 py-4 border-b border-border/30 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-lg">⛨</span>
          <div>
            <h3 className="text-sm font-semibold text-foreground">Safety Rails</h3>
            <p className="text-xs text-muted-foreground">Amy&apos;s multi-layer guardrail system</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {/* Score ring */}
          <div className="relative w-14 h-14 flex items-center justify-center">
            <svg className="w-14 h-14 -rotate-90" viewBox="0 0 56 56">
              <circle cx="28" cy="28" r="24" fill="none" stroke="currentColor" className="text-surface-2" strokeWidth="3" />
              <circle
                cx="28" cy="28" r="24" fill="none"
                stroke="url(#safetyGradient)"
                strokeWidth="3"
                strokeDasharray={`${(data.score / 100) * 150.8} 150.8`}
                strokeLinecap="round"
              />
              <defs>
                <linearGradient id="safetyGradient" x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor="#22c55e" />
                  <stop offset="100%" stopColor="#a855f7" />
                </linearGradient>
              </defs>
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-sm font-bold text-foreground">{data.score}%</span>
            </div>
          </div>
          <div className="text-right">
            <div className="text-xs text-muted-foreground">{data.active_layers}/{data.total_layers} layers</div>
            <div className={`text-xs font-medium ${data.score === 100 ? 'text-green-400' : data.score >= 60 ? 'text-amber-400' : 'text-red-400'}`}>
              {data.score === 100 ? '● All Active' : data.score >= 60 ? '◐ Partial' : '○ Degraded'}
            </div>
          </div>
        </div>
      </div>

      {/* Layers */}
      <div className="divide-y divide-border/20">
        {data.layers.map((layer, idx) => (
          <div key={layer.name}>
            {/* Layer header — clickable */}
            <button
              onClick={() => toggleExpand(idx)}
              className="w-full px-5 py-3.5 flex items-center gap-3 hover:bg-surface-2/50 transition-colors text-left"
            >
              {/* Status dot */}
              <span className={`w-2 h-2 rounded-full flex-shrink-0 ${
                layer.status === 'active' ? 'bg-green-400 shadow-[0_0_6px_rgba(34,197,94,0.4)]' : 'bg-surface-2'
              }`} />

              {/* Icon */}
              <span className="text-base flex-shrink-0">{layer.icon}</span>

              {/* Name + description */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-foreground">{layer.name}</span>
                  {/* Layer-specific badge */}
                  {layer.tiers && (
                    <span className="text-2xs px-1.5 py-0.5 rounded-full bg-void-purple/10 text-void-purple border border-void-purple/20">
                      {layer.tiers.reduce((sum, t) => sum + t.actions.length, 0)} actions mapped
                    </span>
                  )}
                  {layer.rules && (
                    <span className="text-2xs px-1.5 py-0.5 rounded-full bg-amber-400/10 text-amber-400 border border-amber-400/20">
                      {layer.rules.reduce((sum, r) => sum + r.count, 0)} rules
                    </span>
                  )}
                  {layer.advisors && layer.advisors.length > 0 && (
                    <span className="text-2xs px-1.5 py-0.5 rounded-full bg-cyan-400/10 text-cyan-400 border border-cyan-400/20">
                      {layer.advisors.length} advisors
                    </span>
                  )}
                  {layer.sensitivity_levels && (
                    <span className="text-2xs px-1.5 py-0.5 rounded-full bg-red-400/10 text-red-400 border border-red-400/20">
                      {layer.total_action_types} action types
                    </span>
                  )}
                  {layer.stats && typeof layer.stats === 'object' && 'total_entries' in layer.stats && (
                    <span className="text-2xs px-1.5 py-0.5 rounded-full bg-green-400/10 text-green-400 border border-green-400/20">
                      {String(layer.stats.total_entries)} entries
                    </span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground truncate">{layer.description}</p>
              </div>

              {/* Expand chevron */}
              <span className={`text-muted-foreground transition-transform duration-200 flex-shrink-0 ${
                expandedLayer === idx ? 'rotate-180' : ''
              }`}>
                ▾
              </span>
            </button>

            {/* Expanded detail */}
            <div className={`overflow-hidden transition-all duration-300 ease-in-out ${
              expandedLayer === idx ? 'max-h-[600px] opacity-100' : 'max-h-0 opacity-0'
            }`}>
              <div className="px-5 pb-4 pt-1">
                {/* Approval Gate tiers */}
                {layer.tiers && layer.tiers.length > 0 && (
                  <div className="space-y-2">
                    {layer.tiers.map((tier) => (
                      <div key={tier.level} className={`flex items-start gap-3 p-2.5 rounded-lg border ${tierBorderColors[tier.level]} ${tierBgColors[tier.level]}`}>
                        <span className={`font-mono text-xs font-bold mt-0.5 ${tierColors[tier.level]}`}>
                          T{tier.level}
                        </span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-0.5">
                            <span className={`text-xs font-medium uppercase ${tierColors[tier.level]}`}>{tier.label}</span>
                            <span className="text-2xs text-muted-foreground">— {tier.description}</span>
                          </div>
                          <div className="flex flex-wrap gap-1">
                            {tier.actions.map((action) => (
                              <span key={action} className="text-2xs px-1.5 py-0.5 rounded bg-surface-2/80 text-muted-foreground font-mono">
                                {action}
                              </span>
                            ))}
                          </div>
                        </div>
                      </div>
                    ))}
                    {/* Stats row */}
                    {layer.stats && typeof layer.stats.total === 'number' && layer.stats.total > 0 && (
                      <div className="flex gap-4 pt-1 text-xs text-muted-foreground">
                        <span>Total: <strong className="text-foreground">{String(layer.stats.total)}</strong></span>
                        <span>Approved: <strong className="text-green-400">{String(layer.stats.approved)}</strong></span>
                        <span>Rejected: <strong className="text-red-400">{String(layer.stats.rejected)}</strong></span>
                        <span>Pending: <strong className="text-amber-400">{String(layer.stats.pending)}</strong></span>
                      </div>
                    )}
                  </div>
                )}

                {/* Email guardrail rules */}
                {layer.rules && layer.rules.length > 0 && (
                  <div className="space-y-2">
                    {layer.rules.map((rule) => (
                      <div key={rule.name} className="p-2.5 rounded-lg border border-border/20 bg-surface-2/30">
                        <div className="flex items-center gap-2 mb-1.5">
                          <span className="text-xs font-medium text-foreground">{rule.name}</span>
                          <span className="text-2xs px-1.5 py-0.5 rounded-full bg-amber-400/10 text-amber-400 border border-amber-400/20">
                            {rule.count}
                          </span>
                        </div>
                        <p className="text-2xs text-muted-foreground mb-1.5">{rule.description}</p>
                        <div className="flex flex-wrap gap-1">
                          {rule.examples.map((ex) => (
                            <span key={ex} className="text-2xs px-1.5 py-0.5 rounded bg-red-400/5 text-red-400/80 border border-red-400/10 font-mono">
                              {ex}
                            </span>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Action Boundary sensitivity levels */}
                {layer.sensitivity_levels && (
                  <div className="space-y-2">
                    {layer.sensitivity_levels.map((sl) => (
                      <div key={sl.level} className={`flex items-start gap-3 p-2.5 rounded-lg border border-border/20 ${sensitivityBg[sl.color] || 'bg-surface-2/30'}`}>
                        <span className={`text-xs font-bold mt-0.5 ${sensitivityColors[sl.color] || 'text-foreground'}`}>
                          {sl.level === 'Standard' ? '●' : sl.level === 'Elevated' ? '◐' : '⬤'}
                        </span>
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-0.5">
                            <span className={`text-xs font-medium ${sensitivityColors[sl.color] || 'text-foreground'}`}>{sl.level}</span>
                            <span className="text-2xs text-muted-foreground">— {sl.description}</span>
                          </div>
                          <div className="flex flex-wrap gap-1">
                            {sl.actions.map((a) => (
                              <span key={a} className="text-2xs px-1.5 py-0.5 rounded bg-surface-2/80 text-muted-foreground font-mono">{a}</span>
                            ))}
                          </div>
                        </div>
                      </div>
                    ))}
                    {layer.execution_modes && (
                      <div className="flex items-center gap-2 pt-1">
                        <span className="text-2xs text-muted-foreground">Execution modes:</span>
                        {layer.execution_modes.map((mode) => (
                          <span key={mode} className="text-2xs px-2 py-0.5 rounded-full bg-void-purple/10 text-void-purple border border-void-purple/20 font-medium">
                            {mode}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Council advisors */}
                {layer.advisors && layer.advisors.length > 0 && (
                  <div className="space-y-2">
                    <div className="grid grid-cols-2 gap-2">
                      {layer.advisors.map((advisor) => (
                        <div key={advisor.name} className="flex items-center gap-2 p-2.5 rounded-lg border border-border/20 bg-surface-2/30">
                          <span className="text-lg">{advisor.icon}</span>
                          <div>
                            <span className="text-xs font-medium text-foreground">{advisor.name}</span>
                            <p className="text-2xs text-muted-foreground">{advisor.role}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                    <div className="flex gap-4 pt-1 text-xs text-muted-foreground">
                      <span>Total cases: <strong className="text-foreground">{layer.total_cases}</strong></span>
                      <span>Quorum: <strong className={layer.quorum_required ? 'text-green-400' : 'text-red-400'}>{layer.quorum_required ? 'Required' : 'Optional'}</strong></span>
                    </div>
                  </div>
                )}

                {/* Execution audit stats */}
                {layer.stats && typeof layer.stats === 'object' && 'total_entries' in layer.stats && !layer.tiers && (
                  <div className="space-y-2">
                    <div className="grid grid-cols-2 gap-2">
                      <div className="p-2.5 rounded-lg border border-border/20 bg-surface-2/30">
                        <span className="text-2xs text-muted-foreground">Total Entries</span>
                        <p className="text-lg font-bold text-foreground">{String(layer.stats.total_entries)}</p>
                      </div>
                      <div className="p-2.5 rounded-lg border border-border/20 bg-surface-2/30">
                        <span className="text-2xs text-muted-foreground">Auto-Approved</span>
                        <p className="text-lg font-bold text-green-400">{String(layer.stats.auto_approved)}</p>
                      </div>
                      <div className="p-2.5 rounded-lg border border-border/20 bg-surface-2/30">
                        <span className="text-2xs text-muted-foreground">Fields per Record</span>
                        <p className="text-lg font-bold text-foreground">{String(layer.stats.fields_per_record)}</p>
                      </div>
                      <div className="p-2.5 rounded-lg border border-border/20 bg-surface-2/30">
                        <span className="text-2xs text-muted-foreground">Rollback Capable</span>
                        <p className="text-lg font-bold text-green-400">{layer.stats.rollback_capable ? '✓ Yes' : '✗ No'}</p>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Footer */}
      <div className="px-5 py-2.5 border-t border-border/20 flex items-center justify-between">
        <span className="text-2xs text-muted-foreground">
          ⛨ Observe without interfere — safety data is read-only
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
