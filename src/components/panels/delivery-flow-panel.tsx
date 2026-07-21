'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import type {
  DeliveryFlow,
  DeliveryFlowDefinition,
  DeliveryFlowStage,
  GitProvider,
  GitRepository,
} from '@/lib/delivery-flow-types'
import { defaultDeliveryFlowDefinition, DELIVERY_FLOW_VERSION } from '@/lib/delivery-flow-types'
import { buildLinearTransitions, createDefaultDeliveryFlowDefinition } from '@/lib/default-delivery-flow'
import { useWorkspaceSquadActive } from '@/lib/use-workspace-squad-active'
import { DeliveryFlowVisualCanvas, type DeliveryFlowCanvasLabels, type AgentBadge } from '@/components/panels/delivery-flow-canvas'
import { PipelineLiveRuns } from '@/components/panels/pipeline-live-runs'

// ─── helpers ────────────────────────────────────────────────────────────────

const DEFAULT_STAGE_IDS = ['df_backlog', 'df_ready', 'df_indev', 'df_review', 'df_done'] as const
const DEFAULT_STAGE_KEYS = ['backlog', 'ready', 'indev', 'review', 'done'] as const
const HANDOFF_BY_ID: Record<(typeof DEFAULT_STAGE_IDS)[number], 'push' | 'pull'> = {
  df_backlog: 'pull', df_ready: 'pull', df_indev: 'push', df_review: 'pull', df_done: 'push',
}

function buildDefaultDefinitionFromLocale(t: (key: string) => string): DeliveryFlowDefinition {
  return createDefaultDeliveryFlowDefinition({
    flowName: t('defaultFlowName'),
    flowDescription: t('defaultFlowDescription'),
    triggerStageId: 'df_ready',
    stages: DEFAULT_STAGE_KEYS.map((key, i) => ({
      id: DEFAULT_STAGE_IDS[i],
      label: t(`defaultStg_${key}_label`),
      jiraStatus: t(`defaultStg_${key}_jira`),
      actorRole: t(`defaultStg_${key}_role`),
      handoff: HANDOFF_BY_ID[DEFAULT_STAGE_IDS[i]],
    })),
  })
}

function newStage(i: number): DeliveryFlowStage {
  return { id: `stage-${Date.now()}-${i}`, label: `Estágio ${i + 1}`, actorRole: '', handoff: 'push' }
}

function linkedIdsForStage(s: DeliveryFlowStage): number[] {
  const raw = s.linkedAgentIds?.filter((n) => typeof n === 'number' && Number.isFinite(n) && n > 0) ?? []
  if (raw.length) return [...new Set(raw)].sort((a, b) => a - b)
  if (s.linkedAgentId != null && s.linkedAgentId > 0) return [s.linkedAgentId]
  return []
}

const AVATAR_COLORS = [
  'bg-violet-500', 'bg-indigo-500', 'bg-sky-500', 'bg-teal-500',
  'bg-emerald-500', 'bg-amber-500', 'bg-rose-500', 'bg-pink-500',
]
function agentInitials(name: string) {
  return name.split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('')
}

// ─── StatusBanner ────────────────────────────────────────────────────────────

