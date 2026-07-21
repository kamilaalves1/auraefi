'use client'

import { useState, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import type { DeliveryFlowStage } from '@/lib/delivery-flow-types'

interface CardRun {
  id: number
  card_key: string
  card_title: string
  card_url: string
  current_stage_id: string
  status: string
  created_at: number
  updated_at: number
}

interface CardMessage {
  direction: string
  stage_id: string
  body: string
  created_at: number
}

const STATUS_STYLES: Record<string, string> = {
  running: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
  waiting_input: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  done: 'bg-green-500/20 text-green-400 border-green-500/30',
  cancelled: 'bg-gray-500/20 text-gray-400 border-gray-500/30',
  failed: 'bg-red-500/20 text-red-400 border-red-500/30',
}

const STATUS_LABELS: Record<string, string> = {
  running: 'executando',
  waiting_input: 'aguardando',
  done: 'concluído',
  cancelled: 'cancelado',
  failed: 'falhou',
}

interface Props {
  stages: DeliveryFlowStage[]
}

export function PipelineLiveRuns({ stages }: Props) {
  const [runs, setRuns] = useState<CardRun[]>([])
  const [expandedId, setExpandedId] = useState<number | null>(null)
  const [messages, setMessages] = useState<Record<number, CardMessage[]>>({})
  const [cancelling, setCancelling] = useState<number | null>(null)
  const [reprocessing, setReprocessing] = useState<number | null>(null)
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)

  const fetchRuns = useCallback(async () => {
    try {
      const [runsRes, statusRes] = await Promise.all([
        fetch('/api/pipeline/engine/runs?limit=30').then((r) => r.json()).catch(() => ({ runs: [] })),
        fetch('/api/pipeline/engine/status').then((r) => r.json()).catch(() => ({ counts: {} })),
      ])
      setRuns(runsRes.runs || [])
      setCounts(statusRes.counts || {})
    } catch { /* ignore */ }
    finally { setLoading(false) }
  }, [])

  useEffect(() => {
    void fetchRuns()
    const interval = setInterval(() => void fetchRuns(), 15_000)
    return () => clearInterval(interval)
  }, [fetchRuns])

  const fetchMessages = useCallback(async (runId: number) => {
    if (messages[runId]) return
    const data = await fetch(`/api/pipeline/engine/runs?id=${runId}&messages=1`).then((r) => r.json()).catch(() => ({ messages: [] }))
    setMessages((prev) => ({ ...prev, [runId]: data.messages || [] }))
  }, [messages])

  const cancelRun = async (runId: number) => {
    setCancelling(runId)
    try {
      await fetch('/api/pipeline/engine/runs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'cancel', run_id: runId }),
      })
      void fetchRuns()
    } finally {
      setCancelling(null)
    }
  }

  const reprocessRun = async (runId: number) => {
    setReprocessing(runId)
    try {
      await fetch('/api/pipeline/engine/runs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reprocess', run_id: runId }),
      })
      void fetchRuns()
    } finally {
      setReprocessing(null)
    }
  }

  const handleExpand = (runId: number) => {
    if (expandedId === runId) {
      setExpandedId(null)
    } else {
      setExpandedId(runId)
      void fetchMessages(runId)
    }
  }

  const stageLabel = (stageId: string) => stages.find((s) => s.id === stageId)?.label ?? stageId

  const activeRuns = runs.filter((r) => r.status === 'running' || r.status === 'waiting_input')
  const totalActive = activeRuns.length

  if (loading) {
    return (
      <div className="rounded-lg border border-border bg-card p-3 text-xs text-muted-foreground animate-pulse">
        Carregando esteira...
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-border bg-card p-3 space-y-3">
      {/* Header row */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-foreground">Esteira ao vivo</span>
          {totalActive > 0 && (
            <span className="px-1.5 py-0.5 text-2xs rounded-full bg-amber-500/20 text-amber-400 animate-pulse font-medium">
              {totalActive} ativo{totalActive !== 1 ? 's' : ''}
            </span>
          )}
        </div>
        <Button variant="ghost" size="xs" onClick={() => void fetchRuns()} className="text-muted-foreground">
          atualizar
        </Button>
      </div>

      {/* Count chips */}
      {Object.keys(counts).length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {Object.entries(counts).map(([status, count]) => (
            <span key={status} className={`text-2xs px-2 py-0.5 rounded-full border ${STATUS_STYLES[status] ?? 'bg-secondary text-muted-foreground border-border'}`}>
              {STATUS_LABELS[status] ?? status}: {count}
            </span>
          ))}
        </div>
      )}

      {runs.length === 0 ? (
        <div className="text-xs text-muted-foreground py-2 text-center">
          Nenhum card em execução. Configure um gatilho no Fluxo de entrega — o próximo ciclo vai capturar os cards automaticamente.
        </div>
      ) : (
        <div className="space-y-1.5 max-h-72 overflow-y-auto">
          {runs.map((run) => {
            const isActive = run.status === 'running' || run.status === 'waiting_input'
            const isExpanded = expandedId === run.id
            const statusStyle = STATUS_STYLES[run.status] ?? 'bg-secondary text-muted-foreground border-border'
            const msgs = messages[run.id] ?? []

            return (
              <div key={run.id} className={`rounded-md border ${isActive ? 'border-amber-500/20 bg-amber-500/5' : 'border-border bg-secondary/20'} transition-colors`}>
                {/* Summary row */}
                <button
                  onClick={() => handleExpand(run.id)}
                  className="w-full flex items-start gap-2 p-2 text-left hover:bg-white/5 rounded-md"
                >
                  {isActive && (
                    <span className="mt-1 w-2 h-2 rounded-full bg-amber-500 animate-pulse shrink-0" />
                  )}
                  <div className="flex-1 min-w-0 space-y-0.5">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-mono font-semibold text-foreground">{run.card_key}</span>
                      <span className={`text-2xs px-1.5 py-0.5 rounded border ${statusStyle}`}>
                        {STATUS_LABELS[run.status] ?? run.status}
                      </span>
                    </div>
                    <p className="text-2xs text-muted-foreground truncate">{run.card_title}</p>
                    <div className="flex items-center gap-2 flex-wrap">
                      <StageProgressBar stages={stages} currentStageId={run.current_stage_id} />
                    </div>
                  </div>
                  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" className={`w-3 h-3 shrink-0 mt-1 text-muted-foreground transition-transform ${isExpanded ? 'rotate-180' : ''}`}>
                    <path d="M4 6l4 4 4-4" strokeLinecap="round" />
                  </svg>
                </button>

                {/* Expanded: message log + actions */}
                {isExpanded && (
                  <div className="px-3 pb-3 border-t border-border/40 pt-2 space-y-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-2xs text-muted-foreground">Estágio atual: <strong className="text-foreground">{stageLabel(run.current_stage_id)}</strong></span>
                      {run.card_url && (
                        <a href={run.card_url} target="_blank" rel="noopener noreferrer" className="text-2xs text-primary underline underline-offset-2">
                          abrir card
                        </a>
                      )}
                    </div>

                    {/* Message log */}
                    {msgs.length > 0 && (
                      <div className="space-y-1 max-h-48 overflow-y-auto rounded-md bg-secondary/40 p-2">
                        {msgs.map((m, i) => (
                          <div key={i} className={`text-2xs rounded px-2 py-1 ${m.direction === 'agent_to_card' ? 'bg-primary/10 text-foreground' : 'bg-amber-500/10 text-amber-300'}`}>
                            <span className="font-medium mr-1">{m.direction === 'agent_to_card' ? '🤖 agente' : '👤 usuário'}:</span>
                            <span className="whitespace-pre-wrap">{m.body.slice(0, 400)}{m.body.length > 400 ? '…' : ''}</span>
                          </div>
                        ))}
                      </div>
                    )}

                    {msgs.length === 0 && (
                      <p className="text-2xs text-muted-foreground italic">Sem mensagens ainda — o agente ainda não iniciou o diálogo neste card.</p>
                    )}

                    {/* Actions */}
                    {isActive && (
                      <div className="flex gap-1 pt-1 flex-wrap">
                        <Button
                          variant="ghost"
                          size="xs"
                          className="h-6 text-2xs bg-amber-500/10 text-amber-400 hover:bg-amber-500/20 border border-amber-500/20"
                          disabled={reprocessing === run.id || cancelling === run.id}
                          onClick={() => void reprocessRun(run.id)}
                        >
                          {reprocessing === run.id ? '...' : 'Reprocessar'}
                        </Button>
                        <Button
                          variant="destructive"
                          size="xs"
                          className="h-6 text-2xs bg-red-500/15 text-red-400 hover:bg-red-500/30 border-red-500/20"
                          disabled={cancelling === run.id || reprocessing === run.id}
                          onClick={() => void cancelRun(run.id)}
                        >
                          {cancelling === run.id ? '...' : 'Cancelar'}
                        </Button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function StageProgressBar({ stages, currentStageId }: { stages: DeliveryFlowStage[]; currentStageId: string }) {
  if (stages.length === 0) return null
  const currentIdx = stages.findIndex((s) => s.id === currentStageId)

  return (
    <div className="flex items-center gap-0.5">
      {stages.map((stage, i) => {
        const isDone = i < currentIdx
        const isCurrent = i === currentIdx
        return (
          <div key={stage.id} className="flex items-center gap-0.5">
            <div
              title={stage.label}
              className={`h-1.5 rounded-full transition-all ${
                isDone ? 'bg-green-500 w-4' :
                isCurrent ? 'bg-amber-500 animate-pulse w-4' :
                'bg-muted w-2.5'
              }`}
            />
            {i < stages.length - 1 && (
              <div className={`w-1.5 h-px ${isDone ? 'bg-green-500/50' : 'bg-muted'}`} />
            )}
          </div>
        )
      })}
      {currentIdx >= 0 && (
        <span className="text-2xs text-muted-foreground ml-1">
          {stages[currentIdx]?.label}
        </span>
      )}
    </div>
  )
}
