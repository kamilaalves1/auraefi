'use client'

import { useState, useEffect, useCallback } from 'react'

/**
 * ClawBytesRecipes — Automation Recipe Book
 *
 * Phase 122: Visualizes adapted automation recipes from the OpenClaw/kilo.ai
 * ClawBytes ecosystem plus Amy-native recipes. Read-only catalogue.
 *
 * 🤖 PANEL TUNING GUIDE:
 * - Source badge colors: line ~85 (purple=clawbytes, green=amy-native)
 * - Category tab colors: line ~95
 * - Risk tier pills: line ~135
 * - Card expand animation: line ~115 (max-h-0/max-h-[800px])
 */

type Recipe = {
  id: string
  name: string
  icon: string
  description: string
  source: string
  category: string
  ingredients: string[]
  prompt: string
  tweak_tips: string[]
  schedule: { time: string; days: string[] }
  risk_tier: number
  enabled: boolean
  last_run: string | null
  run_count: number
}

type ClawBytesData = {
  recipes: Recipe[]
  total: number
  enabled: number
  total_runs: number
  categories: Record<string, number>
  sources: Record<string, number>
  timestamp: string
}

const CATEGORY_LABELS: Record<string, { label: string; icon: string }> = {
  all: { label: 'All', icon: '📋' },
  work: { label: 'Work', icon: '💼' },
  ops: { label: 'Ops', icon: '⚙️' },
  knowledge: { label: 'Knowledge', icon: '🧠' },
}

const RISK_LABELS: Record<number, { label: string; color: string; bg: string; border: string }> = {
  0: { label: 'T0 Auto', color: 'text-green-400', bg: 'bg-green-400/10', border: 'border-green-400/20' },
  1: { label: 'T1 Log', color: 'text-blue-400', bg: 'bg-blue-400/10', border: 'border-blue-400/20' },
  2: { label: 'T2 Approve', color: 'text-amber-400', bg: 'bg-amber-400/10', border: 'border-amber-400/20' },
  3: { label: 'T3 Confirm', color: 'text-red-400', bg: 'bg-red-400/10', border: 'border-red-400/20' },
}

const DAY_LABELS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']
const DAY_SHORT = ['M', 'T', 'W', 'T', 'F', 'S', 'S']

