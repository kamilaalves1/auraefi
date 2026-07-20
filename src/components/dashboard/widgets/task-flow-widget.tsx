'use client'

import { StatRow, type DashboardData } from '../widget-primitives'

export function TaskFlowWidget({ data }: { data: DashboardData }) {
  const { inboxCount, assignedCount, runningTasks, reviewCount, doneCount, backlogCount } = data

  return (
    <div className="panel">
      <div className="panel-header"><h3 className="text-sm font-semibold">Fluxo de Tarefas</h3></div>
      <div className="panel-body grid grid-cols-2 gap-3">
        <StatRow label="Entrada" value={inboxCount} />
        <StatRow label="Atribuídas" value={assignedCount} />
        <StatRow label="Em Andamento" value={runningTasks} />
        <StatRow label="Revisão" value={reviewCount} />
        <StatRow label="Concluídas" value={doneCount} />
        <StatRow label="Backlog" value={backlogCount} alert={backlogCount > 12} />
      </div>
    </div>
  )
}