function StatusBanner({
  squadActive,
  hasStages,
  hasTrigger,
  hasAgents,
  onSetupSquad,
  onApplyDefault,
}: {
  squadActive: boolean
  hasStages: boolean
  hasTrigger: boolean
  hasAgents: boolean
  onSetupSquad: () => void
  onApplyDefault: () => void
}) {
  if (!squadActive) {
    return (
      <div className="rounded-2xl border border-amber-500/30 bg-gradient-to-r from-amber-500/10 to-amber-500/5 p-4 flex items-start gap-3">
        <span className="text-2xl mt-0.5">⚡</span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-foreground">Time de agentes necessário</p>
          <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
            Configure seu squad primeiro para habilitar o fluxo de entrega e o pipeline de agentes.
          </p>
        </div>
        <Button size="sm" onClick={onSetupSquad} className="shrink-0">
          Configurar time
        </Button>
      </div>
    )
  }

  if (!hasStages) {
    return (
      <div className="rounded-2xl border border-primary/30 bg-gradient-to-r from-primary/10 to-primary/5 p-4 flex items-start gap-3">
        <span className="text-2xl mt-0.5">🚀</span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-foreground">Time pronto — configure seu fluxo</p>
          <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
            Crie as etapas do seu processo (como colunas do JIRA) e vincule agentes a cada uma.
          </p>
        </div>
        <Button size="sm" onClick={onApplyDefault} className="shrink-0">
          Usar fluxo padrão
        </Button>
      </div>
    )
  }

  const issues: string[] = []
  if (!hasTrigger) issues.push('Defina o estágio gatilho (⚡) para iniciar o pipeline automaticamente')
  if (!hasAgents) issues.push('Vincule pelo menos um agente a um estágio')

  if (issues.length > 0) {
    return (
      <div className="rounded-2xl border border-amber-500/20 bg-gradient-to-r from-amber-500/8 to-transparent p-3 flex items-start gap-3">
        <span className="text-lg mt-0.5">⚠️</span>
        <div className="flex-1 space-y-0.5">
          {issues.map((issue, i) => (
            <p key={i} className="text-xs text-muted-foreground">{issue}</p>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="rounded-2xl border border-green-500/30 bg-gradient-to-r from-green-500/10 to-transparent p-3 flex items-center gap-3">
      <span className="text-lg">✅</span>
      <p className="text-sm font-medium text-green-400">Pipeline configurado — polling ativo a cada 30s</p>
      <span className="ml-auto text-[10px] text-muted-foreground/60 font-mono">general.pipeline_engine</span>
    </div>
  )
}

// ─── StageEditorPanel ─────────────────────────────────────────────────────────

function StageEditorPanel({
  stage,
  index,
  totalStages,
  agents,
  isTrigger,
  onUpdate,
  onRemove,
  onMove,
  onSetTrigger,
  onClose,
}: {
  stage: DeliveryFlowStage
  index: number
  totalStages: number
  agents: AgentBadge[]
  isTrigger: boolean
  onUpdate: (patch: Partial<DeliveryFlowStage>) => void
  onRemove: () => void
  onMove: (dir: -1 | 1) => void
  onSetTrigger: () => void
  onClose: () => void
}) {
  const linkedIds = linkedIdsForStage(stage)

  const toggleAgent = (agentId: number, checked: boolean) => {
    const cur = linkedIds
    const next = checked ? [...cur, agentId] : cur.filter((id) => id !== agentId)
    const sorted = [...new Set(next)].filter((id) => id > 0).sort((a, b) => a - b)
    const primary = sorted[0]
    const agent = primary != null ? agents.find((a) => a.id === primary) : undefined
    onUpdate({
      linkedAgentIds: sorted.length ? sorted : undefined,
      linkedAgentId: primary,
      actorRole: agent ? agent.role : stage.actorRole,
    })
  }

  return (
    <div className="flex flex-col h-full bg-card border-l border-border/60 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border/60 shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold uppercase tracking-widest text-muted-foreground font-mono">
            Estágio {index + 1}
          </span>
          {isTrigger && (
            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-400">
              ⚡ Gatilho
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => onMove(-1)}
            disabled={index === 0}
            className="w-6 h-6 rounded flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-secondary disabled:opacity-30 disabled:cursor-not-allowed"
            title="Mover para esquerda"
          >
            ←
          </button>
          <button
            type="button"
            onClick={() => onMove(1)}
            disabled={index === totalStages - 1}
            className="w-6 h-6 rounded flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-secondary disabled:opacity-30 disabled:cursor-not-allowed"
            title="Mover para direita"
          >
            →
          </button>
          <button
            type="button"
            onClick={onClose}
            className="w-6 h-6 rounded flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-secondary ml-1"
          >
            ✕
          </button>
        </div>
      </div>

      {/* Scrollable body */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">

        {/* Stage name */}
        <div>
          <label className="text-xs font-semibold text-foreground block mb-1.5">Nome do estágio</label>
          <input
            value={stage.label}
            onChange={(e) => onUpdate({ label: e.target.value })}
            className="w-full h-9 px-3 rounded-lg bg-secondary border border-border text-sm focus:border-primary focus:ring-1 focus:ring-primary/30 outline-none transition"
            placeholder="Ex: Desenvolvimento, Code Review..."
          />
        </div>

        {/* JIRA / Azure column */}
        <div>
          <label className="text-xs font-semibold text-foreground block mb-1">
            Coluna JIRA / Azure
          </label>
          <p className="text-[11px] text-muted-foreground mb-1.5">Nome exato da coluna no seu board</p>
          <input
            value={stage.jiraStatus || ''}
            onChange={(e) => onUpdate({ jiraStatus: e.target.value || undefined })}
            className="w-full h-9 px-3 rounded-lg bg-secondary border border-border text-sm font-mono focus:border-primary focus:ring-1 focus:ring-primary/30 outline-none transition"
            placeholder="Ex: In Progress, To Do, Ready for Dev..."
          />
          {stage.jiraStatus && (
            <div className="mt-1.5 flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
              <span className="text-[11px] text-green-400">Mapeado para "{stage.jiraStatus}"</span>
            </div>
          )}
        </div>

        {/* Trigger toggle */}
        <div className="flex items-center justify-between p-3 rounded-xl border border-border/60 bg-secondary/40">
          <div>
            <p className="text-xs font-semibold text-foreground">⚡ Estágio gatilho</p>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              O pipeline inicia quando um card entra aqui
            </p>
          </div>
          <button
            type="button"
            onClick={onSetTrigger}
            className={`relative w-10 h-5 rounded-full transition-colors ${isTrigger ? 'bg-amber-500' : 'bg-secondary border border-border'}`}
          >
            <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${isTrigger ? 'translate-x-5' : 'translate-x-0.5'}`} />
          </button>
        </div>

        {/* Handoff mode */}
        <div>
          <label className="text-xs font-semibold text-foreground block mb-2">Modo de handoff</label>
          <div className="grid grid-cols-2 gap-2">
            {(['push', 'pull'] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => onUpdate({ handoff: mode })}
                className={`p-2.5 rounded-xl border text-left transition-all ${
                  stage.handoff === mode
                    ? mode === 'push'
                      ? 'border-amber-500/50 bg-amber-500/10 text-amber-400'
                      : 'border-sky-500/50 bg-sky-500/10 text-sky-400'
                    : 'border-border bg-secondary/30 text-muted-foreground hover:border-border/80'
                }`}
              >
                <p className="text-[11px] font-bold uppercase tracking-wide">
                  {mode === 'push' ? '→ Push' : '← Pull'}
                </p>
                <p className="text-[10px] mt-0.5 opacity-70">
                  {mode === 'push' ? 'Empurra para o próximo' : 'Próximo puxa quando pronto'}
                </p>
              </button>
            ))}
          </div>
        </div>

        {/* Agents */}
        <div>
          <label className="text-xs font-semibold text-foreground block mb-2">
            Agentes responsáveis
          </label>
          {agents.length === 0 ? (
            <p className="text-xs text-muted-foreground italic">Nenhum agente cadastrado.</p>
          ) : (
            <div className="space-y-1">
              {agents.map((a) => {
                const checked = linkedIds.includes(a.id)
                return (
                  <label
                    key={a.id}
                    className={`flex items-center gap-2.5 p-2 rounded-lg cursor-pointer border transition-all ${
                      checked
                        ? 'border-primary/40 bg-primary/8'
                        : 'border-transparent hover:border-border hover:bg-secondary/40'
                    }`}
                  >
                    <div className={`w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold text-white shrink-0 ${AVATAR_COLORS[a.id % AVATAR_COLORS.length]}`}>
                      {agentInitials(a.name)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-foreground truncate">{a.name}</p>
                      <p className="text-[10px] text-muted-foreground truncate">{a.role}</p>
                    </div>
                    <input
                      type="checkbox"
                      className="rounded border-border shrink-0 accent-primary"
                      checked={checked}
                      onChange={(e) => toggleAgent(a.id, e.target.checked)}
                    />
                  </label>
                )
              })}
            </div>
          )}
        </div>

        {/* Agent instructions */}
        <div>
          <label className="text-xs font-semibold text-foreground block mb-1">
            Instruções para o agente
          </label>
          <p className="text-[11px] text-muted-foreground mb-1.5">
            O que o agente deve fazer neste estágio
          </p>
          <textarea
            value={stage.agentInstructions || ''}
            onChange={(e) => onUpdate({ agentInstructions: e.target.value || undefined })}
            rows={4}
            className="w-full px-3 py-2 rounded-lg bg-secondary border border-border text-sm resize-y focus:border-primary focus:ring-1 focus:ring-primary/30 outline-none transition min-h-[88px]"
            placeholder="Ex: Analise os requisitos do card e crie um plano técnico detalhado..."
          />
        </div>

        {/* Notes */}
        <div>
          <label className="text-xs font-semibold text-foreground block mb-1">Notas</label>
          <input
            value={stage.notes || ''}
            onChange={(e) => onUpdate({ notes: e.target.value || undefined })}
            className="w-full h-9 px-3 rounded-lg bg-secondary border border-border text-sm focus:border-primary focus:ring-1 focus:ring-primary/30 outline-none transition"
            placeholder="Anotações internas sobre este estágio..."
          />
        </div>

        {/* Danger zone */}
        <div className="pt-2 border-t border-border/40">
          <button
            type="button"
            onClick={onRemove}
            className="w-full py-2 rounded-lg border border-red-500/20 text-red-400 text-xs font-medium hover:bg-red-500/10 transition"
          >
            Remover este estágio
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Git provider badge ───────────────────────────────────────────────────────

const GIT_PROVIDERS: { id: GitProvider; label: string; icon: string; color: string }[] = [
  { id: 'github',    label: 'GitHub',    icon: '🐙', color: 'bg-zinc-500/15 text-zinc-300 border-zinc-500/30' },
  { id: 'gitlab',    label: 'GitLab',    icon: '🦊', color: 'bg-orange-500/15 text-orange-400 border-orange-500/30' },
  { id: 'bitbucket', label: 'Bitbucket', icon: '🪣', color: 'bg-blue-500/15 text-blue-400 border-blue-500/30' },
]

function GitBadge({ provider }: { provider: GitProvider | null | undefined }) {
  const p = GIT_PROVIDERS.find(g => g.id === provider)
  if (!p) return <span className="text-[10px] text-muted-foreground/40 italic">sem repo</span>
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full border ${p.color}`}>
      {p.icon} {p.label}
    </span>
  )
}

// ─── Flow list sidebar ────────────────────────────────────────────────────────

function FlowListItem({
  flow, selected, onClick,
}: { flow: DeliveryFlow; selected: boolean; onClick: () => void }) {
  const stageCount = flow.definition.stages.length
  const hasTrigger = !!flow.definition.triggerStageId
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full text-left px-3 py-2.5 rounded-xl border transition-all group ${
        selected
          ? 'border-primary/40 bg-primary/8 shadow-sm'
          : 'border-border/40 hover:border-border/70 hover:bg-muted/30'
      }`}
    >
      <div className="flex items-start justify-between gap-1 mb-1">
        <p className={`text-xs font-semibold leading-tight truncate flex-1 ${selected ? 'text-primary' : 'text-foreground'}`}>
          {flow.name}
        </p>
        {selected && <span className="text-primary text-[10px]">●</span>}
      </div>
      <div className="flex items-center gap-1.5 flex-wrap">
        <GitBadge provider={flow.git_repository?.provider} />
        {stageCount > 0 && (
          <span className="text-[9px] text-muted-foreground/50">{stageCount} etapa{stageCount !== 1 ? 's' : ''}</span>
        )}
        {hasTrigger && <span className="text-[9px] text-amber-400">⚡</span>}
      </div>
    </button>
  )
}

// ─── Repo picker section ─────────────────────────────────────────────────────

function RepoPickerSection({
  repositories,
  selectedId,
  onChange,
}: {
  repositories: GitRepository[]
  selectedId: number | null
  onChange: (id: number | null) => void
}) {
  const selected = repositories.find(r => r.id === selectedId) ?? null
  const [open, setOpen] = useState(false)

  return (
    <div className="rounded-xl border border-border/50 bg-muted/20 p-3 space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/50">Repositório Git</p>
        <span className="text-[10px] text-muted-foreground/40">Configure repos em &ldquo;Repositórios Git&rdquo;</span>
      </div>

      {repositories.length === 0 ? (
        <p className="text-xs text-muted-foreground/50 italic">
          Nenhum repositório cadastrado. Acesse &ldquo;Repositórios Git&rdquo; para adicionar.
        </p>
      ) : (
        <div className="relative">
          <button
            type="button"
            onClick={() => setOpen(v => !v)}
            className="w-full flex items-center gap-2 h-9 px-3 rounded-lg bg-background border border-border/60 text-xs text-left hover:border-primary/50 focus:outline-none focus:border-primary/50 transition-colors"
          >
            {selected ? (
              <>
                <GitBadge provider={selected.provider} />
                <span className="flex-1 font-medium text-foreground truncate">{selected.name}</span>
                <span className="text-muted-foreground/50 font-mono shrink-0">{selected.branch}</span>
              </>
            ) : (
              <span className="flex-1 text-muted-foreground/50 italic">Nenhum repositório selecionado</span>
            )}
            <span className="text-muted-foreground/40 ml-1">▾</span>
          </button>

          {open && (
            <div className="absolute z-10 top-full mt-1 w-full rounded-lg border border-border bg-card shadow-lg overflow-hidden">
              {/* None option */}
              <button
                type="button"
                onClick={() => { onChange(null); setOpen(false) }}
                className={`w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-secondary/50 transition-colors ${!selected ? 'bg-primary/5 text-primary' : 'text-muted-foreground'}`}
              >
                <span className="italic">Nenhum</span>
              </button>
              {repositories.map(repo => (
                <button
                  key={repo.id}
                  type="button"
                  onClick={() => { onChange(repo.id); setOpen(false) }}
                  className={`w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-secondary/50 transition-colors ${selectedId === repo.id ? 'bg-primary/5' : ''}`}
                >
                  <GitBadge provider={repo.provider} />
                  <span className={`flex-1 font-medium truncate ${selectedId === repo.id ? 'text-primary' : 'text-foreground'}`}>{repo.name}</span>
                  <span className="text-muted-foreground/50 font-mono shrink-0 text-[10px]">{repo.branch}</span>
                  {!repo.is_active && <span className="text-[9px] text-muted-foreground/40 italic">inativo</span>}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {selected && (
        <p className="text-[10px] text-muted-foreground/40 font-mono truncate">{selected.repo_url}</p>
      )}
    </div>
  )
}

// ─── Main panel ───────────────────────────────────────────────────────────────

export function DeliveryFlowPanel() {
  const t = useTranslations('deliveryFlow')
  const canvasLabels = useMemo<DeliveryFlowCanvasLabels>(
    () => ({
      flowNodeBadge: (n: number) => t('flowNodeBadge', { n }),
      noJiraColumn: t('noJiraColumn'),
      handoffPushShort: t('handoffPushShort'),
      handoffPullShort: t('handoffPullShort'),
      arrowOutgoingPush: t('arrowOutgoingPush'),
      arrowOutgoingPull: t('arrowOutgoingPull'),
      triggerBadge: t('triggerBadge'),
    }),
    [t],
  )

  const { squadActive, squadActiveLoading } = useWorkspaceSquadActive()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Flow list
  const [flows, setFlows] = useState<DeliveryFlow[]>([])
  const [selectedFlowId, setSelectedFlowId] = useState<number | null>(null)

  // Git repositories registry
  const [repositories, setRepositories] = useState<GitRepository[]>([])

  // Current flow editor state
  const [def, setDef] = useState<DeliveryFlowDefinition>(() => defaultDeliveryFlowDefinition())
  const [flowName, setFlowName] = useState('')
  const [gitRepositoryId, setGitRepositoryId] = useState<number | null>(null)
  const [selectedStageIndex, setSelectedStageIndex] = useState<number | null>(null)
  const [agents, setAgents] = useState<AgentBadge[]>([])

  const defaultDef = useMemo(() => buildDefaultDefinitionFromLocale(t), [t])

  const patchStages = useCallback((updater: (prev: DeliveryFlowStage[]) => DeliveryFlowStage[]) => {
    setDef((d) => {
      const nextStages = updater(d.stages)
      return { ...d, stages: nextStages, transitions: buildLinearTransitions(nextStages) }
    })
  }, [])

  const applyDefaultFlow = useCallback(() => {
    setDef((d) => ({ ...defaultDef, parameterDefinitions: d.parameterDefinitions ?? [] }))
    const readyIdx = defaultDef.stages.findIndex((s) => s.id === defaultDef.triggerStageId)
    setSelectedStageIndex(readyIdx >= 0 ? readyIdx : 0)
  }, [defaultDef])

  // Load flow list + agents + repositories
  const loadFlows = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [flowsRes, agentRes, reposRes] = await Promise.all([
        fetch('/api/workspace/delivery-flows'),
        fetch('/api/agents').then((r) => r.json()).catch(() => ({ agents: [] })),
        fetch('/api/workspace/git-repositories').then((r) => r.json()).catch(() => ({ repositories: [] })),
      ])
      const flowsData = await flowsRes.json()
      const alist = (agentRes.agents || []) as Array<{ id: number; name: string; role: string }>
      setAgents(alist.map((a) => ({ id: a.id, name: a.name, role: a.role || '' })))
      setRepositories((reposRes.repositories || []) as GitRepository[])
      if (!flowsRes.ok) throw new Error(flowsData.error || 'load failed')

      const list: DeliveryFlow[] = flowsData.flows || []
      setFlows(list)

      // Select first flow by default
      if (list.length > 0) {
        const first = list[0]
        setSelectedFlowId(first.id)
        loadFlowIntoEditor(first)
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Error')
    } finally {
      setLoading(false)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  function loadFlowIntoEditor(flow: DeliveryFlow) {
    setFlowName(flow.name)
    setGitRepositoryId(flow.git_repository_id ?? null)
    const stages: DeliveryFlowStage[] = (flow.definition.stages || []).map((s) => {
      const ids = linkedIdsForStage(s)
      return { ...s, linkedAgentId: ids[0], linkedAgentIds: ids.length ? ids : undefined, actorRole: s.actorRole ?? '' }
    })
    let trigger = flow.definition.triggerStageId
    if (trigger && !stages.some((s) => s.id === trigger)) trigger = undefined
    setDef({ ...flow.definition, parameterDefinitions: flow.definition.parameterDefinitions ?? [], triggerStageId: trigger, stages, transitions: buildLinearTransitions(stages) })
    setSelectedStageIndex(stages.length > 0 ? 0 : null)
  }

  const selectFlow = (flow: DeliveryFlow) => {
    setSelectedFlowId(flow.id)
    loadFlowIntoEditor(flow)
    setSelectedStageIndex(null)
    setError(null)
  }

  useEffect(() => { void loadFlows() }, [loadFlows])

  const save = async () => {
    if (!selectedFlowId) return
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/workspace/delivery-flows/${selectedFlowId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: flowName,
          git_repository_id: gitRepositoryId,
          definition: { ...def, version: DELIVERY_FLOW_VERSION, transitions: buildLinearTransitions(def.stages) },
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'save failed')
      // Update local list
      setFlows(prev => prev.map(f => f.id === selectedFlowId ? data.flow : f))
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Error')
    } finally {
      setSaving(false)
    }
  }

  const createFlow = async () => {
    try {
      const res = await fetch('/api/workspace/delivery-flows', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Novo fluxo' }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'create failed')
      const newFlow: DeliveryFlow = data.flow
      setFlows(prev => [...prev, newFlow])
      setSelectedFlowId(newFlow.id)
      loadFlowIntoEditor(newFlow)
      setSelectedStageIndex(null)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Error')
    }
  }

  const deleteFlow = async (id: number) => {
    try {
      const res = await fetch(`/api/workspace/delivery-flows/${id}`, { method: 'DELETE' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'delete failed')
      const remaining = flows.filter(f => f.id !== id)
      setFlows(remaining)
      if (selectedFlowId === id) {
        if (remaining.length > 0) {
          setSelectedFlowId(remaining[0].id)
          loadFlowIntoEditor(remaining[0])
        } else {
          setSelectedFlowId(null)
        }
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Error')
    }
  }

  const updateStage = (index: number, patch: Partial<DeliveryFlowStage>) => {
    patchStages((arr) => arr.map((s, i) => (i === index ? { ...s, ...patch } : s)))
  }

  const removeStage = (index: number) => {
    const removedId = def.stages[index]?.id
    setSelectedStageIndex((cur) => {
      if (cur === null) return null
      if (cur === index) return Math.min(index, def.stages.length - 2)
      return cur > index ? cur - 1 : cur
    })
    setDef((d) => {
      const nextStages = d.stages.filter((_, i) => i !== index)
      let trigger = d.triggerStageId
      if (removedId && trigger === removedId) trigger = undefined
      return { ...d, stages: nextStages, transitions: buildLinearTransitions(nextStages), triggerStageId: trigger }
    })
  }

  const moveStage = (index: number, dir: -1 | 1) => {
    const tIdx = index + dir
    if (tIdx < 0 || tIdx >= def.stages.length) return
    patchStages((arr) => {
      const copy = [...arr]
      ;[copy[index], copy[tIdx]] = [copy[tIdx], copy[index]]
      return copy
    })
    setSelectedStageIndex((cur) => {
      if (cur === index) return tIdx
      if (cur === tIdx) return index
      return cur
    })
  }

  const addStage = () => {
    const newIndex = def.stages.length
    patchStages((arr) => [...arr, newStage(arr.length)])
    setSelectedStageIndex(newIndex)
  }

  const setTrigger = useCallback((stageId: string) => {
    setDef((d) => ({
      ...d,
      triggerStageId: d.triggerStageId === stageId ? undefined : stageId,
    }))
  }, [])

  const reorderStage = useCallback((fromId: string, toIndex: number) => {
    setDef((d) => {
      const fromIndex = d.stages.findIndex((s) => s.id === fromId)
      if (fromIndex < 0 || fromIndex === toIndex) return d
      const copy = [...d.stages]
      const [moved] = copy.splice(fromIndex, 1)
      copy.splice(toIndex, 0, moved)
      return { ...d, stages: copy, transitions: buildLinearTransitions(copy) }
    })
    setSelectedStageIndex((cur) => {
      if (cur === null) return null
      const fromIndex = def.stages.findIndex((s) => s.id === fromId)
      if (cur === fromIndex) return toIndex
      return cur
    })
  }, [def.stages])

  useEffect(() => {
    if (selectedStageIndex != null && selectedStageIndex >= def.stages.length) {
      setSelectedStageIndex(def.stages.length > 0 ? def.stages.length - 1 : null)
    }
  }, [def.stages.length, selectedStageIndex])

  const hasAgentsLinked = def.stages.some((s) => linkedIdsForStage(s).length > 0)

  if (squadActiveLoading || loading) {
    return (
      <div className="flex items-center justify-center p-12">
        <div className="flex flex-col items-center gap-3 text-muted-foreground">
          <div className="w-8 h-8 rounded-full border-2 border-primary/30 border-t-primary animate-spin" />
          <span className="text-sm">Carregando fluxos...</span>
        </div>
      </div>
    )
  }

  const selectedStage = selectedStageIndex != null ? def.stages[selectedStageIndex] : null

  return (
    <div className="flex h-full min-h-0">

      {/* ── Left sidebar: flow list ─────────────────────────────── */}
      <div className="w-52 shrink-0 border-r border-border/50 flex flex-col bg-background/50">
        <div className="p-3 border-b border-border/40 flex items-center justify-between">
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Fluxos</span>
          <button
            type="button"
            onClick={() => void createFlow()}
            title="Novo fluxo"
            className="w-6 h-6 rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors text-sm"
          >
            +
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
          {flows.length === 0 ? (
            <p className="text-[11px] text-muted-foreground/40 italic px-1 pt-2">Nenhum fluxo. Clique + para criar.</p>
          ) : (
            flows.map(flow => (
              <div key={flow.id} className="group relative">
                <FlowListItem
                  flow={flow}
                  selected={selectedFlowId === flow.id}
                  onClick={() => selectFlow(flow)}
                />
                {flows.length > 1 && (
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); void deleteFlow(flow.id) }}
                    className="absolute top-1.5 right-1.5 w-5 h-5 rounded flex items-center justify-center text-muted-foreground/30 hover:text-red-400 hover:bg-red-500/10 opacity-0 group-hover:opacity-100 transition-all text-xs"
                    title="Remover fluxo"
                  >
                    ✕
                  </button>
                )}
              </div>
            ))
          )}
        </div>
      </div>

      {/* ── Right: editor ───────────────────────────────────────── */}
      {selectedFlowId == null ? (
        <div className="flex-1 flex items-center justify-center text-muted-foreground/40 text-sm">
          Selecione ou crie um fluxo
        </div>
      ) : (
        <div className="flex flex-col flex-1 min-w-0 min-h-0">
          <div className="flex-1 overflow-y-auto">
            <div className="p-4 max-w-[1200px] mx-auto space-y-4">

              {/* Header row */}
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  <input
                    value={flowName}
                    onChange={(e) => setFlowName(e.target.value)}
                    className="h-8 px-3 rounded-lg bg-secondary border border-border text-sm font-semibold w-52 focus:border-primary outline-none transition"
                    placeholder="Nome do fluxo..."
                  />
                  <Button type="button" size="sm" variant="outline" onClick={() => void loadFlows()}>↺</Button>
                </div>
              </div>

              {/* Repo picker */}
              <RepoPickerSection
                repositories={repositories}
                selectedId={gitRepositoryId}
                onChange={setGitRepositoryId}
              />

              {/* Status banner */}
              <StatusBanner
                squadActive={squadActive !== false}
                hasStages={def.stages.length > 0}
                hasTrigger={!!def.triggerStageId}
                hasAgents={hasAgentsLinked}
                onSetupSquad={() => {}}
                onApplyDefault={applyDefaultFlow}
              />

              {error && (
                <div className="text-sm text-red-400 border border-red-500/30 rounded-xl p-3 bg-red-500/5">{error}</div>
              )}

              <PipelineLiveRuns stages={def.stages} />

              {/* Canvas + side editor */}
              <div className={`flex gap-4 min-h-0 ${selectedStage ? 'items-start' : ''}`}>
                <div className="flex-1 min-w-0 space-y-3">
                  {def.stages.length === 0 ? (
                    <div className="rounded-2xl border-2 border-dashed border-border p-12 text-center space-y-4">
                      <div className="text-4xl">🗂️</div>
                      <div>
                        <p className="text-sm font-medium text-foreground">Nenhum estágio configurado</p>
                        <p className="text-xs text-muted-foreground mt-1">Comece com o fluxo padrão ou adicione estágios manualmente</p>
                      </div>
                      <div className="flex justify-center gap-2">
                        <Button onClick={applyDefaultFlow}>Usar fluxo padrão</Button>
                        <Button variant="outline" onClick={addStage}>+ Adicionar estágio</Button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <DeliveryFlowVisualCanvas
                        stages={def.stages}
                        triggerStageId={def.triggerStageId}
                        selectedIndex={selectedStageIndex}
                        onSelectIndex={setSelectedStageIndex}
                        onSetTrigger={setTrigger}
                        onReorder={reorderStage}
                        labels={canvasLabels}
                        agents={agents}
                      />
                      <div className="flex items-center justify-between gap-2 flex-wrap px-1">
                        <p className="text-[11px] text-muted-foreground">Clique em um estágio para editar · ⚡ para definir o gatilho · Arraste para reordenar</p>
                        <Button type="button" size="sm" variant="outline" onClick={addStage}>+ Estágio</Button>
                      </div>
                    </>
                  )}
                  {def.stages.length > 0 && (
                    <div className="flex flex-wrap gap-2 pt-1">
                      {def.stages.map((s, i) => {
                        const hasJira = !!s.jiraStatus?.trim()
                        const hasAgent = linkedIdsForStage(s).length > 0
                        const isTrigger = def.triggerStageId === s.id
                        return (
                          <button key={s.id} type="button" onClick={() => setSelectedStageIndex(i)}
                            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs transition-all ${selectedStageIndex === i ? 'border-primary bg-primary/10 text-primary' : 'border-border/50 bg-secondary/30 text-muted-foreground hover:border-border hover:text-foreground'}`}>
                            {isTrigger && <span className="text-amber-400">⚡</span>}
                            <span className="font-medium">{s.label}</span>
                            <span className={`w-1.5 h-1.5 rounded-full ${hasJira ? 'bg-green-500' : 'bg-muted-foreground/30'}`} />
                            <span className={`w-1.5 h-1.5 rounded-full ${hasAgent ? 'bg-primary' : 'bg-muted-foreground/30'}`} />
                          </button>
                        )
                      })}
                    </div>
                  )}
                </div>
                {selectedStage != null && selectedStageIndex != null && (
                  <div className="w-80 shrink-0 rounded-2xl border border-border/60 overflow-hidden self-stretch" style={{ minHeight: 400 }}>
                    <StageEditorPanel
                      stage={selectedStage}
                      index={selectedStageIndex}
                      totalStages={def.stages.length}
                      agents={agents}
                      isTrigger={def.triggerStageId === selectedStage.id}
                      onUpdate={(patch) => updateStage(selectedStageIndex, patch)}
                      onRemove={() => removeStage(selectedStageIndex)}
                      onMove={(dir) => moveStage(selectedStageIndex, dir)}
                      onSetTrigger={() => setTrigger(selectedStage.id)}
                      onClose={() => setSelectedStageIndex(null)}
                    />
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Sticky save bar */}
          <div className="shrink-0 border-t border-border/60 bg-card/90 backdrop-blur-sm px-4 py-3 flex items-center justify-between gap-4">
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              <span>{def.stages.length} estágio{def.stages.length !== 1 ? 's' : ''}</span>
              {def.triggerStageId && (
                <><span className="text-border">·</span><span className="text-amber-400">⚡ {def.stages.find(s => s.id === def.triggerStageId)?.label}</span></>
              )}
              {gitRepositoryId && (() => {
                const repo = repositories.find(r => r.id === gitRepositoryId)
                return repo ? (
                  <><span className="text-border">·</span><GitBadge provider={repo.provider} /><span className="text-muted-foreground/50 truncate max-w-[120px]">{repo.name}</span></>
                ) : null
              })()}
            </div>
            <Button type="button" onClick={() => void save()} disabled={saving || !flowName.trim()} className="min-w-[100px]">
              {saving ? '...' : 'Salvar fluxo'}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
