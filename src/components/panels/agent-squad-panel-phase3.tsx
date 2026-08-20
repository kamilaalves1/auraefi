'use client'

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Loader } from '@/components/ui/loader'
import { useSmartPoll } from '@/lib/use-smart-poll'
import { createClientLogger } from '@/lib/client-logger'
import { AgentAvatar } from '@/components/ui/agent-avatar'
import {
  OverviewTab,
  ActivityTab,
} from './agent-detail-tabs'
import { formatModelName, buildTaskStatParts } from '@/lib/agent-card-helpers'
import { useMissionControl, type Agent } from '@/store'
import { getSoftwareEngineeringPhasesForLocale } from '@/lib/software-engineering-squad'
import { useWorkspaceSquadActive } from '@/lib/use-workspace-squad-active'

const log = createClientLogger('AgentSquadPhase3')

interface WorkItem {
  type: string
  count: number
  items: any[]
}

interface HeartbeatResponse {
  status: 'HEARTBEAT_OK' | 'WORK_ITEMS_FOUND'
  agent: string
  checked_at: number
  work_items?: WorkItem[]
  total_items?: number
  message?: string
}

interface SoulTemplate {
  name: string
  description: string
  size: number
}

const statusColors: Record<string, string> = {
  offline: 'bg-gray-500',
  idle: 'bg-green-500',
  busy: 'bg-yellow-500',
  error: 'bg-red-500',
}

const statusBadgeStyles: Record<string, string> = {
  offline: 'bg-slate-500/15 text-slate-300 border-slate-500/30',
  idle: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  busy: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  error: 'bg-rose-500/15 text-rose-300 border-rose-500/30',
}

const statusIcons: Record<string, string> = {
  offline: '-',
  idle: 'o',
  busy: '~',
  error: '!',
}

const defaultCardStyle = {
  edge: 'from-slate-400/60 to-slate-600/30',
  glow: 'from-slate-500/10 via-transparent to-transparent',
  dot: 'bg-slate-400',
}

const statusCardStyles: Record<string, { edge: string; glow: string; dot: string }> = {
  offline: defaultCardStyle,
  idle: {
    edge: 'from-emerald-300/80 to-emerald-600/30',
    glow: 'from-emerald-400/15 via-transparent to-transparent',
    dot: 'bg-emerald-300',
  },
  busy: {
    edge: 'from-amber-300/80 to-amber-600/30',
    glow: 'from-amber-400/15 via-transparent to-transparent',
    dot: 'bg-amber-300',
  },
  error: {
    edge: 'from-rose-300/80 to-rose-600/30',
    glow: 'from-rose-400/15 via-transparent to-transparent',
    dot: 'bg-rose-300',
  },
}

