'use client'

import { useEffect, useState, useCallback } from 'react'

const BRIDGE_URL = 'http://127.0.0.1:3100'

interface HealthComponent {
  score: number
  status: string
  detail: string
}

interface AmyHealth {
  score: number
  status: string
  components: Record<string, HealthComponent>
  timestamp: string
}

interface NeuralStatus {
  last_synced_ref: string
  last_sync: string
  pending_approval: string
  total_synced_files: string
}

interface VaultResult {
  file: string
  title: string
  domain: string
  path: string
  snippet: string
}

interface AmyStatus {
  health: AmyHealth | null
  neurals: NeuralStatus | null
  tasks: { active_count: number } | null
  approvals: { count: number } | null
  error: string | null
  loading: boolean
}

const statusColor = (status: string) => {
  switch (status) {
    case 'healthy': return 'text-emerald-400'
    case 'warning': return 'text-amber-400'
    case 'critical': return 'text-red-400'
    default: return 'text-gray-400'
  }
}

const scoreColor = (score: number) => {
  if (score >= 80) return 'text-emerald-400'
  if (score >= 60) return 'text-amber-400'
  return 'text-red-400'
}

const domainBadgeColor = (domain: string) => {
  const colors: Record<string, string> = {
    'film_production': 'bg-purple-500/20 text-purple-300',
    'business': 'bg-blue-500/20 text-blue-300',
    'operations': 'bg-green-500/20 text-green-300',
    'ai_ml': 'bg-cyan-500/20 text-cyan-300',
    'seo_web': 'bg-yellow-500/20 text-yellow-300',
    'safety_ethics': 'bg-red-500/20 text-red-300',
  }
  return colors[domain] || 'bg-gray-500/20 text-gray-300'
}

