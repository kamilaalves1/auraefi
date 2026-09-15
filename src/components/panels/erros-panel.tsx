'use client'

import { useState, useCallback } from 'react'
import { useSmartPoll } from '@/lib/use-smart-poll'

interface ErrorLogEntry {
  id: number
  level: string
  source: string
  message: string
  data: Record<string, unknown> | null
  workspace_id: number
  created_at: number
}

const SOURCE_LABELS: Record<string, string> = {
  'pipeline:push': 'Push de código',
  'pipeline:merge': 'Merge',
  'pipeline:llm': 'LLM (pipeline)',
  'task:dispatch': 'Dispatch de tarefa',
  'aegis:review': 'Aegis Review',
}

const LEVEL_COLORS: Record<string, string> = {
  error: 'text-red-400 bg-red-400/10 border-red-400/20',
  warn: 'text-yellow-400 bg-yellow-400/10 border-yellow-400/20',
}

function formatTs(ts: number): string {
  return new Date(ts * 1000).toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  })
}

export function ErrosPanel() {
  const [errors, setErrors] = useState<ErrorLogEntry[]>([])
  const [total, setTotal] = useState(0)
  const [source, setSource] = useState('')
  const [expanded, setExpanded] = useState<Set<number>>(new Set())
  const [clearing, setClearing] = useState(false)
  const [feedback, setFeedback] = useState<string | null>(null)

  const fetchErrors = useCallback(async () => {
    const params = new URLSearchParams({ limit: '100' })
    if (source) params.set('source', source)
    const res = await fetch(`/api/errors?${params}`)
    if (!res.ok) return
    const data = await res.json()
    setErrors(data.errors ?? [])
    setTotal(data.total ?? 0)
  }, [source])

  useSmartPoll(fetchErrors, { interval: 10_000, immediate: true })

  const toggleExpand = (id: number) => {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const clearAll = async () => {
    setClearing(true)
    try {
      const res = await fetch('/api/errors', { method: 'DELETE' })
      if (res.ok) {
        setErrors([])
        setTotal(0)
        setFeedback('Erros limpos com sucesso')
        setTimeout(() => setFeedback(null), 3000)
      }
    } finally {
      setClearing(false)
    }
  }

  const sources = Array.from(new Set(errors.map(e => e.source)))

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-border/60 shrink-0">
        <div className="flex items-center gap-3">
          <h1 className="text-base font-semibold text-foreground">Erros do Sistema</h1>
          {total > 0 && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-red-500/10 text-red-400 font-medium border border-red-500/20">
              {total} registro{total !== 1 ? 's' : ''}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {feedback && (
            <span className="text-xs text-green-400">{feedback}</span>
          )}
          {errors.length > 0 && (
            <button
              onClick={clearAll}
              disabled={clearing}
              className="text-xs px-3 py-1.5 rounded-lg border border-border/60 text-muted-foreground hover:text-foreground hover:border-border transition-colors disabled:opacity-50"
            >
              {clearing ? 'Limpando...' : 'Limpar tudo'}
            </button>
          )}
        </div>
      </div>

      {/* Filters */}
      {sources.length > 1 && (
        <div className="flex items-center gap-2 px-6 py-2.5 border-b border-border/40 shrink-0 flex-wrap">
          <span className="text-xs text-muted-foreground">Filtrar:</span>
          <button
            onClick={() => setSource('')}
            className={`text-xs px-2.5 py-1 rounded-lg border transition-colors ${
              source === '' ? 'bg-primary/10 border-primary/30 text-primary' : 'border-border/50 text-muted-foreground hover:text-foreground'
            }`}
          >
            Todos
          </button>
          {sources.map(s => (
            <button
              key={s}
              onClick={() => setSource(s === source ? '' : s)}
              className={`text-xs px-2.5 py-1 rounded-lg border transition-colors ${
                source === s ? 'bg-primary/10 border-primary/30 text-primary' : 'border-border/50 text-muted-foreground hover:text-foreground'
              }`}
            >
              {SOURCE_LABELS[s] ?? s}
            </button>
          ))}
        </div>
      )}

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {errors.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-muted-foreground gap-2">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-10 h-10 opacity-30">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <p className="text-sm">Nenhum erro registrado</p>
          </div>
        ) : (
          <div className="divide-y divide-border/40">
            {errors.map(err => (
              <div key={err.id} className="px-6 py-3 hover:bg-muted/20 transition-colors">
                <div className="flex items-start gap-3">
                  {/* Level badge */}
                  <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded border uppercase tracking-wide shrink-0 mt-0.5 ${LEVEL_COLORS[err.level] ?? LEVEL_COLORS.error}`}>
                    {err.level}
                  </span>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-medium text-foreground/80">
                        {SOURCE_LABELS[err.source] ?? err.source}
                      </span>
                      <span className="text-[10px] text-muted-foreground">
                        {formatTs(err.created_at)}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5 break-words leading-relaxed">
                      {err.message}
                    </p>

                    {/* Extra data */}
                    {err.data && (
                      <div className="mt-1.5">
                        <button
                          onClick={() => toggleExpand(err.id)}
                          className="text-[10px] text-primary/70 hover:text-primary transition-colors"
                        >
                          {expanded.has(err.id) ? '▲ Ocultar detalhes' : '▼ Ver detalhes'}
                        </button>
                        {expanded.has(err.id) && (
                          <pre className="mt-1.5 text-[10px] bg-muted/30 rounded-lg p-2.5 overflow-x-auto text-muted-foreground border border-border/40 leading-relaxed">
                            {JSON.stringify(err.data, null, 2)}
                          </pre>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
