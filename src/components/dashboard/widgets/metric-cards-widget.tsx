'use client'

import {
  MetricCard,
  SessionIcon,
  GatewayIcon,
  AgentIcon,
  TaskIcon,
  ActivityIconMini,
  TokenIcon,
  CostIcon,
  formatTokensShort,
  type DashboardData,
} from '../widget-primitives'

export function MetricCardsWidget({ data }: { data: DashboardData }) {
  const {
    isLocal,
    isClaudeLoading,
    isSystemLoading,
    claudeActive,
    claudeStats,
    claudeLocalSessions,
    systemLoad,
    memPct,
    diskPct,
    connection,
    activeSessions,
    sessions,
    onlineAgents,
    dbStats,
    agents,
    backlogCount,
    runningTasks,
    errorCount,
    subscriptionLabel,
    subscriptionPrice,
  } = data

  if (isLocal) {
    return (
      <section className="grid grid-cols-2 xl:grid-cols-6 gap-3">
        <MetricCard
          label="Claude"
          value={isClaudeLoading ? '...' : claudeActive}
          total={isClaudeLoading ? undefined : (claudeStats?.total_sessions ?? claudeLocalSessions.length)}
          subtitle="sessões ativas"
          icon={<SessionIcon />}
          color="blue"
        />
        <MetricCard
          label="Carga do Sistema"
          value={isSystemLoading ? '...' : `${systemLoad}%`}
          subtitle={`mem ${memPct ?? '-'} · disco ${Number.isFinite(diskPct) ? `${diskPct}%` : '-'}`}
          icon={<ActivityIconMini />}
          color={systemLoad > 85 ? 'red' : 'purple'}
        />
        <MetricCard
          label="Tokens"
          value={isClaudeLoading ? '...' : formatTokensShort((claudeStats?.total_input_tokens ?? 0) + (claudeStats?.total_output_tokens ?? 0))}
          subtitle={isClaudeLoading ? undefined : `${formatTokensShort(claudeStats?.total_input_tokens ?? 0)} in · ${formatTokensShort(claudeStats?.total_output_tokens ?? 0)} out`}
          icon={<TokenIcon />}
          color="purple"
        />
        <MetricCard
          label="Custo"
          value={isClaudeLoading ? '...' : (subscriptionLabel ? (subscriptionPrice ? `$${subscriptionPrice}/mês` : 'Incluso') : `$${(claudeStats?.total_estimated_cost ?? 0).toFixed(2)}`)}
          subtitle={subscriptionLabel ? `plano ${subscriptionLabel}` : 'estimado'}
          icon={<CostIcon />}
          color={errorCount > 0 ? 'red' : 'green'}
        />
      </section>
    )
  }

  return (
    <section className="grid grid-cols-2 xl:grid-cols-5 gap-3">
      <MetricCard label="Gateway" value={connection.isConnected ? 'Online' : 'Offline'} subtitle="status do transporte" icon={<GatewayIcon />} color={connection.isConnected ? 'green' : 'red'} />
      <MetricCard label="Sessões" value={activeSessions} total={sessions.length} subtitle="ativas / total" icon={<SessionIcon />} color="blue" />
      <MetricCard label="Capacidade de Agentes" value={onlineAgents} subtitle={`${dbStats?.agents.total ?? agents.length} total`} icon={<AgentIcon />} color="green" />
      <MetricCard label="Fila" value={backlogCount} subtitle={`${runningTasks} em execução`} icon={<TaskIcon />} color={backlogCount > 12 ? 'red' : 'purple'} />
      <MetricCard label="Carga do Sistema" value={isSystemLoading ? '...' : `${systemLoad}%`} subtitle={`erros ${errorCount}`} icon={<ActivityIconMini />} color={systemLoad > 85 || errorCount > 0 ? 'red' : 'blue'} />
    </section>
  )
}