export function AmyStatusWidget() {
  const [status, setStatus] = useState<AmyStatus>({
    health: null, neurals: null, tasks: null, approvals: null,
    error: null, loading: true,
  })
  const [vaultQuery, setVaultQuery] = useState('')
  const [vaultResults, setVaultResults] = useState<VaultResult[]>([])
  const [searching, setSearching] = useState(false)

  const fetchStatus = useCallback(async () => {
    try {
      const [healthRes, neuralsRes, tasksRes, approvalsRes] = await Promise.all([
        fetch(`${BRIDGE_URL}/api/health`).then(r => r.json()).catch(() => null),
        fetch(`${BRIDGE_URL}/api/neurals/status`).then(r => r.json()).catch(() => null),
        fetch(`${BRIDGE_URL}/api/tasks`).then(r => r.json()).catch(() => null),
        fetch(`${BRIDGE_URL}/api/approvals`).then(r => r.json()).catch(() => null),
      ])
      setStatus({ health: healthRes, neurals: neuralsRes, tasks: tasksRes, approvals: approvalsRes, error: null, loading: false })
    } catch (e) {
      setStatus(prev => ({ ...prev, error: 'Bridge offline', loading: false }))
    }
  }, [])

  useEffect(() => {
    fetchStatus()
    const interval = setInterval(fetchStatus, 15000) // refresh every 15s
    return () => clearInterval(interval)
  }, [fetchStatus])

  const searchVault = async () => {
    if (!vaultQuery.trim()) return
    setSearching(true)
    try {
      const res = await fetch(`${BRIDGE_URL}/api/vault/search?q=${encodeURIComponent(vaultQuery)}`)
      const data = await res.json()
      setVaultResults(data.results || [])
    } catch {
      setVaultResults([])
    }
    setSearching(false)
  }

  if (status.loading) {
    return (
      <div className="rounded-xl border border-border/50 bg-card/50 p-6">
        <div className="animate-pulse text-muted-foreground text-sm">Connecting to Amy...</div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-foreground">Amy Intelligence</h2>
        <span className="text-xs text-muted-foreground">
          via Bridge :3100 • {status.error ? '❌ Offline' : '🟢 Connected'}
        </span>
      </div>

      {/* Quick Stats Row */}
      <div className="grid grid-cols-4 gap-3">
        <div className="rounded-lg border border-border/50 bg-card/50 p-3">
          <div className="text-xs text-muted-foreground">Health</div>
          <div className={`text-xl font-mono font-bold ${status.health ? scoreColor(status.health.score) : 'text-gray-400'}`}>
            {status.health?.components ? `${Object.values(status.health.components).filter(c => c.status === 'healthy').length}/${Object.keys(status.health.components).length}` : '—'}
          </div>
        </div>
        <div className="rounded-lg border border-border/50 bg-card/50 p-3">
          <div className="text-xs text-muted-foreground">Active Tasks</div>
          <div className="text-xl font-mono font-bold text-foreground">
            {status.tasks?.active_count ?? '—'}
          </div>
        </div>
        <div className="rounded-lg border border-border/50 bg-card/50 p-3">
          <div className="text-xs text-muted-foreground">Pending Approvals</div>
          <div className="text-xl font-mono font-bold text-amber-400">
            {status.approvals?.count ?? '—'}
          </div>
        </div>
        <div className="rounded-lg border border-border/50 bg-card/50 p-3">
          <div className="text-xs text-muted-foreground">Neural Refs</div>
          <div className="text-xl font-mono font-bold text-purple-400">
            {status.neurals?.total_synced_files ?? '—'}
          </div>
        </div>
      </div>

      {/* Health Components */}
      {status.health?.components && (
        <div className="rounded-xl border border-border/50 bg-card/50 p-4">
          <h3 className="text-sm font-medium text-foreground mb-3">System Components</h3>
          <div className="space-y-2">
            {Object.entries(status.health.components).map(([name, comp]) => (
              <div key={name} className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full ${comp.status === 'healthy' ? 'bg-emerald-400' : comp.status === 'warning' ? 'bg-amber-400' : 'bg-red-400'}`} />
                  <span className="text-foreground">{name}</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-muted-foreground">{comp.detail}</span>
                  <span className={`font-mono text-xs ${scoreColor(comp.score)}`}>{comp.score}%</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Neural Status */}
      {status.neurals && (
        <div className="rounded-xl border border-border/50 bg-card/50 p-4">
          <h3 className="text-sm font-medium text-foreground mb-2">Neural Pipeline</h3>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div className="text-muted-foreground">Last Sync</div>
            <div className="text-foreground">{status.neurals.last_sync}</div>
            <div className="text-muted-foreground">Last Ref</div>
            <div className="text-foreground font-mono">{status.neurals.last_synced_ref}</div>
            <div className="text-muted-foreground">Pending</div>
            <div className="text-foreground">{status.neurals.pending_approval}</div>
            <div className="text-muted-foreground">Total Files</div>
            <div className="text-foreground font-mono">{status.neurals.total_synced_files}</div>
          </div>
        </div>
      )}

      {/* Vault Search */}
      <div className="rounded-xl border border-border/50 bg-card/50 p-4">
        <h3 className="text-sm font-medium text-foreground mb-2">Knowledge Search</h3>
        <div className="flex gap-2">
          <input
            type="text"
            value={vaultQuery}
            onChange={(e) => setVaultQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && searchVault()}
            placeholder="Search neural refs & vault..."
            className="flex-1 rounded-lg bg-background/50 border border-border/50 px-3 py-1.5 text-sm text-foreground placeholder-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
          />
          <button
            onClick={searchVault}
            disabled={searching}
            className="px-3 py-1.5 rounded-lg bg-primary/20 text-primary text-sm hover:bg-primary/30 transition-colors"
          >
            {searching ? '...' : '🔍'}
          </button>
        </div>
        {vaultResults.length > 0 && (
          <div className="mt-3 space-y-2 max-h-48 overflow-y-auto">
            {vaultResults.map((r, i) => (
              <div key={i} className="flex items-start gap-2 p-2 rounded-lg bg-background/30 text-sm">
                <span className={`px-1.5 py-0.5 rounded text-xs ${domainBadgeColor(r.domain)}`}>
                  {r.domain}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="text-foreground font-medium truncate">{r.title}</div>
                  <div className="text-xs text-muted-foreground truncate">{r.snippet}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
