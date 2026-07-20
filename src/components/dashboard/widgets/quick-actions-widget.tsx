'use client'

import {
  QuickAction,
  SpawnActionIcon,
  LogActionIcon,
  MemoryActionIcon,
  SessionIcon,
  PipelineActionIcon,
  GatewayIcon,
  type DashboardData,
} from '../widget-primitives'

export function QuickActionsWidget({ data }: { data: DashboardData }) {
  const { isLocal, navigateToPanel } = data

  return (
    <section className="grid grid-cols-2 lg:grid-cols-5 gap-2">
      {!isLocal && <QuickAction label="Criar Agente" desc="Iniciar sub-agente" tab="spawn" icon={<SpawnActionIcon />} onNavigate={navigateToPanel} />}
      <QuickAction label="Esteira de trabalho" desc="Backlog JIRA / Azure" tab="work-pipeline" icon={<GatewayIcon />} onNavigate={navigateToPanel} />
      <QuickAction label="Ver Logs" desc="Visualizador em tempo real" tab="logs" icon={<LogActionIcon />} onNavigate={navigateToPanel} />
      <QuickAction label="Memória" desc="Conhecimento + recall" tab="memory" icon={<MemoryActionIcon />} onNavigate={navigateToPanel} />
      {isLocal
        ? <QuickAction label="Sessões" desc="Claude + Codex" tab="sessions" icon={<SessionIcon />} onNavigate={navigateToPanel} />
        : <QuickAction label="Orquestração" desc="Fluxos + pipelines" tab="agents" icon={<PipelineActionIcon />} onNavigate={navigateToPanel} />}
    </section>
  )
}
