'use client'

import { memo, useCallback, useEffect, useMemo } from 'react'
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  Position,
  useReactFlow,
  ReactFlowProvider,
  type Edge,
  type Node,
  type NodeProps,
  type NodeTypes,
  type NodeChange,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import type { DeliveryFlowStage } from '@/lib/delivery-flow-types'

const NODE_W = 220
const NODE_H = 130
const COL_GAP = 60

const STAGE_ACCENTS = ['#6366f1', '#8b5cf6', '#a855f7', '#d946ef', '#ec4899', '#14b8a6', '#0ea5e9', '#22c55e']

export type DeliveryFlowCanvasLabels = {
  flowNodeBadge: (n: number) => string
  noJiraColumn: string
  handoffPushShort: string
  handoffPullShort: string
  arrowOutgoingPush: string
  arrowOutgoingPull: string
  triggerBadge: string
}

export interface AgentBadge {
  id: number
  name: string
  role: string
}

export type DeliveryStageNodeData = {
  index: number
  label: string
  jiraStatus?: string
  handoff: 'push' | 'pull'
  actorRole: string
  selected: boolean
  isTrigger: boolean
  agents: AgentBadge[]
  labels: DeliveryFlowCanvasLabels
  onSetTrigger: (stageId: string) => void
  stageId: string
}

function agentInitials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('')
}

const AVATAR_COLORS = [
  'bg-violet-500', 'bg-indigo-500', 'bg-sky-500', 'bg-teal-500',
  'bg-emerald-500', 'bg-amber-500', 'bg-rose-500', 'bg-pink-500',
]

function AgentAvatar({ agent, index }: { agent: AgentBadge; index: number }) {
  return (
    <div
      title={`${agent.name} — ${agent.role}`}
      className={`w-6 h-6 rounded-full flex items-center justify-center text-[9px] font-bold text-white shrink-0 ring-2 ring-card ${AVATAR_COLORS[agent.id % AVATAR_COLORS.length]}`}
      style={{ marginLeft: index > 0 ? '-6px' : 0 }}
    >
      {agentInitials(agent.name)}
    </div>
  )
}

