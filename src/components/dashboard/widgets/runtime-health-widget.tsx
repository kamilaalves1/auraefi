'use client'

import { HealthRow, formatUptime, type DashboardData } from '../widget-primitives'

export function RuntimeHealthWidget({ data }: { data: DashboardData }) {
  const { localOsStatus, claudeHealth, codexHealth, mcHealth, memPct, systemStats } = data

  return (
    <div className="panel">
      <div className="panel-header"><h3 className="text-sm font-semibold">Saúde dos Runtimes Locais</h3></div>
      <div className="panel-body space-y-3">
        <HealthRow label="SO Local" value={localOsStatus.value} status={localOsStatus.status} />
        <HealthRow label="Runtime Claude" value={claudeHealth.value} status={claudeHealth.status} />
        <HealthRow label="Runtime Codex" value={codexHealth.value} status={codexHealth.status} />
        <HealthRow label="MC Core" value={mcHealth.value} status={mcHealth.status} />
        {memPct != null && <HealthRow label="Memória" value={`${memPct}%`} status={memPct > 90 ? 'bad' : memPct > 70 ? 'warn' : 'good'} bar={memPct} />}
        {systemStats?.disk && <HealthRow label="Disco" value={systemStats.disk.usage || 'N/A'} status={parseInt(systemStats.disk.usage) > 90 ? 'bad' : 'good'} />}
        {systemStats?.uptime != null && <HealthRow label="Uptime" value={formatUptime(systemStats.uptime)} status="good" />}
      </div>
    </div>
  )
}
