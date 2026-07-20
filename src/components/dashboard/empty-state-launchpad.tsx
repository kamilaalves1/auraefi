'use client'

import type { ReactNode } from 'react'
import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'

interface RuntimeStatus {
  id: string
  name: string
  installed: boolean
}

interface Props {
  agentCount: number
  onNavigate: (panel: string) => void
}

export function EmptyStateLaunchpad({ agentCount, onNavigate }: Props) {
  const [runtimes, setRuntimes] = useState<RuntimeStatus[]>([])
  const [loaded, setLoaded] = useState(false)
  const [backlogReady, setBacklogReady] = useState(false)

  useEffect(() => {
    fetch('/api/work-pipeline')
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { enabled?: boolean; provider?: string } | null) => {
        if (d?.enabled && d.provider && d.provider !== 'none') setBacklogReady(true)
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    fetch('/api/agent-runtimes')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.runtimes) {
          setRuntimes(d.runtimes)
          return
        }
        return fetch('/api/status?action=capabilities')
          .then((r) => (r.ok ? r.json() : {}))
          .then((caps: Record<string, unknown>) => {
            const detected: RuntimeStatus[] = []
            if (caps.openclawHome) detected.push({ id: 'openclaw', name: 'OpenClaw', installed: true })
            if (caps.claudeHome) detected.push({ id: 'claude', name: 'Claude Code', installed: true })
            setRuntimes(detected)
          })
      })
      .catch(() => {})
      .finally(() => setLoaded(true))
  }, [])

  const installed = runtimes.filter((r) => r.installed)
  const hasRuntimes = installed.length > 0
  const hasAgents = agentCount > 0

  if (hasRuntimes && hasAgents && backlogReady) return null
  if (!loaded) return null

  const completedCount = (hasRuntimes ? 1 : 0) + (hasAgents ? 1 : 0) + (backlogReady ? 1 : 0)

  return (
    <div className="rounded-xl border border-border bg-card p-6">
      <div className="text-center mb-6">
        <h2 className="text-lg font-semibold text-foreground mb-1">Sequência de Lançamento</h2>
        <p className="text-sm text-muted-foreground">
          Conclua cada etapa para colocar sua estação online. Acompanhe itens de trabalho no JIRA ou Azure Boards — conecte-os aqui via Esteira de trabalho.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <StepCard
          step={1}
          title="Runtimes de Agentes"
          done={hasRuntimes}
          active={!hasRuntimes}
          doneContent={
            <div className="space-y-1">
              {installed.map((r) => (
                <div key={r.id} className="flex items-center gap-1.5 text-xs text-emerald-400/80">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />
                  {r.name}
                </div>
              ))}
              <p className="text-2xs text-muted-foreground/50 mt-1">Instalado e pronto</p>
            </div>
          }
          pendingContent={
            <>
              <p className="text-xs text-muted-foreground mb-3">
                Instale um runtime para executar agentes nesta máquina.
              </p>
              <Button
                size="sm"
                className="text-xs w-full bg-void-amber/20 text-void-amber border border-void-amber/30 hover:bg-void-amber/30"
                onClick={() => onNavigate('settings')}
              >
                Instalar Runtimes
              </Button>
            </>
          }
        />

        <StepCard
          step={2}
          title="Registrar um Agente"
          done={hasAgents}
          active={hasRuntimes && !hasAgents}
          doneContent={
            <>
              <p className="text-xs text-emerald-400/80 mb-1">Agente registrado</p>
              <button
                type="button"
                className="text-2xs text-muted-foreground hover:text-foreground"
                onClick={() => onNavigate('agents')}
              >
                Ver frota →
              </button>
            </>
          }
          pendingContent={
            <>
              <p className="text-xs text-muted-foreground mb-3">
                Registre seu primeiro agente. Escolha um template e configure suas capacidades.
              </p>
              <Button
                size="sm"
                className="text-xs w-full bg-void-amber/20 text-void-amber border border-void-amber/30 hover:bg-void-amber/30"
                disabled={!hasRuntimes}
                onClick={() => onNavigate('agents')}
              >
                Criar Agente
              </Button>
            </>
          }
        />

        <StepCard
          step={3}
          title="JIRA / Azure (Esteira de trabalho)"
          done={backlogReady}
          active={hasAgents && !backlogReady}
          doneContent={
            <>
              <p className="text-xs text-emerald-400/80 mb-1">Fonte de backlog configurada</p>
              <button
                type="button"
                className="text-2xs text-muted-foreground hover:text-foreground"
                onClick={() => onNavigate('work-pipeline')}
              >
                Abrir esteira →
              </button>
            </>
          }
          pendingContent={
            <>
              <p className="text-xs text-muted-foreground mb-3">
                Conecte o JIRA ou Azure DevOps para importar issues. Os boards do dia a dia ficam na sua ferramenta externa.
              </p>
              <Button
                size="sm"
                className="text-xs w-full bg-void-purple/20 text-void-purple border border-void-purple/30 hover:bg-void-purple/30"
                disabled={!hasAgents}
                onClick={() => onNavigate('work-pipeline')}
              >
                Configurar esteira de trabalho
              </Button>
            </>
          }
        />
      </div>

      <div className="mt-5 flex items-center gap-3">
        <div className="flex-1 h-1.5 rounded-full bg-border/20 overflow-hidden relative">
          {completedCount < 3 && (
            <div className="absolute inset-0 bg-gradient-to-r from-void-amber/10 to-void-purple/10 animate-pulse" />
          )}
          <div
            className="h-full rounded-full relative overflow-hidden transition-all duration-1000 ease-out"
            style={{
              width: `${(completedCount / 3) * 100}%`,
              background:
                completedCount === 3
                  ? 'linear-gradient(90deg, rgb(16 185 129) 0%, rgb(52 211 153) 100%)'
                  : 'linear-gradient(90deg, var(--void-amber) 0%, var(--void-purple) 100%)',
            }}
          >
            <div className="absolute inset-0 shimmer-bar" />
          </div>
        </div>
        <span
          className={`text-2xs tabular-nums font-mono transition-colors duration-500 ${
            completedCount === 3 ? 'text-emerald-400' : 'text-muted-foreground/60'
          }`}
        >
          {completedCount}/3
        </span>
      </div>
    </div>
  )
}

function StepCard({
  step,
  title,
  done,
  active,
  doneContent,
  pendingContent,
}: {
  step: number
  title: string
  done: boolean
  active: boolean
  doneContent: ReactNode
  pendingContent: ReactNode
}) {
  return (
    <div
      className={`rounded-lg border p-4 transition-all ${
        done
          ? 'border-emerald-500/30 bg-emerald-500/5'
          : active
            ? 'border-void-amber/40 bg-void-amber/5 ring-1 ring-void-amber/20'
            : 'border-border bg-secondary/20'
      }`}
    >
      <div className="flex items-center gap-2 mb-3">
        <span
          className={`flex items-center justify-center w-7 h-7 rounded-full text-xs font-bold ${
            done ? 'bg-emerald-500/20 text-emerald-400' : active ? 'bg-void-amber/20 text-void-amber' : 'bg-muted text-muted-foreground'
          }`}
        >
          {step}
        </span>
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      </div>
      {done ? doneContent : pendingContent}
    </div>
  )
}
