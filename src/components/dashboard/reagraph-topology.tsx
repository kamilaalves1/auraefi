'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  ReactFlow,
  Node,
  Edge,
  Handle,
  useNodesState,
  useEdgesState,
  Controls,
  Background,
  BackgroundVariant,
  Position,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'

/**
 * ReagraphTopology — Interactive System Topology
 *
 * Phase 118 v4: Rebuilt with React Flow for rich, glossy nodes
 * inspired by the OpenClaw Command Center design.
 *
 * Features:
 * - Custom HTML nodes with emoji icons inside glowing circles
 * - Central "Amy Bridge" hub node (largest)
 * - Click any node → detail panel slides open
 * - Animated edges showing data flow
 * - Dark grid background matching VCC aesthetic
 * - Health-colored glow borders (green/amber/red)
 */

type NodeStatus = 'healthy' | 'degraded' | 'offline' | 'loading'

interface TopologyNodeData {
  id: string
  label: string
  icon: string
  status: NodeStatus
  detail: string
  port?: string
  tier: 'core' | 'service' | 'module'
  description: string
}

// ╔════════════════════════════════════════════════════════════╗
// ║  🎨  COLOR PALETTE                                       ║
// ║                                                          ║
// ║  Change these to adjust the glow colors for each state.  ║
// ╚════════════════════════════════════════════════════════════╝
const STATUS_STYLES: Record<NodeStatus, { glow: string; border: string; text: string; bg: string }> = {
  healthy:  { glow: '0 0 20px rgba(52, 211, 153, 0.4)',  border: '#34d399', text: '#6ee7b7', bg: 'rgba(52, 211, 153, 0.08)' },
  degraded: { glow: '0 0 20px rgba(251, 191, 36, 0.4)',  border: '#fbbf24', text: '#fcd34d', bg: 'rgba(251, 191, 36, 0.08)' },
  offline:  { glow: '0 0 20px rgba(248, 113, 113, 0.4)', border: '#f87171', text: '#fca5a5', bg: 'rgba(248, 113, 113, 0.08)' },
  loading:  { glow: '0 0 10px rgba(113, 113, 122, 0.3)', border: '#52525b', text: '#71717a', bg: 'rgba(113, 113, 122, 0.05)' },
}

// ╔════════════════════════════════════════════════════════════╗
// ║  🎛️  NODE SIZE TUNING GUIDE                              ║
// ║                                                          ║
// ║  These numbers control the ICON CIRCLE size in pixels.   ║
// ║  Higher = bigger circle with bigger icon.                ║
// ║                                                          ║
// ║  Recommended range: 40 (small) → 80 (large)             ║
// ║                                                          ║
// ║  • core    = Most important (Bridge, Dashboard, Ollama)  ║
// ║  • service = Supporting services (Vault, Engines, Proxy) ║
// ║  • module  = Smaller modules (Scheduler, Telegram, etc)  ║
// ╚════════════════════════════════════════════════════════════╝
const TIER_ICON_SIZE: Record<string, number> = {
  core: 64,      // 🔴 Big glowing circles — main pillars
  service: 52,   // 🟡 Medium circles — key services
  module: 44,    // 🟢 Smaller circles — modules
}

const TIER_FONT_SIZE: Record<string, number> = {
  core: 28,      // Emoji size inside the circle
  service: 22,
  module: 18,
}

// ═══════════════════════════════════════════════════════════
//  🎯  CUSTOM NODE COMPONENT — The glossy circle with icon
// ═══════════════════════════════════════════════════════════