export function AgentSquadPanelPhase3() {
  const locale = useLocale()
  const t = useTranslations('agentSquadPhase3')
  const swePhases = useMemo(() => getSoftwareEngineeringPhasesForLocale(locale), [locale])
  const { agents, setAgents } = useMissionControl()
  const [loading, setLoading] = useState(agents.length === 0)
  const [error, setError] = useState<string | null>(null)
  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null)
  const [showQuickSpawnModal, setShowQuickSpawnModal] = useState(false)
  const [autoRefresh, setAutoRefresh] = useState(true)
  const [syncToast, setSyncToast] = useState<string | null>(null)
  const [showHidden, setShowHidden] = useState(false)
  const [swePresetLoading, setSwePresetLoading] = useState(false)
  const [squadConfirmLoading, setSquadConfirmLoading] = useState(false)
  const { squadActive, refreshSquadState } = useWorkspaceSquadActive()

  // Fetch agents
  const fetchAgents = useCallback(async () => {
    try {
      setError(null)
      if (agents.length === 0) setLoading(true)

      const url = showHidden ? '/api/agents?show_hidden=true' : '/api/agents'
      const response = await fetch(url)
      if (response.status === 401) {
        window.location.assign('/login?next=%2Fagents')
        return
      }
      if (response.status === 403) {
        throw new Error('Access denied')
      }
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to fetch agents')
      }

      const data = await response.json()
      setAgents(data.agents || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setLoading(false)
    }
  }, [agents.length, setAgents, showHidden])

  // Smart polling with visibility pause
  useSmartPoll(fetchAgents, 30000, { enabled: autoRefresh, pauseWhenSseConnected: true })

  // Update agent status
  const updateAgentStatus = async (agentName: string, status: Agent['status'], activity?: string) => {
    try {
      const response = await fetch('/api/agents', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: agentName,
          status,
          last_activity: activity || `Status changed to ${status}`
        })
      })

      if (!response.ok) throw new Error('Failed to update agent status')
      
      // Update store state
      setAgents(agents.map(agent =>
        agent.name === agentName
          ? {
              ...agent,
              status,
              last_activity: activity || `Status changed to ${status}`,
              last_seen: Math.floor(Date.now() / 1000),
              updated_at: Math.floor(Date.now() / 1000)
            }
          : agent
      ))
    } catch (error) {
      log.error('Failed to update agent status:', error)
      setError('Failed to update agent status')
    }
  }

  // Wake agent via session_send
  const wakeAgent = async (agentName: string, sessionKey: string) => {
    try {
      const response = await fetch(`/api/agents/${agentName}/wake`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: `🤖 **Wake Up Call**\n\nAgent ${agentName}, you have been manually woken up.\nCheck AURA for any pending tasks or notifications.\n\n⏰ ${new Date().toLocaleString()}`
        })
      })

      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to wake agent')
      }

      await updateAgentStatus(agentName, 'idle', 'Manually woken via session')
    } catch (error) {
      log.error('Failed to wake agent:', error)
      setError('Failed to wake agent')
    }
  }

  // Re-fetch when showHidden changes
  useEffect(() => {
    fetchAgents()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showHidden])

  const toggleAgentHidden = async (agentId: number, hide: boolean) => {
    try {
      const response = await fetch(`/api/agents/${agentId}/hide`, {
        method: hide ? 'POST' : 'DELETE',
      })
      if (!response.ok) throw new Error('Failed to update visibility')
      fetchAgents()
    } catch (error) {
      log.error('Failed to toggle agent visibility:', error)
      setError('Failed to update agent visibility')
    }
  }

  const installSoftwareEngineeringPreset = async () => {
    setSwePresetLoading(true)
    setSyncToast(null)
    try {
      const res = await fetch('/api/agents/presets/software-engineering', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          skip_existing: true,
          write_to_gateway: false,
          provision_workspace: false,
          locale,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.status === 401) {
        window.location.assign('/login?next=%2Fagents')
        return
      }
      if (!res.ok) throw new Error(data.error || t('swePresetError'))
      const parts = [
        t('swePresetResult', {
          createdCount: data.created?.length ?? 0,
          skippedCount: data.skipped?.length ?? 0,
          errorCount: data.errors?.length ?? 0,
        }),
      ]
      if (Array.isArray(data.errors) && data.errors.length > 0) {
        parts.push(
          data.errors.map((e: { name: string; error: string }) => `${e.name}: ${e.error}`).join(' · '),
        )
      }
      if (Array.isArray(data.warnings) && data.warnings.length > 0) {
        parts.push(data.warnings.join(' · '))
      }
      setSyncToast(parts.filter(Boolean).join(' '))
      await fetchAgents()
      await refreshSquadState()
      setTimeout(() => setSyncToast(null), 8000)
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : t('swePresetError')
      setSyncToast(msg)
      setTimeout(() => setSyncToast(null), 5000)
    } finally {
      setSwePresetLoading(false)
    }
  }

  const confirmSquadReady = async () => {
    if (agents.length === 0) return
    setSquadConfirmLoading(true)
    setSyncToast(null)
    try {
      const res = await fetch('/api/workspace/squad-state', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ squad_active: true }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.status === 401) {
        window.location.assign('/login?next=%2Fagents')
        return
      }
      if (!res.ok) throw new Error(data.error || t('squadConfirmError'))
      setSyncToast(t('squadConfirmedToast'))
      await refreshSquadState()
      setTimeout(() => setSyncToast(null), 6000)
    } catch (e: unknown) {
      setSyncToast(e instanceof Error ? e.message : t('squadConfirmError'))
      setTimeout(() => setSyncToast(null), 5000)
    } finally {
      setSquadConfirmLoading(false)
    }
  }

  const deleteAgent = async (agentId: number, removeWorkspace: boolean) => {
    const previousAgents = agents
    setAgents(agents.filter((agent) => agent.id !== agentId))

    const response = await fetch(`/api/agents/${agentId}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ remove_workspace: removeWorkspace }),
    })

    const payload = await response.json().catch(() => ({}))
    if (!response.ok) {
      setAgents(previousAgents)
      throw new Error(payload?.error || 'Failed to delete agent')
    }

    setSyncToast(
      removeWorkspace
        ? `Deleted agent and workspace: ${payload?.deleted || agentId}`
        : `Deleted agent: ${payload?.deleted || agentId}`,
    )
    await fetchAgents()
    setTimeout(() => setSyncToast(null), 5000)
  }

  // Format last seen time
  const formatLastSeen = (timestamp?: number) => {
    if (!timestamp) return 'Never'
    
    const now = Date.now()
    const diffMs = now - (timestamp * 1000)
    const diffMinutes = Math.floor(diffMs / (1000 * 60))
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60))
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))

    if (diffMinutes < 1) return 'Just now'
    if (diffMinutes < 60) return `${diffMinutes}m ago`
    if (diffHours < 24) return `${diffHours}h ago`
    if (diffDays < 7) return `${diffDays}d ago`
    
    return new Date(timestamp * 1000).toLocaleDateString()
  }

  // Check if agent had recent heartbeat (within 30 minutes)
  const hasRecentHeartbeat = (agent: Agent) => {
    if (!agent.last_seen) return false
    const thirtyMinutesAgo = Math.floor(Date.now() / 1000) - (30 * 60)
    return agent.last_seen > thirtyMinutesAgo
  }

  // Get status distribution for summary
  const statusCounts = agents.reduce((acc, agent) => {
    acc[agent.status] = (acc[agent.status] || 0) + 1
    return acc
  }, {} as Record<string, number>)

  if (loading && agents.length === 0) {
    return <Loader variant="panel" label="Carregando agentes" />
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex justify-between items-center p-4 border-b border-border flex-shrink-0">
        <div className="flex items-center gap-4">
          <h2 className="text-xl font-bold text-foreground">{t('title')}</h2>
          
          {/* Status Summary */}
          <div className="flex gap-2 text-sm">
            {Object.entries(statusCounts).map(([status, count]) => (
              <div key={status} className="flex items-center gap-1">
                <div className={`w-2 h-2 rounded-full ${statusColors[status]}`}></div>
                <span className="text-muted-foreground">{count}</span>
              </div>
            ))}
          </div>

          {/* Active Heartbeats Indicator */}
          <div className="flex items-center gap-1">
            <div className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse"></div>
            <span className="text-sm text-muted-foreground">
              {t('activeHeartbeats', { count: agents.filter(hasRecentHeartbeat).length })}
            </span>
          </div>
        </div>
        
        <div className="flex gap-2">
          <Button
            onClick={() => setAutoRefresh(!autoRefresh)}
            variant={autoRefresh ? 'success' : 'secondary'}
            size="sm"
          >
            {autoRefresh ? t('live') : t('manual')}
          </Button>
          <Button
            onClick={() => setShowHidden(!showHidden)}
            variant={showHidden ? 'success' : 'secondary'}
            size="sm"
          >
            {showHidden ? 'Showing hidden' : 'Show hidden'}
          </Button>
          <Button
            onClick={fetchAgents}
            variant="secondary"
            size="sm"
          >
            {t('refresh')}
          </Button>
        </div>
      </div>

      {/* Sync Toast */}
      {syncToast && (
        <div className={`p-3 m-4 rounded-lg text-sm ${syncToast.includes('failed') ? 'bg-red-500/10 border border-red-500/20 text-red-400' : 'bg-green-500/10 border border-green-500/20 text-green-400'}`}>
          {syncToast}
        </div>
      )}

      {/* Error Display */}
      {error && (
        <div className="bg-red-500/10 border border-red-500/20 text-red-400 p-3 m-4 rounded-lg text-sm flex items-center justify-between">
          <span>{error}</span>
          <Button
            onClick={() => setError(null)}
            variant="ghost"
            size="icon-sm"
            className="text-red-400/60 hover:text-red-400 ml-2"
          >
            ×
          </Button>
        </div>
      )}

      {/* Agent Grid */}
      <div className="flex-1 p-4 overflow-y-auto">
        <section
          className="mb-6 rounded-xl border border-border bg-card p-4 text-foreground shadow-sm"
          aria-labelledby="swe-preset-heading"
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h3 id="swe-preset-heading" className="text-base font-semibold tracking-tight">
                {t('swePresetTitle')}
              </h3>
              <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{t('swePresetSubtitle')}</p>
              <p className="mt-2 text-xs text-muted-foreground/90">{t('swePresetGatewayHint')}</p>
              {squadActive === false && (
                <p className="mt-3 rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-200/90">
                  {t('squadGateHint')}
                </p>
              )}
            </div>
            <div className="flex flex-col gap-2 shrink-0 sm:items-end">
              {squadActive ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={swePresetLoading}
                  onClick={() => void installSoftwareEngineeringPreset()}
                >
                  {swePresetLoading ? t('swePresetInstalling') : t('swePresetReinstall')}
                </Button>
              ) : (
                <>
                  <Button
                    type="button"
                    variant="default"
                    size="sm"
                    disabled={swePresetLoading}
                    onClick={() => void installSoftwareEngineeringPreset()}
                  >
                    {swePresetLoading ? t('swePresetInstalling') : t('swePresetInstall')}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={squadConfirmLoading || agents.length === 0}
                    onClick={() => void confirmSquadReady()}
                  >
                    {squadConfirmLoading ? t('squadConfirming') : t('squadConfirmManual')}
                  </Button>
                </>
              )}
            </div>
          </div>
          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {swePhases.map((phase) => (
              <div
                key={phase.id}
                className={`rounded-lg border p-3 text-foreground ${phase.cardClass}`}
              >
                <div className="text-2xs font-semibold uppercase tracking-wide text-foreground/80">
                  {t(phase.titleKey)}
                </div>
                <ul className="mt-2 space-y-2">
                  {phase.members.map((m) => (
                    <li key={m.name} className="flex items-start gap-2 text-sm">
                      <span className="text-lg leading-none" aria-hidden>
                        {m.emoji}
                      </span>
                      <div className="min-w-0">
                        <div className="font-medium leading-tight">{m.name}</div>
                        <div className="text-2xs capitalize text-muted-foreground">{m.roleLabel}</div>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>

        {agents.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-muted-foreground/50">
            <div className="w-12 h-12 rounded-full bg-surface-2 flex items-center justify-center mb-3">
              <svg width="20" height="20" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                <circle cx="8" cy="5" r="3" />
                <path d="M2 14c0-3.3 2.7-6 6-6s6 2.7 6 6" />
              </svg>
            </div>
            <p className="text-sm font-medium">{t('noAgents')}</p>
            <p className="text-xs text-muted-foreground/70 mt-1 max-w-xs text-center">
              {t('noAgentsHint')}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {agents.map(agent => {
              const modelName = formatModelName(agent.config)
              const taskStatsLine = buildTaskStatParts(agent.taskStats)

              return (
                <div
                  key={agent.id}
                  className="group relative overflow-hidden rounded-xl border border-border/70 bg-card p-4 transition-all duration-200 ease-out hover:-translate-y-0.5 hover:border-border hover:shadow-lg cursor-pointer"
                  onClick={() => setSelectedAgent(agent)}
                >
                  <div className={`pointer-events-none absolute inset-y-0 left-0 w-1 bg-gradient-to-b ${(statusCardStyles[agent.status] || defaultCardStyle).edge}`} />
                  {agent.hidden ? <div className="absolute top-2 right-2 text-2xs text-slate-500">hidden</div> : null}

                  {/* Header: avatar + name + status */}
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <AgentAvatar name={agent.name} size="md" />
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <h3 className="font-semibold text-foreground truncate">{agent.name}</h3>
                          {(agent as any).source && (agent as any).source !== 'manual' && (
                            <span className={`text-2xs px-1.5 py-0.5 rounded-full border ${
                              (agent as any).source === 'local'
                                ? 'bg-violet-500/15 text-violet-300 border-violet-500/30'
                                : (agent as any).source === 'gateway'
                                  ? 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30'
                                  : 'bg-slate-500/15 text-slate-300 border-slate-500/30'
                            }`}>
                              {(agent as any).source}
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground truncate">
                          {agent.role}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      {hasRecentHeartbeat(agent) && (
                        <div className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" title="Recent heartbeat" />
                      )}
                      <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs capitalize ${statusBadgeStyles[agent.status]}`}>
                        <span className={`h-1.5 w-1.5 rounded-full ${(statusCardStyles[agent.status] || defaultCardStyle).dot}`} />
                        {agent.status}
                      </span>
                    </div>
                  </div>

                  {/* Task stats — inline */}
                  {taskStatsLine && (
                    <div className="text-xs text-muted-foreground mb-2 pl-0.5">
                      {taskStatsLine.map((part, i) => (
                        <span key={part.label}>
                          {i > 0 && <span className="mx-1 text-muted-foreground/40">·</span>}
                          <span className={part.color || 'text-foreground/80'}>{part.count}</span>
                          {' '}{part.label}
                        </span>
                      ))}
                    </div>
                  )}

                  {/* Footer: last seen + actions */}
                  <div className="flex items-center justify-between mt-2 pt-2 border-t border-border/30">
                    <span className="text-[11px] text-muted-foreground/70">
                      {formatLastSeen(agent.last_seen)}
                    </span>
                    <div className="flex gap-1">
                      {agent.session_key ? (
                        <Button
                          onClick={(e) => {
                            e.stopPropagation()
                            wakeAgent(agent.name, agent.session_key!)
                          }}
                          size="xs"
                          variant="ghost"
                          className="h-6 px-2 text-xs text-cyan-300 hover:bg-cyan-500/15 hover:text-cyan-200"
                          title="Wake agent via session"
                        >
                          {t('wake')}
                        </Button>
                      ) : (
                        <Button
                          onClick={(e) => {
                            e.stopPropagation()
                            updateAgentStatus(agent.name, 'idle', 'Manually activated')
                          }}
                          disabled={agent.status === 'idle'}
                          size="xs"
                          variant="ghost"
                          className="h-6 px-2 text-xs"
                        >
                          {t('wake')}
                        </Button>
                      )}
                      <Button
                        onClick={(e) => {
                          e.stopPropagation()
                          setSelectedAgent(agent)
                          setShowQuickSpawnModal(true)
                        }}
                        size="xs"
                        variant="ghost"
                        className="h-6 px-2 text-xs text-blue-300 hover:bg-blue-500/15 hover:text-blue-200"
                      >
                        {t('spawn')}
                      </Button>
                      <Button
                        onClick={(e) => {
                          e.stopPropagation()
                          toggleAgentHidden(agent.id, !agent.hidden)
                        }}
                        size="xs"
                        variant="ghost"
                        className="h-6 px-2 text-xs text-slate-400 hover:bg-slate-500/15 hover:text-slate-300"
                      >
                        {agent.hidden ? 'Unhide' : 'Hide'}
                      </Button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Agent Detail Modal */}
      {selectedAgent && (
        <AgentDetailModalPhase3
          agent={selectedAgent}
          onClose={() => setSelectedAgent(null)}
          onUpdate={fetchAgents}
          onStatusUpdate={updateAgentStatus}
          onWakeAgent={wakeAgent}
          onDelete={deleteAgent}
        />
      )}

      {/* Quick Spawn Modal */}
      {showQuickSpawnModal && selectedAgent && (
        <QuickSpawnModal
          agent={selectedAgent}
          onClose={() => {
            setShowQuickSpawnModal(false)
            setSelectedAgent(null)
          }}
          onSpawned={fetchAgents}
        />
      )}
    </div>
  )
}