function DeliveryStageNodeInner({ data, id }: NodeProps) {
  const d = data as DeliveryStageNodeData
  const accent = STAGE_ACCENTS[d.index % STAGE_ACCENTS.length]

  const handleTriggerClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      d.onSetTrigger(d.stageId)
    },
    [d],
  )

  return (
    <div
      className={`relative rounded-xl border bg-card text-left shadow-lg transition-all duration-200 overflow-hidden select-none ${
        d.selected
          ? 'ring-2 ring-primary ring-offset-2 ring-offset-background border-primary/60 scale-[1.02]'
          : 'border-border/80 hover:border-primary/40 hover:shadow-xl'
      }`}
      style={{
        width: NODE_W,
        minHeight: NODE_H,
        boxShadow: d.selected ? `0 0 0 1px ${accent}44, 0 16px 48px -12px rgba(0,0,0,.5)` : undefined,
      }}
    >
      <Handle type="target" position={Position.Left} className="!w-2.5 !h-2.5 !border-2 !border-background !bg-muted-foreground/60" />
      <Handle type="source" position={Position.Right} className="!w-2.5 !h-2.5 !border-2 !border-background !bg-muted-foreground/60" />

      {/* Accent bar */}
      <div className="absolute left-0 top-0 bottom-0 w-1.5 rounded-l-xl" style={{ background: `linear-gradient(180deg, ${accent}, ${accent}66)` }} />

      <div className="pl-3.5 pr-2.5 pt-2.5 pb-2.5 space-y-2">
        {/* Top row: step badge + trigger toggle + handoff */}
        <div className="flex items-center justify-between gap-1">
          <span
            className="text-[10px] font-bold uppercase tracking-widest font-mono"
            style={{ color: accent }}
          >
            {d.labels.flowNodeBadge(d.index + 1)}
          </span>
          <div className="flex items-center gap-1 shrink-0">
            {/* Trigger toggle — click to set/unset */}
            <button
              type="button"
              title={d.isTrigger ? 'Gatilho ativo — clique para remover' : 'Clique para definir como gatilho'}
              onClick={handleTriggerClick}
              className={`text-[13px] leading-none px-1 py-0.5 rounded transition-all ${
                d.isTrigger
                  ? 'text-amber-400 drop-shadow-[0_0_6px_rgba(251,191,36,0.8)]'
                  : 'text-muted-foreground/30 hover:text-amber-400/60'
              }`}
            >
              ⚡
            </button>
            <span
              className={`text-[9px] font-semibold uppercase px-1.5 py-0.5 rounded-full ${
                d.handoff === 'push'
                  ? 'bg-amber-500/15 text-amber-500 dark:text-amber-300'
                  : 'bg-sky-500/15 text-sky-600 dark:text-sky-300'
              }`}
            >
              {d.handoff === 'push' ? d.labels.handoffPushShort : d.labels.handoffPullShort}
            </span>
          </div>
        </div>

        {/* Stage name */}
        <div className="text-sm font-bold text-foreground leading-snug line-clamp-2 pr-1">
          {d.label}
        </div>

        {/* JIRA column pill */}
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-muted-foreground/50 font-mono">JIRA</span>
          {d.jiraStatus?.trim() ? (
            <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20 truncate max-w-[130px]">
              {d.jiraStatus}
            </span>
          ) : (
            <span className="text-[10px] text-muted-foreground/40 italic">{d.labels.noJiraColumn}</span>
          )}
        </div>

        {/* Agent avatars */}
        {d.agents.length > 0 && (
          <div className="flex items-center gap-0">
            {d.agents.slice(0, 5).map((a, i) => (
              <AgentAvatar key={a.id} agent={a} index={i} />
            ))}
            {d.agents.length > 5 && (
              <span className="ml-1 text-[10px] text-muted-foreground">+{d.agents.length - 5}</span>
            )}
          </div>
        )}
      </div>

      {/* Trigger glow overlay */}
      {d.isTrigger && (
        <div
          className="absolute inset-0 rounded-xl pointer-events-none"
          style={{ boxShadow: 'inset 0 0 0 2px rgba(251,191,36,0.35)', background: 'radial-gradient(ellipse at top right, rgba(251,191,36,0.05), transparent 70%)' }}
        />
      )}
    </div>
  )
}

const DeliveryStageNode = memo(DeliveryStageNodeInner)
const nodeTypes: NodeTypes = { deliveryStage: DeliveryStageNode }

function buildNodes(
  stages: DeliveryFlowStage[],
  selectedIndex: number | null,
  triggerStageId: string | undefined,
  labels: DeliveryFlowCanvasLabels,
  agentMap: Map<number, AgentBadge>,
  onSetTrigger: (stageId: string) => void,
): Node[] {
  return stages.map((s, i) => {
    const agentIds = s.linkedAgentIds ?? (s.linkedAgentId ? [s.linkedAgentId] : [])
    const agents = agentIds.map((id) => agentMap.get(id)).filter(Boolean) as AgentBadge[]
    return {
      id: s.id,
      type: 'deliveryStage',
      position: { x: i * (NODE_W + COL_GAP), y: 24 },
      data: {
        index: i,
        label: s.label,
        jiraStatus: s.jiraStatus,
        handoff: s.handoff,
        actorRole: s.actorRole,
        selected: selectedIndex === i,
        isTrigger: !!triggerStageId && triggerStageId === s.id,
        agents,
        labels,
        onSetTrigger,
        stageId: s.id,
      } satisfies DeliveryStageNodeData,
      draggable: true,
      selectable: true,
    }
  })
}

function buildEdges(stages: DeliveryFlowStage[], labels: DeliveryFlowCanvasLabels): Edge[] {
  const out: Edge[] = []
  for (let i = 0; i < stages.length - 1; i++) {
    const from = stages[i]
    const isPush = from.handoff === 'push'
    const stroke = isPush ? '#f59e0b88' : '#38bdf888'
    out.push({
      id: `e-${from.id}-${stages[i + 1].id}`,
      source: from.id,
      target: stages[i + 1].id,
      type: 'smoothstep',
      animated: true,
      style: { stroke, strokeWidth: 2 },
      label: isPush ? labels.arrowOutgoingPush : labels.arrowOutgoingPull,
      labelStyle: { fill: 'var(--muted-foreground)', fontWeight: 600, fontSize: 10 },
      labelBgPadding: [5, 3] as [number, number],
      labelBgBorderRadius: 5,
      labelBgStyle: { fill: 'var(--card)', fillOpacity: 0.92, stroke: 'var(--border)', strokeWidth: 1 },
    })
  }
  return out
}