function TopologyNodeComponent({ data }: { data: any }) {
  const nodeData = data as TopologyNodeData & { onClick: (d: TopologyNodeData) => void }
  const styles = STATUS_STYLES[nodeData.status]
  const iconSize = TIER_ICON_SIZE[nodeData.tier] || 48
  const fontSize = TIER_FONT_SIZE[nodeData.tier] || 20
  const isCore = nodeData.tier === 'core'

  return (
    <div
      className="flex flex-col items-center gap-1.5 cursor-pointer group"
      onClick={() => nodeData.onClick?.(nodeData)}
    >
      {/* ── Connection handles (invisible but needed for edge lines) ── */}
      <Handle type="target" position={Position.Top} className="!bg-transparent !border-0 !w-0 !h-0" />
      <Handle type="source" position={Position.Bottom} className="!bg-transparent !border-0 !w-0 !h-0" />
      <Handle type="target" position={Position.Left} id="left" className="!bg-transparent !border-0 !w-0 !h-0" />
      <Handle type="source" position={Position.Right} id="right" className="!bg-transparent !border-0 !w-0 !h-0" />

      {/* Glowing icon circle */}
      <div
        className={`relative flex items-center justify-center rounded-full transition-all duration-300 group-hover:scale-110 ${
          nodeData.status === 'healthy' ? 'animate-pulse-slow' : ''
        }`}
        style={{
          width: iconSize,
          height: iconSize,
          background: `radial-gradient(circle at 35% 35%, ${styles.bg}, rgba(15, 10, 25, 0.9))`,
          border: `2px solid ${styles.border}`,
          boxShadow: styles.glow,
        }}
      >
        {/* Outer ring for core nodes */}
        {isCore && (
          <div
            className="absolute inset-[-4px] rounded-full animate-spin-slow"
            style={{
              border: `1px solid ${styles.border}40`,
              borderTopColor: styles.border,
            }}
          />
        )}
        <span style={{ fontSize }} className="select-none">{nodeData.icon}</span>
      </div>

      {/* Label */}
      <div className="flex flex-col items-center">
        <span className="text-[10px] font-semibold text-zinc-200 whitespace-nowrap">
          {nodeData.label}
        </span>
        <span className="text-[8px] font-mono whitespace-nowrap" style={{ color: styles.text }}>
          {nodeData.detail}
        </span>
      </div>
    </div>
  )
}

const nodeTypes = { topology: TopologyNodeComponent }

// ═══════════════════════════════════════════════════════════
//  📐  NODE POSITIONS — Hub-and-spoke radial layout
//
//  🌉 Bridge sits at the CENTER (the hub)
//  Core nodes form an inner ring around Bridge
//  Service/module nodes form an outer ring
//
//  x, y are pixel positions. Adjust to taste!
// ═══════════════════════════════════════════════════════════

const NODE_POSITIONS: Record<string, { x: number; y: number }> = {
  // ── CENTER HUB ──
  bridge:    { x: 260, y: 150 },   // 🌉 Amy Bridge — the heart of everything

  // ── INNER RING (Core) — directly connected to Bridge ──
  dashboard: { x: 260, y: 0 },     // 🖥️ Top — you are here!
  ollama:    { x: 60,  y: 90 },    // 🧠 Top-left — AI brain
  vault:     { x: 470, y: 90 },    // 🏛️ Top-right — knowledge store

  // ── OUTER RING (Services & Modules) — orbit around core ──
  proxy:     { x: 0,   y: 230 },   // 🔀 Left — routes to Ollama
  engines:   { x: 140, y: 300 },   // ⚙️ Bottom-left — 8 modules
  council:   { x: 310, y: 330 },   // 🏛️ Bottom-center — 4 advisors
  scheduler: { x: 470, y: 280 },   // ⏰ Bottom-right — 10 routines
  email:     { x: 530, y: 180 },   // 📧 Right — email watcher
  telegram:  { x: 30,  y: 330 },   // 📱 Far bottom-left — bot
}

// ═══════════════════════════════════════════════════════════
//  🔗  EDGES — Connections between nodes
//  Each edge shows data flowing from → to
// ═══════════════════════════════════════════════════════════

const EDGE_DEFS = [
  { from: 'dashboard', to: 'bridge',    label: 'REST API',     animated: true },
  { from: 'bridge',    to: 'ollama',    label: 'inference',    animated: true },
  { from: 'bridge',    to: 'vault',     label: 'knowledge',    animated: true },
  { from: 'bridge',    to: 'engines',   label: 'modules',      animated: false },
  { from: 'bridge',    to: 'scheduler', label: 'routines',     animated: false },
  { from: 'proxy',     to: 'ollama',    label: 'routing',      animated: true },
  { from: 'engines',   to: 'scheduler', label: 'triggers',     animated: false },
  { from: 'engines',   to: 'email',     label: 'drafts',       animated: false },
  { from: 'engines',   to: 'telegram',  label: 'commands',     animated: false },
  { from: 'engines',   to: 'council',   label: 'cases',        animated: false },
  { from: 'council',   to: 'ollama',    label: 'multi-model',  animated: true },
  { from: 'vault',     to: 'engines',   label: 'search',       animated: false },
]