export function ClawBytesRecipes() {
  const [data, setData] = useState<ClawBytesData | null>(null)
  const [loading, setLoading] = useState(true)
  const [activeCategory, setActiveCategory] = useState('all')
  const [expandedRecipe, setExpandedRecipe] = useState<string | null>(null)

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch('http://127.0.0.1:3100/api/clawbytes')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = await res.json()
      setData(json)
    } catch { /* silent */ }
    finally { setLoading(false) }
  }, [])

  useEffect(() => {
    fetchData()
    const interval = setInterval(fetchData, 60000)
    return () => clearInterval(interval)
  }, [fetchData])

  const toggleExpand = (id: string) => {
    setExpandedRecipe(expandedRecipe === id ? null : id)
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
        <p className="text-muted-foreground text-sm">ClawBytes unavailable — Bridge offline</p>
      </div>
    )
  }

  const filteredRecipes = activeCategory === 'all'
    ? data.recipes
    : data.recipes.filter(r => r.category === activeCategory)

  return (
    <div className="bg-surface-1 rounded-xl border border-border/50 overflow-hidden">
      {/* Header */}
      <div className="px-5 py-4 border-b border-border/30 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-lg">🤖</span>
          <div>
            <h3 className="text-sm font-semibold text-foreground">ClawBytes Recipes</h3>
            <p className="text-xs text-muted-foreground">Automation cookbook from OpenClaw + Amy</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {/* Source badges */}
          <div className="flex items-center gap-1.5">
            <span className="text-2xs px-2 py-0.5 rounded-full bg-void-purple/10 text-void-purple border border-void-purple/20 font-medium">
              {data.sources['clawbytes'] || 0} ClawBytes
            </span>
            <span className="text-2xs px-2 py-0.5 rounded-full bg-green-400/10 text-green-400 border border-green-400/20 font-medium">
              {data.sources['amy-native'] || 0} Amy-native
            </span>
          </div>
          {/* Total count */}
          <div className="text-right">
            <div className="text-xs text-muted-foreground">{data.total} recipes</div>
            <div className={`text-xs font-medium ${data.enabled > 0 ? 'text-green-400' : 'text-muted-foreground'}`}>
              {data.enabled > 0 ? `${data.enabled} enabled` : 'All standby'}
            </div>
          </div>
        </div>
      </div>

      {/* Category tabs */}
      <div className="px-5 py-2.5 border-b border-border/20 flex items-center gap-1.5">
        {Object.entries(CATEGORY_LABELS).map(([key, { label, icon }]) => {
          const count = key === 'all' ? data.total : (data.categories[key] || 0)
          return (
            <button
              key={key}
              onClick={() => setActiveCategory(key)}
              className={`text-2xs px-3 py-1.5 rounded-full font-medium transition-all duration-200 ${
                activeCategory === key
                  ? 'bg-void-purple/20 text-void-purple border border-void-purple/30'
                  : 'text-muted-foreground hover:text-foreground hover:bg-surface-2/50 border border-transparent'
              }`}
            >
              {icon} {label} ({count})
            </button>
          )
        })}
      </div>

      {/* Recipe cards */}
      <div className="divide-y divide-border/20">
        {filteredRecipes.map((recipe) => {
          const risk = RISK_LABELS[recipe.risk_tier] || RISK_LABELS[0]
          const isExpanded = expandedRecipe === recipe.id
          const isClawBytes = recipe.source === 'clawbytes'

          return (
            <div key={recipe.id}>
              {/* Recipe header — clickable */}
              <button
                onClick={() => toggleExpand(recipe.id)}
                className="w-full px-5 py-3.5 flex items-center gap-3 hover:bg-surface-2/50 transition-colors text-left"
              >
                {/* Status dot */}
                <span className={`w-2 h-2 rounded-full flex-shrink-0 ${
                  recipe.enabled ? 'bg-green-400 shadow-[0_0_6px_rgba(34,197,94,0.4)]' : 'bg-surface-2'
                }`} />

                {/* Icon */}
                <span className="text-base flex-shrink-0">{recipe.icon}</span>

                {/* Name + description */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-foreground">{recipe.name}</span>
                    {/* Source badge */}
                    <span className={`text-2xs px-1.5 py-0.5 rounded-full border font-medium ${
                      isClawBytes
                        ? 'bg-void-purple/10 text-void-purple border-void-purple/20'
                        : 'bg-green-400/10 text-green-400 border-green-400/20'
                    }`}>
                      {isClawBytes ? 'ClawBytes' : 'Amy'}
                    </span>
                    {/* Risk tier */}
                    <span className={`text-2xs px-1.5 py-0.5 rounded-full border font-mono ${risk.bg} ${risk.color} ${risk.border}`}>
                      {risk.label}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground truncate">{recipe.description}</p>
                </div>

                {/* Expand chevron */}
                <span className={`text-muted-foreground transition-transform duration-200 flex-shrink-0 ${
                  isExpanded ? 'rotate-180' : ''
                }`}>
                  ▾
                </span>
              </button>

              {/* Expanded detail */}
              <div className={`overflow-hidden transition-all duration-300 ease-in-out ${
                isExpanded ? 'max-h-[800px] opacity-100' : 'max-h-0 opacity-0'
              }`}>
                <div className="px-5 pb-4 pt-1 space-y-3">
                  {/* Ingredients */}
                  <div>
                    <span className="text-2xs text-muted-foreground uppercase tracking-wider">Ingredients</span>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {recipe.ingredients.map((ing) => (
                        <span key={ing} className="text-2xs px-2 py-0.5 rounded-full bg-surface-2/80 text-muted-foreground border border-border/20">
                          {ing}
                        </span>
                      ))}
                    </div>
                  </div>

                  {/* Prompt */}
                  <div>
                    <span className="text-2xs text-muted-foreground uppercase tracking-wider">Prompt</span>
                    <div className="mt-1 p-3 rounded-lg bg-surface-2/40 border border-border/20">
                      <pre className="text-2xs text-foreground/80 font-mono whitespace-pre-wrap leading-relaxed">{recipe.prompt}</pre>
                    </div>
                  </div>

                  {/* Tweak tips */}
                  {recipe.tweak_tips.length > 0 && (
                    <div>
                      <span className="text-2xs text-muted-foreground uppercase tracking-wider">Tweak Tips</span>
                      <ul className="mt-1 space-y-1">
                        {recipe.tweak_tips.map((tip, i) => (
                          <li key={i} className="text-2xs text-muted-foreground flex items-start gap-1.5">
                            <span className="text-void-purple mt-0.5">▸</span>
                            {tip}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Schedule + Stats row */}
                  <div className="flex items-center justify-between pt-1">
                    <div className="flex items-center gap-3">
                      {/* Schedule time */}
                      <span className="text-2xs font-mono text-foreground bg-surface-2/60 px-2 py-0.5 rounded">
                        ⏰ {recipe.schedule.time}
                      </span>
                      {/* Day dots */}
                      <div className="flex items-center gap-0.5">
                        {DAY_LABELS.map((day, i) => (
                          <span
                            key={day}
                            className={`w-4 h-4 rounded-full text-center text-[9px] leading-4 font-medium ${
                              recipe.schedule.days.includes(day)
                                ? 'bg-void-purple/20 text-void-purple'
                                : 'bg-surface-2/40 text-muted-foreground/40'
                            }`}
                          >
                            {DAY_SHORT[i]}
                          </span>
                        ))}
                      </div>
                    </div>
                    <div className="flex items-center gap-3 text-2xs text-muted-foreground">
                      <span>Runs: <strong className="text-foreground">{recipe.run_count}</strong></span>
                      <span>{recipe.enabled ? '● Active' : '○ Standby'}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {/* Footer */}
      <div className="px-5 py-2.5 border-t border-border/20 flex items-center justify-between">
        <span className="text-2xs text-muted-foreground">
          🤖 Recipes are read-only — enable via schedules.json
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