// Enhanced Agent Detail Modal with Tabs
function AgentDetailModalPhase3({
  agent,
  onClose,
  onUpdate,
  onStatusUpdate,
  onWakeAgent,
  onDelete
}: {
  agent: Agent
  onClose: () => void
  onUpdate: () => void
  onStatusUpdate: (name: string, status: Agent['status'], activity?: string) => Promise<void>
  onWakeAgent: (name: string, sessionKey: string) => Promise<void>
  onDelete: (agentId: number, removeWorkspace: boolean) => Promise<void>
}) {
  const [agentState, setAgentState] = useState<Agent & { config?: any; working_memory?: string }>(agent as Agent & { config?: any; working_memory?: string })
  const [activeTab, setActiveTab] = useState<'overview' | 'instructions' | 'persona' | 'activity'>('overview')
  const [editing, setEditing] = useState(false)
  const [formData, setFormData] = useState({
    role: agent.role,
    session_key: agent.session_key || '',
    soul_content: agent.soul_content || '',
    working_memory: agent.working_memory || '',
    model: (() => { const p = (agent as any).config?.model?.primary; return (typeof p === 'string' ? p : p?.primary) || '' })(),
  })
  const [workspaceFiles, setWorkspaceFiles] = useState<{ identityMd: string; agentMd: string }>({
    identityMd: '',
    agentMd: '',
  })
  const [soulTemplates, setSoulTemplates] = useState<SoulTemplate[]>([])
  const [heartbeatData, setHeartbeatData] = useState<HeartbeatResponse | null>(null)
  const [loadingHeartbeat, setLoadingHeartbeat] = useState(false)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [showDeleteMenu, setShowDeleteMenu] = useState(false)
  const [saveBusy, setSaveBusy] = useState(false)
  const deleteMenuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (deleteBusy) return
      if (deleteMenuRef.current && !deleteMenuRef.current.contains(e.target as Node)) {
        setShowDeleteMenu(false)
      }
    }
    if (showDeleteMenu) {
      document.addEventListener('mousedown', handleClickOutside)
    }
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [showDeleteMenu, deleteBusy])

  useEffect(() => {
    setAgentState(agent as Agent & { config?: any; working_memory?: string })
    setFormData({
      role: agent.role,
      session_key: agent.session_key || '',
      soul_content: agent.soul_content || '',
      working_memory: (agent as any).working_memory || '',
      model: (() => { const p = (agent as any).config?.model?.primary; return (typeof p === 'string' ? p : p?.primary) || '' })(),
    })
  }, [agent])

  useEffect(() => {
    const loadCanonicalAgentData = async () => {
      try {
        const [agentRes, soulRes, memoryRes, filesRes] = await Promise.all([
          fetch(`/api/agents/${agent.id}`),
          fetch(`/api/agents/${agent.id}/soul`),
          fetch(`/api/agents/${agent.id}/memory`),
          fetch(`/api/agents/${agent.id}/files`),
        ])

        if (agentRes.ok) {
          const payload = await agentRes.json()
          if (payload?.agent) {
            const freshAgent = payload.agent as Agent & { config?: any; working_memory?: string }
            setAgentState((prev) => ({ ...prev, ...freshAgent }))
            setFormData((prev) => ({
              ...prev,
              role: freshAgent.role || prev.role,
              session_key: freshAgent.session_key || '',
              model: (freshAgent as any).config?.model?.primary || prev.model,
            }))
          }
        }

        if (soulRes.ok) {
          const payload = await soulRes.json()
          setFormData((prev) => ({ ...prev, soul_content: String(payload?.soul_content || '') }))
        }

        if (memoryRes.ok) {
          const payload = await memoryRes.json()
          setFormData((prev) => ({ ...prev, working_memory: String(payload?.working_memory || '') }))
        }

        if (filesRes.ok) {
          const payload = await filesRes.json()
          setWorkspaceFiles({
            identityMd: String(payload?.files?.['identity.md']?.content || ''),
            agentMd: String(payload?.files?.['agent.md']?.content || ''),
          })
        }
      } catch (error) {
        log.error('Failed to load canonical agent data:', error)
      }
    }

    loadCanonicalAgentData()
  }, [agent.id])

  const formatLastSeen = (timestamp?: number) => {
    if (!timestamp) return 'Never'
    const diffMs = Date.now() - (timestamp * 1000)
    const diffMinutes = Math.floor(diffMs / (1000 * 60))
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60))
    if (diffMinutes < 1) return 'Just now'
    if (diffMinutes < 60) return `${diffMinutes}m ago`
    if (diffHours < 24) return `${diffHours}h ago`
    return new Date(timestamp * 1000).toLocaleDateString()
  }

  // Load SOUL templates
  useEffect(() => {
    const loadTemplates = async () => {
      try {
        const response = await fetch(`/api/agents/${agent.name}/soul`, {
          method: 'PATCH'
        })
        if (response.ok) {
          const data = await response.json()
          setSoulTemplates(data.templates || [])
        }
      } catch (error) {
        log.error('Failed to load SOUL templates:', error)
      }
    }
    
  }, [agent.name])

  // Perform heartbeat check
  const performHeartbeat = async () => {
    setLoadingHeartbeat(true)
    try {
      const response = await fetch(`/api/agents/${agent.name}/heartbeat`)
      if (response.ok) {
        const data = await response.json()
        setHeartbeatData(data)
      }
    } catch (error) {
      log.error('Failed to perform heartbeat:', error)
    } finally {
      setLoadingHeartbeat(false)
    }
  }

  const handleSave = async () => {
    setSaveBusy(true)
    try {
      const response = await fetch('/api/agents', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: agentState.name,
          ...formData
        })
      })

      if (!response.ok) throw new Error('Failed to update agent')

      setEditing(false)
      onUpdate()
    } catch (error) {
      log.error('Failed to update agent:', error)
    } finally {
      setSaveBusy(false)
    }
  }

  const handleSoulSave = async (content: string, templateName?: string) => {
    try {
      const response = await fetch(`/api/agents/${agentState.id}/soul`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          soul_content: content,
          template_name: templateName
        })
      })

      if (!response.ok) throw new Error('Failed to update SOUL')
      
      setFormData(prev => ({ ...prev, soul_content: content }))
      setAgentState(prev => ({ ...prev, soul_content: content }))
      onUpdate()
    } catch (error) {
      log.error('Failed to update SOUL:', error)
    }
  }

  const handleMemorySave = async (content: string, append: boolean = false) => {
    try {
      const response = await fetch(`/api/agents/${agentState.id}/memory`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          working_memory: content,
          append
        })
      })

      if (!response.ok) throw new Error('Failed to update memory')
      
      const data = await response.json()
      setFormData(prev => ({ ...prev, working_memory: data.working_memory }))
      setAgentState(prev => ({ ...prev, working_memory: data.working_memory }))
      onUpdate()
    } catch (error) {
      log.error('Failed to update memory:', error)
    }
  }

  const handleWorkspaceFileSave = async (file: 'identity.md' | 'agent.md', content: string) => {
    const response = await fetch(`/api/agents/${agentState.id}/files`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file, content }),
    })
    const payload = await response.json().catch(() => ({}))
    if (!response.ok) {
      throw new Error(payload?.error || `Failed to save ${file}`)
    }
    setWorkspaceFiles((prev) => ({
      ...prev,
      ...(file === 'identity.md' ? { identityMd: content } : { agentMd: content }),
    }))
  }

  const tabs = [
    { id: 'overview', label: 'Overview', icon: 'O' },
    { id: 'instructions', label: 'Instruções', icon: 'I' },
    { id: 'persona', label: 'Persona', icon: 'P' },
    { id: 'activity', label: 'Atividade', icon: 'A' },
  ]

  const handleDelete = async (removeWorkspace: boolean) => {
    const scope = removeWorkspace ? 'agent and workspace' : 'agent'
    const confirmed = window.confirm(`Delete ${scope} for "${agentState.name}"? This cannot be undone.`)
    if (!confirmed) return

    setDeleteBusy(true)
    setDeleteError(null)
    try {
      await onDelete(agentState.id, removeWorkspace)
      onClose()
    } catch (error: any) {
      setDeleteError(error?.message || `Failed to delete ${scope}`)
    } finally {
      setDeleteBusy(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 backdrop-blur-md flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-card border border-border/80 rounded-lg shadow-2xl shadow-black/40 max-w-5xl w-full max-h-[90vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="px-5 pt-5 pb-0 border-b border-border">
          <div className="flex justify-between items-center gap-4 mb-4">
            <div className="flex items-center gap-3 min-w-0">
              <AgentAvatar name={agent.name} size="md" />
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h3 className="text-lg font-semibold text-foreground leading-tight truncate">{agentState.name}</h3>
                  <span className={`inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full border ${statusBadgeStyles[agentState.status]}`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${statusColors[agentState.status]}`} />
                    {agentState.status}
                  </span>
                  {agentState.session_key && (
                    <span className="text-[11px] px-2 py-0.5 rounded-full border border-cyan-500/30 bg-cyan-500/10 text-cyan-300">
                      Session
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="text-sm text-muted-foreground">{agentState.role}</span>
                  <span className="text-xs text-muted-foreground/60">·</span>
                  <span className="text-xs text-muted-foreground/60">seen {formatLastSeen(agentState.last_seen)}</span>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="relative" ref={deleteMenuRef}>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="text-muted-foreground hover:text-rose-400"
                  title="Excluir agente"
                  onClick={() => setShowDeleteMenu(prev => !prev)}
                >
                  <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M2 4h12M5.33 4V2.67a1.33 1.33 0 0 1 1.34-1.34h2.66a1.33 1.33 0 0 1 1.34 1.34V4M12.67 4v9.33a1.33 1.33 0 0 1-1.34 1.34H4.67a1.33 1.33 0 0 1-1.34-1.34V4" />
                  </svg>
                </Button>
                {showDeleteMenu && (
                  <div className="absolute right-0 top-full mt-1 flex flex-col gap-1 bg-card border border-border rounded-md shadow-xl p-1.5 z-10 min-w-[180px]">
                    <button
                      onClick={() => handleDelete(false)}
                      disabled={deleteBusy}
                      className="text-left text-xs px-2.5 py-1.5 rounded text-rose-300 hover:bg-rose-500/10 transition-colors disabled:opacity-50"
                    >
                      {deleteBusy ? (
                        <span className="flex items-center gap-1.5">
                          <svg className="w-3 h-3 animate-spin" viewBox="0 0 16 16" fill="none">
                            <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" strokeDasharray="28" strokeDashoffset="8" />
                          </svg>
                          Deleting...
                        </span>
                      ) : 'Delete agent'}
                    </button>
                    <button
                      onClick={() => handleDelete(true)}
                      disabled={deleteBusy}
                      className="text-left text-xs px-2.5 py-1.5 rounded text-rose-400 hover:bg-rose-500/10 transition-colors disabled:opacity-50"
                    >
                      {deleteBusy ? (
                        <span className="flex items-center gap-1.5">
                          <svg className="w-3 h-3 animate-spin" viewBox="0 0 16 16" fill="none">
                            <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" strokeDasharray="28" strokeDashoffset="8" />
                          </svg>
                          Deleting...
                        </span>
                      ) : 'Delete agent + workspace'}
                    </button>
                  </div>
                )}
              </div>
              <Button
                onClick={onClose}
                aria-label="Close agent details"
                variant="ghost"
                size="icon-sm"
                className="text-muted-foreground hover:text-foreground"
              >
                <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                  <path d="M4 4l8 8M12 4l-8 8" />
                </svg>
              </Button>
            </div>
          </div>

          {deleteError && (
            <div className="mb-3 rounded-md border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
              {deleteError}
            </div>
          )}

          {/* Tab Navigation */}
          <div className="flex gap-0 overflow-x-auto -mb-px">
            {tabs.map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as any)}
                className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                  activeTab === tab.id
                    ? 'border-primary text-foreground'
                    : 'border-transparent text-muted-foreground hover:text-foreground hover:border-border'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {/* Tab Content */}
        <div className="flex-1 overflow-y-auto">
          {activeTab === 'overview' && (
            <OverviewTab
              agent={agentState}
              editing={editing}
              formData={formData}
              setFormData={setFormData}
              onSave={handleSave}
              saveBusy={saveBusy}
              onStatusUpdate={onStatusUpdate}
              onWakeAgent={onWakeAgent}
              onEdit={() => setEditing(true)}
              onCancel={() => setEditing(false)}
              heartbeatData={heartbeatData}
              loadingHeartbeat={loadingHeartbeat}
              onPerformHeartbeat={performHeartbeat}
            />
          )}

          {activeTab === 'instructions' && (
            <InstructionsTab
              agent={agentState}
              onSaved={(patch) => {
                setAgentState(prev => ({ ...prev, ...patch }))
                setFormData(prev => ({ ...prev, ...patch }))
              }}
            />
          )}

          {activeTab === 'persona' && (
            <PersonaTab agent={agentState} onSaved={(patch) => setAgentState(prev => ({ ...prev, ...patch }))} />
          )}

          {activeTab === 'activity' && (
            <ActivityTab agent={agentState} />
          )}
        </div>
      </div>
    </div>
  )
}

// Quick Spawn Modal
function QuickSpawnModal({
  agent,
  onClose,
  onSpawned
}: {
  agent: Agent
  onClose: () => void
  onSpawned: () => void
}) {
  const [spawnData, setSpawnData] = useState({
    task: '',
    model: 'sonnet',
    label: `${agent.name}-subtask-${Date.now()}`,
    timeoutSeconds: 300
  })
  const [isSpawning, setIsSpawning] = useState(false)
  const [spawnResult, setSpawnResult] = useState<any>(null)

  const models = [
    { id: 'haiku', name: 'Claude Haiku', cost: '$0.25/1K', speed: 'Ultra Fast' },
    { id: 'sonnet', name: 'Claude Sonnet', cost: '$3.00/1K', speed: 'Fast' },
    { id: 'opus', name: 'Claude Opus', cost: '$15.00/1K', speed: 'Slow' },
    { id: 'groq-fast', name: 'Groq Llama 8B', cost: '$0.05/1K', speed: '840 tok/s' },
    { id: 'groq', name: 'Groq Llama 70B', cost: '$0.59/1K', speed: '150 tok/s' },
    { id: 'deepseek', name: 'DeepSeek R1', cost: 'FREE', speed: 'Local' },
  ]

  const handleSpawn = async () => {
    if (!spawnData.task.trim()) {
      alert('Please enter a task description')
      return
    }

    setIsSpawning(true)
    try {
      const response = await fetch('/api/spawn', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...spawnData,
          parentAgent: agent.name,
          sessionKey: agent.session_key
        })
      })

      const result = await response.json()
      if (response.ok) {
        setSpawnResult(result)
        onSpawned()
        
        // Auto-close after 2 seconds if successful
        setTimeout(() => {
          onClose()
        }, 2000)
      } else {
        alert(result.error || 'Failed to spawn agent')
      }
    } catch (error) {
      log.error('Spawn failed:', error)
      alert('Network error occurred')
    } finally {
      setIsSpawning(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-card border border-border rounded-lg max-w-md w-full p-6">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-lg font-bold text-foreground">
            Quick Spawn for {agent.name}
          </h3>
          <Button onClick={onClose} variant="ghost" size="icon-sm" className="text-2xl">×</Button>
        </div>

        {spawnResult ? (
          <div className="space-y-4">
            <div className="bg-green-500/10 border border-green-500/20 text-green-400 p-3 rounded-lg text-sm">
              Agent spawned successfully!
            </div>
            <div className="text-sm text-foreground/80">
              <p><strong>Agent ID:</strong> {spawnResult.agentId}</p>
              <p><strong>Session:</strong> {spawnResult.sessionId}</p>
              <p><strong>Model:</strong> {spawnResult.model}</p>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Task Description */}
            <div>
              <label className="block text-sm font-medium text-foreground/80 mb-2">
                Task Description *
              </label>
              <textarea
                value={spawnData.task}
                onChange={(e) => setSpawnData(prev => ({ ...prev, task: e.target.value }))}
                placeholder={`Delegate a subtask to ${agent.name}...`}
                className="w-full h-24 px-3 py-2 bg-surface-1 border border-border rounded text-foreground placeholder-muted-foreground focus:border-primary/50 focus:ring-1 focus:ring-primary/50 resize-none"
              />
            </div>

            {/* Model Selection */}
            <div>
              <label className="block text-sm font-medium text-foreground/80 mb-2">
                Model
              </label>
              <select
                value={spawnData.model}
                onChange={(e) => setSpawnData(prev => ({ ...prev, model: e.target.value }))}
                className="w-full px-3 py-2 bg-surface-1 border border-border rounded text-foreground focus:border-primary/50 focus:ring-1 focus:ring-primary/50"
              >
                {models.map(model => (
                  <option key={model.id} value={model.id}>
                    {model.name} - {model.cost} ({model.speed})
                  </option>
                ))}
              </select>
            </div>

            {/* Agent Label */}
            <div>
              <label className="block text-sm font-medium text-foreground/80 mb-2">
                Agent Label
              </label>
              <input
                type="text"
                value={spawnData.label}
                onChange={(e) => setSpawnData(prev => ({ ...prev, label: e.target.value }))}
                className="w-full px-3 py-2 bg-surface-1 border border-border rounded text-foreground focus:border-primary/50 focus:ring-1 focus:ring-primary/50"
              />
            </div>

            {/* Timeout */}
            <div>
              <label className="block text-sm font-medium text-foreground/80 mb-2">
                Timeout (seconds)
              </label>
              <input
                type="number"
                value={spawnData.timeoutSeconds}
                onChange={(e) => setSpawnData(prev => ({ ...prev, timeoutSeconds: parseInt(e.target.value) }))}
                min={30}
                max={3600}
                className="w-full px-3 py-2 bg-surface-1 border border-border rounded text-foreground focus:border-primary/50 focus:ring-1 focus:ring-primary/50"
              />
            </div>

            {/* Action Buttons */}
            <div className="flex gap-3 pt-4">
              <Button
                onClick={handleSpawn}
                disabled={isSpawning || !spawnData.task.trim()}
                className="flex-1"
              >
                {isSpawning ? 'Spawning...' : 'Spawn Agent'}
              </Button>
              <Button
                onClick={onClose}
                variant="secondary"
              >
                Cancel
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

const COMPACT_MODE_BLOCK = `

## Modo de Saída Compacto
- Seja direto. Elimine preâmbulos, redundâncias e meta-comentários.
- Nunca explique o que vai fazer — apenas faça.
- Prefira frases curtas a parágrafos longos.
- Blocos de código permanecem íntegros e sem alterações.
- Uma ideia = uma frase. Sem bullets para itens únicos.`

function parseSkillRefs(soul: string): string[] {
  const matches = soul.match(/skills\/([a-zA-Z0-9._-]+)\/SKILL\.md/g) || []
  return [...new Set(matches.map(m => m.split('/')[1]))]
}

function SkillViewer({ name }: { name: string }) {
  const [content, setContent] = useState<string | null>(null)
  const [draft, setDraft] = useState<string>('')
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null)

  const load = async () => {
    if (content !== null) { setOpen(o => !o); return }
    setLoading(true)
    try {
      const res = await fetch(`/api/project-skills?name=${encodeURIComponent(name)}`)
      const data = await res.json()
      const text = res.ok ? data.content : `Erro: ${data.error}`
      setContent(text)
      setDraft(text)
      setOpen(true)
    } catch {
      setContent('Não foi possível carregar o skill.')
      setOpen(true)
    } finally {
      setLoading(false)
    }
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      const res = await fetch('/api/project-skills', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, content: draft }),
      })
      if (!res.ok) throw new Error((await res.json()).error || 'Erro ao salvar')
      setContent(draft)
      setEditing(false)
      setFeedback({ ok: true, text: 'Skill salvo' })
      setTimeout(() => setFeedback(null), 2500)
    } catch (err: any) {
      setFeedback({ ok: false, text: err.message || 'Erro ao salvar' })
      setTimeout(() => setFeedback(null), 3000)
    } finally {
      setSaving(false)
    }
  }

  const handleCancel = () => {
    setDraft(content || '')
    setEditing(false)
  }

  return (
    <div className="rounded-md border border-border/60 overflow-hidden">
      <button
        type="button"
        onClick={load}
        className="w-full flex items-center justify-between px-3 py-2 text-xs font-mono text-muted-foreground hover:text-foreground hover:bg-secondary/30 transition-colors"
      >
        <span className="flex items-center gap-2">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5 text-primary/70">
            <path d="M13 2H3a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V3a1 1 0 0 0-1-1zM9 2v12M3 6h6" />
          </svg>
          <span>skills/{name}/SKILL.md</span>
        </span>
        <span className="text-muted-foreground/50 text-[10px]">
          {loading ? '...' : open ? '▲' : '▼'}
        </span>
      </button>

      {open && content !== null && (
        <div className="border-t border-border/40">
          {!editing ? (
            <>
              <pre className="px-3 py-3 text-[11px] font-mono text-muted-foreground bg-black/20 whitespace-pre-wrap leading-relaxed max-h-64 overflow-y-auto">
                {content}
              </pre>
              <div className="flex items-center justify-between px-3 py-1.5 bg-black/10 border-t border-border/30">
                {feedback && (
                  <span className={`text-[11px] ${feedback.ok ? 'text-green-400' : 'text-red-400'}`}>{feedback.text}</span>
                )}
                <button
                  type="button"
                  onClick={() => setEditing(true)}
                  className="ml-auto text-[11px] text-muted-foreground/60 hover:text-foreground transition-colors"
                >
                  Editar
                </button>
              </div>
            </>
          ) : (
            <>
              <textarea
                value={draft}
                onChange={e => setDraft(e.target.value)}
                rows={12}
                className="w-full px-3 py-2 text-[11px] font-mono text-foreground bg-black/30 resize-y focus:outline-none"
              />
              <div className="flex items-center gap-2 px-3 py-1.5 bg-black/10 border-t border-border/30">
                {feedback && (
                  <span className={`text-[11px] ${feedback.ok ? 'text-green-400' : 'text-red-400'}`}>{feedback.text}</span>
                )}
                <div className="ml-auto flex gap-2">
                  <button type="button" onClick={handleCancel} className="text-[11px] text-muted-foreground/60 hover:text-foreground transition-colors">
                    Cancelar
                  </button>
                  <button
                    type="button"
                    onClick={handleSave}
                    disabled={saving}
                    className="text-[11px] px-2.5 py-1 rounded bg-primary text-primary-foreground hover:bg-primary/80 disabled:opacity-50 transition-colors"
                  >
                    {saving ? 'Salvando...' : 'Salvar'}
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}

interface SoulHistoryEntry {
  id: number
  soul_content: string
  edited_by: string
  edited_at: number
}

function timeAgoSoul(ts: number): string {
  const d = Math.floor(Date.now() / 1000) - ts
  if (d < 60) return 'agora'
  if (d < 3600) return `${Math.floor(d / 60)}min atrás`
  if (d < 86400) return `${Math.floor(d / 3600)}h atrás`
  if (d < 86400 * 30) return `${Math.floor(d / 86400)}d atrás`
  return new Date(ts * 1000).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })
}

function InstructionsTab({
  agent,
  onSaved,
}: {
  agent: Agent & { model?: string; soul_content?: string }
  onSaved: (patch: { soul_content?: string }) => void
}) {
  const [content, setContent] = useState(agent.soul_content || '')
  const [saving, setSaving] = useState(false)
  const [activating, setActivating] = useState(false)
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null)
  const [history, setHistory] = useState<SoulHistoryEntry[]>([])
  const [historyOpen, setHistoryOpen] = useState(false)
  const [restoring, setRestoring] = useState<number | null>(null)
  const [diffEntry, setDiffEntry] = useState<SoulHistoryEntry | null>(null)

  const compactActive = content.includes('## Modo de Saída Compacto')
  const skillRefs = parseSkillRefs(content)

  useEffect(() => {
    fetch(`/api/agents/${agent.id}/soul`)
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data?.history) setHistory(data.history) })
      .catch(() => {})
  }, [agent.id])

  const showFeedback = (ok: boolean, text: string) => {
    setFeedback({ ok, text })
    setTimeout(() => setFeedback(null), 3000)
  }

  const handleSave = async (valueToSave = content) => {
    setSaving(true)
    try {
      const res = await fetch(`/api/agents/${agent.id}/soul`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ soul_content: valueToSave }),
      })
      if (!res.ok) throw new Error((await res.json()).error || 'Erro ao salvar')
      onSaved({ soul_content: valueToSave })
      showFeedback(true, 'Salvo com sucesso')
      // Reload history after save
      fetch(`/api/agents/${agent.id}/soul`)
        .then(r => r.ok ? r.json() : null)
        .then(data => { if (data?.history) setHistory(data.history) })
        .catch(() => {})
    } catch (err: any) {
      showFeedback(false, err.message || 'Erro ao salvar')
    } finally {
      setSaving(false)
    }
  }

  const handleToggleCompact = async () => {
    let next: string
    if (compactActive) {
      next = content.replace(/\n*## Modo de Saída Compacto[\s\S]*?(?=\n## |\n*$)/, '').trimEnd()
    } else {
      next = content.trimEnd() + COMPACT_MODE_BLOCK
    }
    setContent(next)
    setActivating(true)
    try {
      await handleSave(next)
    } finally {
      setActivating(false)
    }
  }

  const handleRestore = async (entry: SoulHistoryEntry) => {
    setRestoring(entry.id)
    try {
      const res = await fetch(`/api/agents/${agent.id}/soul`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ history_id: entry.id }),
      })
      if (!res.ok) throw new Error((await res.json()).error || 'Erro ao restaurar')
      const data = await res.json()
      const restored = data.soul_content ?? entry.soul_content
      setContent(restored)
      onSaved({ soul_content: restored })
      setDiffEntry(null)
      showFeedback(true, 'Versão restaurada com sucesso')
      fetch(`/api/agents/${agent.id}/soul`)
        .then(r => r.ok ? r.json() : null)
        .then(d => { if (d?.history) setHistory(d.history) })
        .catch(() => {})
    } catch (err: any) {
      showFeedback(false, err.message || 'Erro ao restaurar')
    } finally {
      setRestoring(null)
    }
  }

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <label className="block text-sm font-medium text-foreground">Soul (system prompt ativo)</label>
          <p className="text-xs text-muted-foreground">
            Este é o prompt de sistema que o motor de pipeline usa em todas as tarefas deste agente.
          </p>
        </div>
        <button
          type="button"
          onClick={handleToggleCompact}
          disabled={activating || saving}
          className={`shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium border transition-colors disabled:opacity-50 ${
            compactActive
              ? 'bg-primary/15 border-primary/40 text-primary hover:bg-primary/10'
              : 'bg-secondary/40 border-border/70 text-muted-foreground hover:bg-secondary/60 hover:text-foreground'
          }`}
        >
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5">
            <path d="M2 5h12M2 8h8M2 11h5" />
          </svg>
          {activating ? 'Aplicando...' : compactActive ? 'Modo compacto ativo' : 'Ativar modo compacto'}
        </button>
      </div>

      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        rows={10}
        className="w-full px-3 py-2 bg-surface-1 border border-border rounded text-foreground focus:border-primary/50 focus:ring-1 focus:ring-primary/50 text-sm font-mono resize-y"
        placeholder="O soul_content deste agente ainda não foi definido."
      />

      {skillRefs.length > 0 && (
        <div className="space-y-2">
          <p className="text-[11px] text-muted-foreground/60 uppercase tracking-wide font-medium">Skills referenciados</p>
          {skillRefs.map(name => (
            <SkillViewer key={name} name={name} />
          ))}
        </div>
      )}

      {feedback && (
        <div className={`rounded-md px-3 py-2 text-xs font-medium ${feedback.ok ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'}`}>
          {feedback.text}
        </div>
      )}

      <div className="flex items-center gap-3">
        <Button onClick={() => handleSave()} disabled={saving} size="sm">
          {saving ? 'Salvando...' : 'Salvar'}
        </Button>
        {history.length > 0 && (
          <button
            type="button"
            onClick={() => { setHistoryOpen(h => !h); setDiffEntry(null) }}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5">
              <circle cx="8" cy="8" r="6" /><path d="M8 5v3.5l2 1.5" />
            </svg>
            {history.length} versão{history.length !== 1 ? 'ões' : ''} anterior{history.length !== 1 ? 'es' : ''}
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={`w-3 h-3 transition-transform ${historyOpen ? 'rotate-180' : ''}`}>
              <path d="M4 6l4 4 4-4" />
            </svg>
          </button>
        )}
      </div>

      {historyOpen && history.length > 0 && (
        <div className="border border-border/50 rounded-lg overflow-hidden">
          <div className="px-3 py-2 bg-muted/30 border-b border-border/50">
            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Histórico de versões</p>
          </div>
          <div className="divide-y divide-border/30 max-h-72 overflow-y-auto">
            {history.map(entry => (
              <div key={entry.id} className="px-3 py-2.5 flex items-start gap-3 hover:bg-muted/20 transition-colors">
                <div className="flex-1 min-w-0">
                  <p className="text-[11px] text-muted-foreground/70 font-mono leading-relaxed truncate">
                    {entry.soul_content.slice(0, 90).replace(/\n/g, ' ')}{entry.soul_content.length > 90 ? '…' : ''}
                  </p>
                  <p className="text-[10px] text-muted-foreground/40 mt-0.5">
                    {timeAgoSoul(entry.edited_at)} · por {entry.edited_by}
                  </p>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    onClick={() => setDiffEntry(diffEntry?.id === entry.id ? null : entry)}
                    className="text-[10px] px-2 py-1 rounded border border-border/50 text-muted-foreground hover:text-foreground hover:border-border transition-colors"
                  >
                    {diffEntry?.id === entry.id ? 'Ocultar' : 'Ver'}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleRestore(entry)}
                    disabled={restoring === entry.id}
                    className="text-[10px] px-2 py-1 rounded border border-primary/30 text-primary/70 hover:text-primary hover:border-primary/60 transition-colors disabled:opacity-50"
                  >
                    {restoring === entry.id ? '…' : 'Restaurar'}
                  </button>
                </div>
              </div>
            ))}
          </div>
          {diffEntry && (
            <div className="border-t border-border/50 bg-muted/10 p-3">
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-2">
                Versão de {timeAgoSoul(diffEntry.edited_at)}
              </p>
              <pre className="text-xs font-mono text-muted-foreground/80 whitespace-pre-wrap break-words max-h-48 overflow-y-auto leading-relaxed">
                {diffEntry.soul_content}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Specialty options ────────────────────────────────────────────────────────

const SPECIALTY_OPTIONS = [
  { value: '', label: 'Sem especialidade' },
  { value: 'orchestrator', label: 'Orquestrador' },
  { value: 'backend', label: 'Backend' },
  { value: 'frontend', label: 'Frontend' },
  { value: 'fullstack', label: 'Fullstack' },
  { value: 'devops', label: 'DevOps / Infra' },
  { value: 'qa', label: 'QA / Testes' },
  { value: 'data', label: 'Dados / Analytics' },
  { value: 'security', label: 'Segurança' },
  { value: 'product', label: 'Produto' },
  { value: 'design', label: 'Design / UX' },
  { value: 'mobile', label: 'Mobile' },
  { value: 'ai', label: 'IA / ML' },
]

function deriveSpecialty(role: string): string {
  const r = role.toLowerCase()
  if (r.includes('orchestrat') || r.includes('orquestra') || r.includes('coordinator') || r.includes('coordena')) return 'orchestrator'
  if (r.includes('frontend') || r.includes('front-end') || r.includes('react') || r.includes('vue') || r.includes('angular') || r.includes('ui ')) return 'frontend'
  if (r.includes('backend') || r.includes('back-end') || r.includes('api') || r.includes('server')) return 'backend'
  if (r.includes('fullstack') || r.includes('full-stack') || r.includes('full stack')) return 'fullstack'
  if (r.includes('devops') || r.includes('infra') || r.includes('docker') || r.includes('kubernetes') || r.includes('k8s') || r.includes('cloud') || r.includes('deploy')) return 'devops'
  if (r.includes('qa') || r.includes('test') || r.includes('qualidade') || r.includes('quality')) return 'qa'
  if (r.includes('data') || r.includes('analytic') || r.includes('analítica') || r.includes('bi ') || r.includes('business intel')) return 'data'
  if (r.includes('security') || r.includes('segurança') || r.includes('sec ') || r.includes('pentest')) return 'security'
  if (r.includes('product') || r.includes('produto') || r.includes('pm ') || r.includes('owner')) return 'product'
  if (r.includes('design') || r.includes('ux') || r.includes('ui/ux')) return 'design'
  if (r.includes('mobile') || r.includes('ios') || r.includes('android') || r.includes('react native') || r.includes('flutter')) return 'mobile'
  if (r.includes('ai') || r.includes('ml') || r.includes('machine learn') || r.includes('llm') || r.includes('ia ')) return 'ai'
  return ''
}

// ─── Tag input helper ─────────────────────────────────────────────────────────

function TagInput({ tags, onChange, placeholder }: { tags: string[]; onChange: (t: string[]) => void; placeholder: string }) {
  const [input, setInput] = useState('')
  const add = () => {
    const v = input.trim()
    if (v && !tags.includes(v)) onChange([...tags, v])
    setInput('')
  }
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5 min-h-[28px]">
        {tags.map((t) => (
          <span key={t} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary/10 border border-primary/20 text-xs text-primary">
            {t}
            <button
              type="button"
              onClick={() => onChange(tags.filter(x => x !== t))}
              className="text-primary/60 hover:text-primary leading-none"
            >×</button>
          </span>
        ))}
      </div>
      <div className="flex gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add() } }}
          placeholder={placeholder}
          className="flex-1 px-3 py-1.5 bg-surface-1 border border-border rounded text-sm text-foreground focus:border-primary/50 focus:ring-1 focus:ring-primary/50 focus:outline-none"
        />
        <button
          type="button"
          onClick={add}
          className="px-3 py-1.5 rounded border border-border text-muted-foreground hover:text-foreground hover:border-primary/50 text-sm transition-colors"
        >+</button>
      </div>
    </div>
  )
}

// ─── Persona Tab ──────────────────────────────────────────────────────────────

function PersonaTab({
  agent,
  onSaved,
}: {
  agent: Agent & { model?: string; instructions?: string; config?: any }
  onSaved: (patch: Partial<Agent>) => void
}) {
  const existingPersona = (() => {
    try {
      const cfg = typeof agent.config === 'string' ? JSON.parse(agent.config) : agent.config
      return cfg?.persona ?? {}
    } catch { return {} }
  })()

  const specialty = existingPersona.specialty ?? deriveSpecialty(agent.role ?? '')
  const [capabilities, setCapabilities] = useState<string[]>(existingPersona.capabilities ?? [])
  const [authorityLevel, setAuthorityLevel] = useState<string>(existingPersona.authority_level ?? '')
  const [restrictions, setRestrictions] = useState<string[]>(existingPersona.restrictions ?? [])
  const [collaborators, setCollaborators] = useState<string[]>(existingPersona.collaborators ?? [])
  const [saving, setSaving] = useState(false)
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null)

  const handleSave = async () => {
    setSaving(true)
    try {
      const persona = {
        specialty,
        capabilities,
        authority_level: authorityLevel,
        restrictions,
        collaborators,
      }
      const res = await fetch(`/api/agents/${agent.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gateway_config: { persona }, write_to_gateway: false }),
      })
      if (!res.ok) throw new Error((await res.json()).error || 'Erro ao salvar')
      const existingCfg = (() => {
        try { return typeof agent.config === 'string' ? JSON.parse(agent.config) : (agent.config ?? {}) } catch { return {} }
      })()
      onSaved({ config: JSON.stringify({ ...existingCfg, persona }) } as any)
      setFeedback({ ok: true, text: 'Persona salva com sucesso' })
    } catch (err: any) {
      setFeedback({ ok: false, text: err.message || 'Erro ao salvar' })
    } finally {
      setSaving(false)
      setTimeout(() => setFeedback(null), 3000)
    }
  }

  const specialtyLabel = SPECIALTY_OPTIONS.find(o => o.value === specialty)?.label ?? specialty ?? 'Sem especialidade'

  return (
    <div className="p-6 space-y-6">

      {/* Especialidade — pré-preenchida e desabilitada */}
      <div className="space-y-1.5">
        <label className="block text-sm font-medium text-foreground">Especialidade</label>
        <p className="text-xs text-muted-foreground">Papel técnico deste agente no squad.</p>
        <div className="relative">
          <select
            value={specialty}
            disabled
            className="w-full px-3 py-2 bg-surface-1 border border-border rounded text-foreground text-sm appearance-none opacity-70 cursor-not-allowed"
          >
            {SPECIALTY_OPTIONS.map(o => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          <div className="pointer-events-none absolute inset-y-0 right-2 flex items-center">
            <svg className="w-4 h-4 text-muted-foreground/50" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M4 6l4 4 4-4" />
            </svg>
          </div>
        </div>
        <p className="text-[11px] text-muted-foreground/60">Derivada do role do agente. Altere o role na aba Overview para mudar.</p>
      </div>

      {/* Capacidades */}
      <div className="space-y-1.5">
        <label className="block text-sm font-medium text-foreground">Capacidades</label>
        <p className="text-xs text-muted-foreground">O que este agente sabe fazer. Adicione uma por vez e pressione Enter.</p>
        <TagInput
          tags={capabilities}
          onChange={setCapabilities}
          placeholder="ex.: Implementar APIs REST"
        />
      </div>

      {/* Nível de autoridade */}
      <div className="space-y-1.5">
        <label className="block text-sm font-medium text-foreground">Nível de autoridade</label>
        <p className="text-xs text-muted-foreground">O que este agente pode decidir de forma autônoma, sem aprovação humana.</p>
        <textarea
          value={authorityLevel}
          onChange={(e) => setAuthorityLevel(e.target.value)}
          rows={3}
          placeholder="ex.: Pode criar branches, escrever testes e abrir PRs. Não pode aprovar merges em main nem fazer deploy."
          className="w-full px-3 py-2 bg-surface-1 border border-border rounded text-foreground focus:border-primary/50 focus:ring-1 focus:ring-primary/50 focus:outline-none text-sm resize-y"
        />
      </div>

      {/* Restrições */}
      <div className="space-y-1.5">
        <label className="block text-sm font-medium text-foreground">Restrições</label>
        <p className="text-xs text-muted-foreground">O que este agente NÃO deve fazer. Adicione uma por vez e pressione Enter.</p>
        <TagInput
          tags={restrictions}
          onChange={setRestrictions}
          placeholder="ex.: Não modificar arquivos de configuração de produção"
        />
      </div>

      {/* Agentes colaboradores */}
      <div className="space-y-1.5">
        <label className="block text-sm font-medium text-foreground">Agentes colaboradores</label>
        <p className="text-xs text-muted-foreground">Nomes de outros agentes com os quais este colabora diretamente.</p>
        <TagInput
          tags={collaborators}
          onChange={setCollaborators}
          placeholder="ex.: dev-agent"
        />
      </div>

      <div className="flex items-center gap-3 pt-1">
        <Button onClick={handleSave} disabled={saving} size="sm">
          {saving ? 'Salvando...' : 'Salvar persona'}
        </Button>
        {feedback && (
          <span className={`text-xs font-medium ${feedback.ok ? 'text-green-400' : 'text-red-400'}`}>
            {feedback.text}
          </span>
        )}
      </div>

      <div className="rounded-md border border-border/50 bg-surface-1/50 px-4 py-3 text-xs text-muted-foreground space-y-1">
        <p className="font-medium text-foreground/70">Como a persona é aplicada no fluxo:</p>
        <ol className="list-decimal list-inside space-y-0.5 ml-1">
          <li>Instrução da coluna (pipeline) — prioridade absoluta no prompt do usuário</li>
          <li>System prompt do agente (Instruções / soul)</li>
          <li>Persona: nome, autoridade, restrições e capacidades — enriquece o system prompt</li>
        </ol>
      </div>
    </div>
  )
}

export default AgentSquadPanelPhase3
