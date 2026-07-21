'use client'

import { memo, useEffect, useMemo } from 'react'
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  Handle,
  Position,
  useReactFlow,
  ReactFlowProvider,
  type Edge,
  type Node,
  type NodeProps,
  type NodeTypes,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'

export interface PipelineStepLite {
  template_id: number
  template_name?: string
  on_failure: 'stop' | 'continue'
}

const NODE_W = 176
const NODE_H = 96
const COL_GAP = 48

const PALETTE = ['#6366f1', '#0ea5e9', '#a855f7', '#22c55e', '#f97316', '#ec4899']

export type PipelineStepsCanvasLabels = {
  stepBadge: (n: number) => string
  stopOnFail: string
  continueOnFail: string
  edgeThen: string
}

type PipelineStepNodeData = {
  index: number
  title: string
  onFailure: 'stop' | 'continue'
  labels: PipelineStepsCanvasLabels
}

function PipelineStepNodeInner({ data }: NodeProps) {
  const d = data as PipelineStepNodeData
  const accent = PALETTE[d.index % PALETTE.length]
  const { labels: L } = d

  return (
    <div
      className="relative rounded-lg border border-border/90 bg-card text-left shadow-md overflow-hidden"
      style={{ width: NODE_W, minHeight: NODE_H }}
    >
      <Handle type="target" position={Position.Left} className="!w-2 !h-2 !bg-slate-500 !border-2 !border-background" />
      <Handle type="source" position={Position.Right} className="!w-2 !h-2 !bg-slate-500 !border-2 !border-background" />
      <div className="absolute inset-y-0 left-0 w-1" style={{ background: `linear-gradient(180deg, ${accent}, ${accent}99)` }} />
      <div className="pl-3 pr-2 py-2 space-y-1">
        <span className="text-[10px] font-mono font-bold text-muted-foreground uppercase">{L.stepBadge(d.index + 1)}</span>
        <div className="text-xs font-semibold text-foreground leading-tight line-clamp-2">{d.title}</div>
        <span
          className={`inline-block text-[9px] font-semibold px-1.5 py-0.5 rounded mt-0.5 ${
            d.onFailure === 'continue' ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400' : 'bg-slate-500/15 text-muted-foreground'
          }`}
        >
          {d.onFailure === 'continue' ? L.continueOnFail : L.stopOnFail}
        </span>
      </div>
    </div>
  )
}

const PipelineStepNode = memo(PipelineStepNodeInner)
const nodeTypes: NodeTypes = { pipelineStep: PipelineStepNode }

function buildNodes(steps: PipelineStepLite[], labels: PipelineStepsCanvasLabels): Node[] {
  return steps.map((s, i) => ({
    id: `pstep-${i}-${s.template_id}`,
    type: 'pipelineStep',
    position: { x: i * (NODE_W + COL_GAP), y: 20 },
    data: {
      index: i,
      title: s.template_name?.trim() || `Template #${s.template_id}`,
      onFailure: s.on_failure,
      labels,
    } satisfies PipelineStepNodeData,
    draggable: false,
  }))
}

function buildEdges(steps: PipelineStepLite[], labels: PipelineStepsCanvasLabels): Edge[] {
  const out: Edge[] = []
  for (let i = 0; i < steps.length - 1; i++) {
    out.push({
      id: `pe-${i}`,
      source: `pstep-${i}-${steps[i].template_id}`,
      target: `pstep-${i + 1}-${steps[i + 1].template_id}`,
      type: 'smoothstep',
      animated: true,
      style: { stroke: '#818cf8', strokeWidth: 2.5 },
      label: labels.edgeThen,
      labelStyle: { fill: 'var(--foreground)', fontWeight: 700, fontSize: 11 },
      labelBgPadding: [6, 4] as [number, number],
      labelBgBorderRadius: 6,
      labelBgStyle: { fill: 'var(--card)', fillOpacity: 0.95, stroke: 'var(--border)', strokeWidth: 1 },
    })
  }
  return out
}

function FitViewOnChange({ layoutKey }: { layoutKey: string }) {
  const { fitView } = useReactFlow()
  useEffect(() => {
    const id = window.setTimeout(() => {
      void fitView({ padding: 0.2, duration: 240, maxZoom: 1.1, minZoom: 0.35 })
    }, 40)
    return () => window.clearTimeout(id)
  }, [layoutKey, fitView])
  return null
}

function PipelineStepsCanvasInner({
  steps,
  labels,
  compact,
}: {
  steps: PipelineStepLite[]
  labels: PipelineStepsCanvasLabels
  compact?: boolean
}) {
  const nodes = useMemo(() => buildNodes(steps, labels), [steps, labels])
  const edges = useMemo(() => buildEdges(steps, labels), [steps, labels])
  const layoutKey = useMemo(() => steps.map((s) => `${s.template_id}-${s.on_failure}`).join('|'), [steps])

  return (
    <div
      className={`w-full rounded-xl border-2 border-border/80 overflow-hidden bg-gradient-to-b from-muted/40 to-background shadow-inner ${
        compact ? 'h-[min(200px,28vh)] min-h-[160px]' : 'h-[min(320px,40vh)] min-h-[200px]'
      }`}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.18, maxZoom: 1.1, minZoom: 0.35 }}
        nodesDraggable={false}
        nodesConnectable={false}
        panOnScroll
        zoomOnScroll
        zoomOnPinch
        minZoom={0.3}
        maxZoom={1.4}
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={20} size={1} variant={BackgroundVariant.Dots} className="!bg-transparent [&>pattern>circle]:fill-border/45" />
        <Controls showInteractive={false} className="!bg-card/95 !border-border !shadow-md" />
        <MiniMap className="!bg-card/95 !border-border !rounded-lg" nodeStrokeWidth={2} zoomable pannable maskColor="rgba(0,0,0,0.1)" />
        <FitViewOnChange layoutKey={layoutKey} />
      </ReactFlow>
    </div>
  )
}

export function PipelineStepsVisualCanvas({
  steps,
  labels,
  compact,
}: {
  steps: PipelineStepLite[]
  labels: PipelineStepsCanvasLabels
  compact?: boolean
}) {
  if (steps.length === 0) return null
  return (
    <ReactFlowProvider>
      <PipelineStepsCanvasInner steps={steps} labels={labels} compact={compact} />
    </ReactFlowProvider>
  )
}
