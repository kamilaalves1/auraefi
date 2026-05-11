'use client'

import { useState, useEffect, useCallback } from 'react'

/**
 * ModelRegistry — AI model collection
 *
 * Shows all Ollama models with sizes.
 * Highlights Amy-specific models.
 */

type ModelEntry = {
  name: string
  isAmy: boolean
  tags: { tag: string; size: number; sizeGB: number }[]
  totalSize: number
}

export function ModelRegistry() {
  const [models, setModels] = useState<ModelEntry[]>([])
  const [totalModels, setTotalModels] = useState(0)
  const [totalSizeGB, setTotalSizeGB] = useState(0)
  const [loading, setLoading] = useState(true)

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch('http://127.0.0.1:3100/api/models')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setModels(data.models || [])
      setTotalModels(data.totalModels || 0)
      setTotalSizeGB(data.totalSizeGB || 0)
    } catch { /* silent */ }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  if (loading) {
    return <div className="h-32 rounded-lg bg-surface-1/30 animate-pulse" />
  }

  const MODEL_ICONS: Record<string, string> = {
    'amy-local': '🤍',
    'llama3.1': '🦙',
    'qwen3': '🧠',
    'nomic-embed-text': '📐',
  }

  return (
    <div className="space-y-3">
      {/* Stats */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1.5">
          <span className="text-lg font-bold text-primary">{totalModels}</span>
          <span className="text-[9px] text-muted-foreground/30">models</span>
        </div>
        <div className="h-3 w-px bg-border/20" />
        <div className="flex items-center gap-1.5">
          <span className="text-sm font-bold text-foreground">{totalSizeGB}GB</span>
          <span className="text-[9px] text-muted-foreground/30">total</span>
        </div>
      </div>

      {/* Model cards */}
      <div className="space-y-1.5">
        {models.map(model => {
          const icon = MODEL_ICONS[model.name] || '🤖'
          const sizeGB = model.tags[0]?.sizeGB || 0
          const maxSize = Math.max(...models.map(m => m.tags[0]?.sizeGB || 0), 1)
          const pct = (sizeGB / maxSize) * 100

          return (
            <div
              key={model.name}
              className={`rounded-lg border p-2.5 ${
                model.isAmy
                  ? 'border-primary/30 bg-primary/5'
                  : 'border-border/15 bg-surface-1/10'
              }`}
            >
              <div className="flex items-center justify-between mb-1.5">
                <div className="flex items-center gap-2">
                  <span className="text-sm">{icon}</span>
                  <span className={`text-[11px] font-semibold ${model.isAmy ? 'text-primary' : 'text-foreground/60'}`}>
                    {model.name}
                  </span>
                  {model.isAmy && (
                    <span className="text-[7px] bg-primary/20 text-primary px-1 rounded font-medium">AMY</span>
                  )}
                </div>
                <span className="text-[10px] font-mono text-muted-foreground/30">{sizeGB}GB</span>
              </div>

              {/* Size bar */}
              <div className="relative h-1.5 rounded-full bg-surface-1/15 overflow-hidden">
                <div
                  className={`absolute inset-y-0 left-0 rounded-full transition-all duration-500 ${
                    model.isAmy ? 'bg-primary/40' : 'bg-foreground/15'
                  }`}
                  style={{ width: `${Math.max(pct, 2)}%` }}
                />
              </div>

              {/* Tags */}
              {model.tags.length > 0 && (
                <div className="flex items-center gap-1 mt-1">
                  {model.tags.map(tag => (
                    <span key={tag.tag} className="text-[7px] text-muted-foreground/20 font-mono bg-surface-1/15 px-1 rounded">
                      :{tag.tag}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