// ═══════════════════════════════════════════════════════════
//  🚀  MAIN COMPONENT
// ═══════════════════════════════════════════════════════════

const INITIAL_NODES: TopologyNodeData[] = [
  { id: 'bridge',    label: 'Amy Bridge',      icon: '🌉', status: 'loading', detail: ':3100',         port: ':3100',  tier: 'core',    description: 'Central API gateway connecting all Amy services. All traffic flows through here.' },
  { id: 'dashboard', label: 'Dashboard',       icon: '🖥️', status: 'loading', detail: ':3000',         port: ':3000',  tier: 'core',    description: 'This Vertex Control Center dashboard — where you are right now!' },
  { id: 'ollama',    label: 'Ollama LLM',      icon: '🧠', status: 'loading', detail: ':11434',        port: ':11434', tier: 'core',    description: 'Local AI inference engine running 4 models: amy-local, qwen3, llama3.1, nomic-embed-text.' },
  { id: 'vault',     label: 'Sovereign Vault',  icon: '🏛️', status: 'loading', detail: '1.7M+ words',                 tier: 'service', description: 'Amy\'s knowledge store — 1.7M+ words of ingested documents, policies, and context.' },
  { id: 'engines',   label: 'Amy Engines',      icon: '⚙️', status: 'loading', detail: '8 modules',                   tier: 'service', description: '8 autonomous Python modules: intelligence, approval, council, tasks, notifications, scheduler, activity, config.' },
  { id: 'scheduler', label: 'Scheduler',        icon: '⏰', status: 'loading', detail: '10 routines',                  tier: 'module',  description: '10 recurring routines: 7 core (health, email, knowledge, anomaly, council, intelligence, route analysis) + 3 ClawBytes recipes (issue whisperer, task whisperer, inbox whisperer).' },
  { id: 'proxy',     label: 'Amy Proxy',        icon: '🔀', status: 'loading', detail: 'Neural routing',              tier: 'service', description: 'Smart routing layer that directs requests to the best model for each task.' },
  { id: 'telegram',  label: 'Telegram',         icon: '📱', status: 'loading', detail: 'Bot sessions',                tier: 'module',  description: 'Telegram bot integration — chat with Amy directly from Telegram.' },
  { id: 'email',     label: 'Email Lane',       icon: '📧', status: 'loading', detail: 'IMAP watcher',                tier: 'module',  description: 'IMAP email watcher that monitors inboxes and drafts intelligent replies.' },
  { id: 'council',   label: 'Council',          icon: '🏛️', status: 'loading', detail: '4 advisors',                  tier: 'module',  description: 'Multi-model council: 4 AI advisors debate decisions before recommending action.' },
]