function FitViewOnChange({ layoutKey }: { layoutKey: string }) {
  const { fitView } = useReactFlow()
  useEffect(() => {
    const id = window.setTimeout(() => {
      void fitView({ padding: 0.25, duration: 300, maxZoom: 1.0, minZoom: 0.3 })
    }, 50)
    return () => window.clearTimeout(id)
  }, [layoutKey, fitView])
  return null
}

function DeliveryFlowCanvasInner({
  stages,
  triggerStageId,
  selectedIndex,
  onSelectIndex,
  onSetTrigger,
  onReorder,
  labels,
  agents,
}: {
  stages: DeliveryFlowStage[]
  triggerStageId?: string
  selectedIndex: number | null
  onSelectIndex: (index: number) => void
  onSetTrigger: (stageId: string) => void
  onReorder: (fromId: string, toIndex: number) => void
  labels: DeliveryFlowCanvasLabels
  agents: AgentBadge[]
}) {
  const agentMap = useMemo(() => {
    const m = new Map<number, AgentBadge>()
    for (const a of agents) m.set(a.id, a)
    return m
  }, [agents])

  const nodes = useMemo(
    () => buildNodes(stages, selectedIndex, triggerStageId, labels, agentMap, onSetTrigger),
    [stages, selectedIndex, triggerStageId, labels, agentMap, onSetTrigger],
  )
  const edges = useMemo(() => buildEdges(stages, labels), [stages, labels])

  const onNodeClick = useCallback(
    (_: React.MouseEvent, node: Node) => {
      const idx = stages.findIndex((s) => s.id === node.id)
      if (idx >= 0) onSelectIndex(idx)
    },
    [stages, onSelectIndex],
  )

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      for (const change of changes) {
        if (change.type === 'position' && !change.dragging && change.position) {
          const draggedId = change.id
          const newX = change.position.x
          const sortedByX = [...stages]
            .map((s, i) => ({ id: s.id, x: i === stages.findIndex((st) => st.id === draggedId) ? newX : i * (NODE_W + COL_GAP) }))
            .sort((a, b) => a.x - b.x)
          const newIndex = sortedByX.findIndex((n) => n.id === draggedId)
          if (newIndex >= 0) onReorder(draggedId, newIndex)
        }
      }
    },
    [stages, onReorder],
  )

  return (
    <div className="h-[min(380px,48vh)] w-full min-h-[240px] rounded-2xl border border-border/60 overflow-hidden bg-gradient-to-br from-background via-muted/20 to-background shadow-inner">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.25, maxZoom: 1.0, minZoom: 0.3 }}
        nodesDraggable
        nodesConnectable={false}
        elementsSelectable
        panOnScroll
        zoomOnScroll
        zoomOnPinch
        minZoom={0.25}
        maxZoom={1.4}
        onNodeClick={onNodeClick}
        onNodesChange={onNodesChange}
        proOptions={{ hideAttribution: true }}
        defaultEdgeOptions={{ zIndex: 0 }}
      >
        <Background gap={24} size={1} variant={BackgroundVariant.Dots} className="!bg-transparent [&>pattern>circle]:fill-border/30" />
        <Controls showInteractive={false} className="!bg-card/90 !border-border/60 !shadow-md [&>button]:!border-border/60" />
        <FitViewOnChange layoutKey={stages.map((s) => s.id).join('|')} />
      </ReactFlow>
    </div>
  )
}

export function DeliveryFlowVisualCanvas(props: {
  stages: DeliveryFlowStage[]
  triggerStageId?: string
  selectedIndex: number | null
  onSelectIndex: (index: number) => void
  onSetTrigger: (stageId: string) => void
  onReorder: (fromId: string, toIndex: number) => void
  labels: DeliveryFlowCanvasLabels
  agents: AgentBadge[]
}) {
  if (props.stages.length === 0) return null
  return (
    <ReactFlowProvider>
      <DeliveryFlowCanvasInner {...props} />
    </ReactFlowProvider>
  )
}
