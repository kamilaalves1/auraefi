'use client'

import { StatRow, formatBytes, type DashboardData } from '../widget-primitives'

export function MaintenanceWidget({ data }: { data: DashboardData }) {
  const { dbStats } = data

  return (
    <div className="panel">
      <div className="panel-header"><h3 className="text-sm font-semibold">Manutenção + Backup</h3></div>
      <div className="panel-body space-y-3">
        {dbStats?.backup ? (
          <>
            <StatRow label="Último backup" value={dbStats.backup.age_hours < 1 ? '<1h atrás' : `${dbStats.backup.age_hours}h atrás`} alert={dbStats.backup.age_hours > 24} />
            <StatRow label="Tamanho do backup" value={formatBytes(dbStats.backup.size)} />
          </>
        ) : (
          <StatRow label="Último backup" value="Nenhum" alert />
        )}
        <StatRow label="Pipelines ativos" value={dbStats?.pipelines.active ?? 0} />
        <StatRow label="Execuções (24h)" value={dbStats?.pipelines.recentDay ?? 0} />
      </div>
    </div>
  )
}