export function ReagraphTopology() {
  const [topoNodes, setTopoNodes] = useState<TopologyNodeData[]>(INITIAL_NODES)
  const [selectedNode, setSelectedNode] = useState<TopologyNodeData | null>(null)
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([])
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([])

  // Handle node click → show detail panel
  const handleNodeClick = useCallback((nodeData: TopologyNodeData) => {
    setSelectedNode(prev => prev?.id === nodeData.id ? null : nodeData)
  }, [])

  // Fetch health data
  const refreshHealth = useCallback(async () => {
    try {
      const res = await fetch('/api/amy/health')
      if (!res.ok) throw new Error('health failed')
      const data = await res.json()

      const services = data.services || []
      const ollamaService = services.find((s: any) => s.name === 'Ollama')
      const bridgeHealth = services.find((s: any) => s.name === 'Bridge Health')

      setTopoNodes(prev => prev.map(node => {
        switch (node.id) {
          case 'dashboard':
            return { ...node, status: 'healthy' as NodeStatus, detail: `Score: ${data.score}%` }
          case 'bridge':
            return { ...node, status: (bridgeHealth?.status === 'healthy' ? 'healthy' : 'degraded') as NodeStatus, detail: bridgeHealth?.detail || ':3100' }
          case 'ollama':
            return { ...node, status: (ollamaService?.status === 'healthy' ? 'healthy' : ollamaService?.status === 'degraded' ? 'degraded' : 'offline') as NodeStatus, detail: ollamaService?.detail || ':11434' }
          case 'vault':     return { ...node, status: 'healthy' as NodeStatus, detail: '1.7M+ words' }
          case 'engines':   return { ...node, status: 'healthy' as NodeStatus, detail: '8 modules' }
          case 'scheduler': return { ...node, status: 'healthy' as NodeStatus, detail: '10 routines' }
          case 'proxy':     return { ...node, status: 'healthy' as NodeStatus, detail: 'Neural routing' }
          case 'telegram':  return { ...node, status: 'healthy' as NodeStatus, detail: '6 sessions' }
          case 'email':     return { ...node, status: 'healthy' as NodeStatus, detail: 'IMAP active' }
          case 'council':   return { ...node, status: 'healthy' as NodeStatus, detail: '4 advisors' }
          default: return node
        }
      }))
    } catch {
      setTopoNodes(prev => prev.map(n =>
        n.id === 'dashboard'
          ? { ...n, status: 'degraded' as NodeStatus, detail: 'Bridge offline' }
          : n
      ))
    }
  }, [])

  useEffect(() => {
    refreshHealth()
    const interval = setInterval(refreshHealth, 30000)
    return () => clearInterval(interval)
  }, [refreshHealth])

  // Build React Flow nodes from topology data
  useEffect(() => {
    const flowNodes: Node[] = topoNodes.map(node => ({
      id: node.id,
      type: 'topology',
      position: NODE_POSITIONS[node.id] || { x: 200, y: 200 },
      data: { ...node, onClick: handleNodeClick },
      style: { background: 'transparent', border: 'none' },
      sourcePosition: Position.Bottom,
      targetPosition: Position.Top,
    }))

    const flowEdges: Edge[] = EDGE_DEFS.map((e, i) => ({
      id: `e-${i}`,
      source: e.from,
      target: e.to,
      label: e.label,
      animated: e.animated,
      type: 'default',
      style: {
        stroke: e.animated ? 'rgba(139, 92, 246, 0.7)' : 'rgba(139, 92, 246, 0.35)',
        strokeWidth: e.animated ? 2.5 : 1.5,
      },
      labelStyle: {
        fill: 'rgba(200, 180, 255, 0.6)',
        fontSize: 8,
        fontFamily: 'ui-monospace, monospace',
      },
      labelBgStyle: {
        fill: 'rgba(12, 10, 20, 0.85)',
        fillOpacity: 0.85,
      },
      labelBgPadding: [4, 2] as [number, number],
    }))

    setNodes(flowNodes)
    setEdges(flowEdges)
  }, [topoNodes, handleNodeClick, setNodes, setEdges])

  const healthyCount = topoNodes.filter(n => n.status === 'healthy').length
  const totalCount = topoNodes.length

  return (
    <div className="relative w-full overflow-hidden rounded-lg" style={{ height: 380, background: '#0c0a14' }}>
      {/* Custom CSS for animations */}
      <style>{`
        @keyframes pulse-slow {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.85; }
        }
        @keyframes spin-slow {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        .animate-pulse-slow { animation: pulse-slow 3s ease-in-out infinite; }
        .animate-spin-slow { animation: spin-slow 8s linear infinite; }
        .react-flow__edge-text { pointer-events: none; }
      `}</style>

      {/* Node count badge — top-left */}
      <div className="absolute top-2.5 left-2.5 z-10 flex items-center gap-1.5">
        <span className={`text-[10px] font-mono px-2 py-0.5 rounded-full backdrop-blur-xl ${
          healthyCount === totalCount
            ? 'bg-emerald-500/10 text-emerald-300/80 border border-emerald-500/15'
            : 'bg-amber-500/10 text-amber-300/80 border border-amber-500/15'
        }`}>
          {healthyCount}/{totalCount} online
        </span>
      </div>

      {/* Refresh — top-right */}
      <div className="absolute top-2.5 right-2.5 z-10">
        <button
          onClick={refreshHealth}
          className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-white/3 text-zinc-500 border border-white/5 backdrop-blur-xl hover:text-violet-300 hover:border-violet-500/20 transition-all"
        >
          ↻ Refresh
        </button>
      </div>

      {/* React Flow Canvas */}
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.15 }}
        className="bg-transparent"
        proOptions={{ hideAttribution: true }}
        nodesDraggable={true}
        nodesConnectable={false}
        elementsSelectable={false}
        panOnDrag={true}
        zoomOnScroll={true}
        minZoom={0.5}
        maxZoom={2}
      >
        <Controls
          position="bottom-left"
          style={{
            background: 'rgba(12, 10, 20, 0.8)',
            border: '1px solid rgba(139, 92, 246, 0.15)',
            borderRadius: '8px',
            boxShadow: '0 4px 20px rgba(0,0,0,0.4)',
          }}
        />
        <Background
          variant={BackgroundVariant.Dots}
          gap={30}
          size={0.8}
          color="rgba(139, 92, 246, 0.08)"
        />
      </ReactFlow>

      {/* Selected node detail panel — slides in from right */}
      {selectedNode && (
        <div className="absolute top-2 right-12 z-20 w-56 animate-in slide-in-from-right">
          <div
            className="rounded-xl p-3 backdrop-blur-xl border"
            style={{
              background: 'rgba(12, 10, 20, 0.9)',
              borderColor: STATUS_STYLES[selectedNode.status].border + '40',
              boxShadow: STATUS_STYLES[selectedNode.status].glow,
            }}
          >
            {/* Header */}
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <span className="text-lg">{selectedNode.icon}</span>
                <span className="text-xs font-semibold text-zinc-200">{selectedNode.label}</span>
              </div>
              <button
                onClick={() => setSelectedNode(null)}
                className="text-zinc-500 hover:text-zinc-300 text-xs transition-colors"
              >
                ✕
              </button>
            </div>

            {/* Status badge */}
            <div className="flex items-center gap-2 mb-2">
              <span
                className="w-2 h-2 rounded-full"
                style={{ background: STATUS_STYLES[selectedNode.status].border }}
              />
              <span className="text-[10px] font-mono uppercase" style={{ color: STATUS_STYLES[selectedNode.status].text }}>
                {selectedNode.status}
              </span>
              {selectedNode.port && (
                <span className="text-[10px] font-mono text-zinc-500">{selectedNode.port}</span>
              )}
            </div>

            {/* Description */}
            <p className="text-[10px] text-zinc-400 leading-relaxed">
              {selectedNode.description}
            </p>

            {/* Detail */}
            <div className="mt-2 pt-2 border-t border-white/5">
              <span className="text-[9px] font-mono text-zinc-600">{selectedNode.detail}</span>
            </div>
          </div>
        </div>
      )}

      {/* Legend — bottom-right */}
      <div className="absolute bottom-2 right-2.5 z-10">
        <div className="flex items-center gap-2.5 px-2.5 py-1 rounded-full bg-black/30 backdrop-blur-xl border border-white/4">
          <span className="flex items-center gap-1 text-[8px] font-mono text-zinc-600">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />online
          </span>
          <span className="flex items-center gap-1 text-[8px] font-mono text-zinc-600">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />degraded
          </span>
          <span className="flex items-center gap-1 text-[8px] font-mono text-zinc-600">
            <span className="w-1.5 h-1.5 rounded-full bg-red-400" />offline
          </span>
        </div>
      </div>

      {/* Interaction hint */}
      <div className="absolute bottom-2 left-12 z-10">
        <span className="text-[8px] font-mono text-zinc-700/50 pointer-events-none select-none">
          click node for details · drag to move · scroll to zoom
        </span>
      </div>
    </div>
  )
}
