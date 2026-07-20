'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Loader } from '@/components/ui/loader'
import { useMissionControl } from '@/store'
import { createClientLogger } from '@/lib/client-logger'
import {
  PieChart, Pie, Cell, LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer, BarChart, Bar,
} from 'recharts'

const log = createClientLogger('CostTracker')

// ── Types ──────────────────────────────────────────

interface TokenStats {
  totalTokens: number; totalCost: number; requestCount: number
  avgTokensPerRequest: number; avgCostPerRequest: number
}

interface CardRunRaw {
  id: number; card_key: string; card_title: string; provider: string
  status: string; cost_usd: number | null; created_at: number; updated_at: number
  run_count?: number | null; llm_models?: string | null
}

interface CardStoryCost {
  card_key: string; card_title: string; provider: string
  runs: number; run_count: number; total_cost: number; last_run: number; llm_models: string
}

interface UsageStats {
  summary: TokenStats
  models: Record<string, { totalTokens: number; totalCost: number; requestCount: number }>
  sessions: Record<string, { totalTokens: number; totalCost: number; requestCount: number }>
  timeframe: string
  recordCount: number
}

interface TrendData {
  trends: Array<{ timestamp: string; tokens: number; cost: number; requests: number }>
  timeframe: string
}

interface ByAgentModelBreakdown {
  model: string; input_tokens: number; output_tokens: number; request_count: number; cost: number
}

interface ByAgentEntry {
  agent: string; total_input_tokens: number; total_output_tokens: number
  total_tokens: number; total_cost: number; session_count: number
  request_count: number; last_active: string; models: ByAgentModelBreakdown[]
}

interface ByAgentResponse {
  agents: ByAgentEntry[]
  summary: { total_cost: number; total_tokens: number; agent_count: number; days: number }
}

interface TaskCostEntry {
  taskId: number; title: string; status: string; priority: string
  assignedTo?: string | null
  project: { id?: number | null; name?: string | null; slug?: string | null; ticketRef?: string | null }
  stats: TokenStats
  models: Record<string, TokenStats>
}

interface TaskCostsResponse {
  summary: TokenStats
  tasks: TaskCostEntry[]
  agents: Record<string, { stats: TokenStats; taskCount: number; taskIds: number[] }>
  unattributed: TokenStats
  timeframe: string
}

interface SessionCostEntry {
  sessionId: string; sessionKey?: string; model: string
  totalTokens: number; inputTokens: number; outputTokens: number
  totalCost: number; requestCount: number; firstSeen: string; lastSeen: string
}

// ── Helpers ──────────────────────────────────────────

const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884d8', '#82ca9d', '#ffc658', '#ff6b6b']

const formatNumber = (num: number) => {
  if (num >= 1_000_000) return (num / 1_000_000).toFixed(1) + 'M'
  if (num >= 1_000) return (num / 1_000).toFixed(1) + 'K'
  return num.toString()
}

const formatCost = (cost: number): string => {
  if (cost === 0) return '$0.00'
  if (cost < 0.001) return '< $0.001'
  if (cost < 0.01) return `$${cost.toFixed(4)}`
  if (cost < 1) return `$${cost.toFixed(3)}`
  return `$${cost.toFixed(2)}`
}

const getModelDisplayName = (name: string) => name.split('/').pop() || name

type View = 'overview' | 'agents' | 'sessions' | 'tasks'
type Timeframe = 'hour' | 'day' | 'week' | 'month'

// ── Main Component ──────────────────────────────────

export function CostTrackerPanel() {
  const t = useTranslations('costTracker')
  const { sessions } = useMissionControl()

  const [view, setView] = useState<View>('overview')
  const [timeframe, setTimeframe] = useState<Timeframe>('day')
  const [chartMode, setChartMode] = useState<'incremental' | 'cumulative'>('incremental')
  const [isLoading, setIsLoading] = useState(false)
  const [isExporting, setIsExporting] = useState(false)

  // Data
  const [usageStats, setUsageStats] = useState<UsageStats | null>(null)
  const [trendData, setTrendData] = useState<TrendData | null>(null)
  const [monthTrend, setMonthTrend] = useState<TrendData | null>(null)
  const [byAgentData, setByAgentData] = useState<ByAgentResponse | null>(null)
  const [taskData, setTaskData] = useState<TaskCostsResponse | null>(null)
  const [cardRuns, setCardRuns] = useState<CardRunRaw[]>([])
  const [sessionCosts, setSessionCosts] = useState<SessionCostEntry[]>([])
  const [sessionSort, setSessionSort] = useState<'cost' | 'tokens' | 'requests' | 'recent'>('cost')
  const [expandedAgent, setExpandedAgent] = useState<string | null>(null)

  const refreshTimer = useRef<ReturnType<typeof setInterval> | null>(null)

  const timeframeToDays = (tf: Timeframe): number => {
    switch (tf) { case 'hour': case 'day': return 1; case 'week': return 7; case 'month': return 30 }
  }

  const loadData = useCallback(async () => {
    setIsLoading(true)
    try {
      const [statsRes, trendRes, monthRes, byAgentRes, taskRes, runsRes] = await Promise.all([
        fetch(`/api/tokens?action=stats&timeframe=${timeframe}`),
        fetch(`/api/tokens?action=trends&timeframe=${timeframe}`),
        fetch(`/api/tokens?action=trends&timeframe=month`),
        fetch(`/api/tokens/by-agent?days=${timeframeToDays(timeframe)}`),
        fetch(`/api/tokens?action=task-costs&timeframe=${timeframe}`),
        fetch(`/api/pipeline/engine/runs?limit=500`),
      ])
      const [statsJson, trendJson, monthJson, byAgentJson, taskJson, runsJson] = await Promise.all([
        statsRes.json(), trendRes.json(), monthRes.json(),
        byAgentRes.json(), taskRes.json(), runsRes.json(),
      ])
      setUsageStats(statsJson)
      setTrendData(trendJson)
      setMonthTrend(monthJson)
      setByAgentData(byAgentJson)
      setTaskData(taskJson)
      setCardRuns(runsJson.runs ?? [])
    } catch (err) {
      log.error('Failed to load cost data:', err)
    } finally {
      setIsLoading(false)
    }
  }, [timeframe])

  const loadSessionCosts = useCallback(async () => {
    try {
      const res = await fetch(`/api/tokens?action=session-costs&timeframe=${timeframe}`)
      const data = await res.json()
      if (Array.isArray(data?.sessions)) {
        setSessionCosts(data.sessions)
      } else if (usageStats?.sessions) {
        setSessionCosts(Object.entries(usageStats.sessions).map(([id, stats]) => ({
          sessionId: id, model: '', totalTokens: stats.totalTokens, inputTokens: 0,
          outputTokens: 0, totalCost: stats.totalCost, requestCount: stats.requestCount,
          firstSeen: '', lastSeen: '',
        })))
      }
    } catch {
      if (usageStats?.sessions) {
        setSessionCosts(Object.entries(usageStats.sessions).map(([id, stats]) => ({
          sessionId: id, model: '', totalTokens: stats.totalTokens, inputTokens: 0,
          outputTokens: 0, totalCost: stats.totalCost, requestCount: stats.requestCount,
          firstSeen: '', lastSeen: '',
        })))
      }
    }
  }, [timeframe, usageStats])

  useEffect(() => { loadData() }, [loadData])
  useEffect(() => {
    refreshTimer.current = setInterval(loadData, 30_000)
    return () => { if (refreshTimer.current) clearInterval(refreshTimer.current) }
  }, [loadData])
  useEffect(() => { if (view === 'sessions') loadSessionCosts() }, [view, loadSessionCosts])

  const exportData = async (format: 'json' | 'csv') => {
    setIsExporting(true)
    try {
      const res = await fetch(`/api/tokens?action=export&timeframe=${timeframe}&format=${format}`)
      if (!res.ok) throw new Error('Export failed')
      const blob = await res.blob()
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.style.display = 'none'; a.href = url
      a.download = `cost-tracker-${timeframe}-${new Date().toISOString().split('T')[0]}.${format}`
      document.body.appendChild(a); a.click()
      window.URL.revokeObjectURL(url); document.body.removeChild(a)
    } catch (err) {
      log.error('Export failed:', err)
    } finally {
      setIsExporting(false)
    }
  }

  // Derived data
  const summary = usageStats?.summary
  const agentSummary = byAgentData?.summary
  const agentList = byAgentData?.agents || []
  const maxAgentCost = Math.max(...agentList.map(a => a.total_cost), 0.0001)

  const getAgentTasks = (agentName: string): TaskCostEntry[] => {
    if (!taskData) return []
    const entry = taskData.agents[agentName]
    if (!entry) return []
    return taskData.tasks.filter(t => entry.taskIds.includes(t.taskId))
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="border-b border-border pb-4">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-3xl font-bold text-foreground">{t('title')}</h1>
            <p className="text-muted-foreground mt-1">{t('subtitle')}</p>
          </div>
          <div className="flex items-center gap-3">
            {/* View tabs */}
            <div className="flex rounded-lg border border-border overflow-hidden">
              {(['overview', 'agents', 'sessions', 'tasks'] as const).map(v => (
                <button
                  key={v}
                  onClick={() => setView(v)}
                  className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                    view === v ? 'bg-primary text-primary-foreground' : 'bg-card text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {v.charAt(0).toUpperCase() + v.slice(1)}
                </button>
              ))}
            </div>
            {/* Timeframe */}
            <div className="flex space-x-1">
              {(['hour', 'day', 'week', 'month'] as const).map(tf => (
                <Button key={tf} onClick={() => setTimeframe(tf)} variant={timeframe === tf ? 'default' : 'secondary'} size="sm">
                  {tf.charAt(0).toUpperCase() + tf.slice(1)}
                </Button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {isLoading && !usageStats ? (
        <Loader variant="panel" label={t('loadingCostData')} />
      ) : view === 'overview' ? (
        <OverviewView
          stats={usageStats} trendData={trendData} monthTrend={monthTrend}
          agentSummary={agentSummary} agentList={agentList}
          taskData={taskData} cardRuns={cardRuns}
          timeframe={timeframe} chartMode={chartMode}
          setChartMode={setChartMode} exportData={exportData} isExporting={isExporting}
          onRefresh={loadData}
        />
      ) : view === 'agents' ? (
        <AgentsView
          agents={agentList} summary={agentSummary} maxCost={maxAgentCost}
          expandedAgent={expandedAgent} setExpandedAgent={setExpandedAgent}
          getAgentTasks={getAgentTasks} onRefresh={loadData}
        />
      ) : view === 'sessions' ? (
        <SessionsView
          sessionCosts={sessionCosts} sessions={sessions}
          sessionSort={sessionSort} setSessionSort={setSessionSort}
        />
      ) : (
        <TasksView taskData={taskData} cardRuns={cardRuns} onRefresh={loadData} />
      )}
    </div>
  )
}

// ── Overview View ──────────────────────────────────

function OverviewView({
  stats, trendData, monthTrend, agentSummary, agentList, taskData, cardRuns,
  timeframe, chartMode, setChartMode, exportData, isExporting, onRefresh,
}: {
  stats: UsageStats | null; trendData: TrendData | null; monthTrend: TrendData | null
  agentSummary: ByAgentResponse['summary'] | undefined; agentList: ByAgentEntry[]
  taskData: TaskCostsResponse | null; cardRuns: CardRunRaw[]
  timeframe: Timeframe; chartMode: 'incremental' | 'cumulative'
  setChartMode: (m: 'incremental' | 'cumulative') => void
  exportData: (f: 'json' | 'csv') => void; isExporting: boolean
  onRefresh: () => void
}) {
  const t = useTranslations('costTracker')

  // ── Custo por modelo ────────────────────────────────────────────────────────
  const modelData = Object.entries(stats?.models ?? {})
    .map(([model, s]) => ({ name: getModelDisplayName(model), fullName: model, tokens: s.totalTokens, cost: s.totalCost, requests: s.requestCount }))
    .sort((a, b) => b.cost - a.cost)
  const pieData = modelData.slice(0, 7).map(m => ({ name: m.name, value: Number(m.cost.toFixed(6)) }))

  // ── Custo mensal (últimos 5 dias) — usa cardRuns como fonte autoritativa ──
  const CHART_DAYS = 5
  const monthlyCostData = (() => {
    const byDay: Record<string, number> = {}
    if (cardRuns.length > 0) {
      const cutoff = Date.now() - CHART_DAYS * 24 * 60 * 60 * 1000
      for (const r of cardRuns) {
        const ts = r.updated_at * 1000
        if (ts < cutoff) continue
        const d = new Date(ts)
        const iso = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
        byDay[iso] = (byDay[iso] || 0) + (r.cost_usd ?? 0)
      }
    }
    const result: { dia: string; custo: number }[] = []
    for (let i = CHART_DAYS - 1; i >= 0; i--) {
      const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000)
      const iso = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
      const dia = d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
      result.push({ dia, custo: Number((byDay[iso] || 0).toFixed(6)) })
    }
    return result
  })()

  // Custo Este Mês — usa cardRuns como fonte autoritativa (mesma fonte dos cards)
  const monthlyCostTotal = (() => {
    if (cardRuns.length > 0) {
      const now = new Date()
      const monthStartSec = new Date(now.getFullYear(), now.getMonth(), 1).getTime() / 1000
      return cardRuns.filter(r => r.updated_at >= monthStartSec).reduce((s, r) => s + (r.cost_usd ?? 0), 0)
    }
    return monthlyCostData.reduce((s, d) => s + d.custo, 0)
  })()

  // ── Custo de hoje — usa cardRuns como fonte autoritativa ────────────────────
  const todayCost = (() => {
    if (cardRuns.length > 0) {
      const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0)
      const todayStartSec = todayStart.getTime() / 1000
      return cardRuns.filter(r => r.updated_at >= todayStartSec).reduce((s, r) => s + (r.cost_usd ?? 0), 0)
    }
    if (!monthTrend?.trends?.length) return 0
    const todayStr = new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
    const entry = monthlyCostData.find(d => d.dia === todayStr)
    return entry?.custo ?? 0
  })()

  // ── Custo por dia/hora (timeframe atual) — usa cardRuns como fonte autoritativa ──
  const dailyCostData = (() => {
    const useHour = timeframe === 'hour' || timeframe === 'day'
    // Aggregate cardRuns by bucket key
    const byBucket: Record<string, number> = {}
    if (cardRuns.length > 0) {
      const now = Date.now()
      let cutoff: number
      switch (timeframe) {
        case 'hour': cutoff = now - 60 * 60 * 1000; break
        case 'day': { const t = new Date(); t.setHours(0,0,0,0); cutoff = t.getTime(); break }
        case 'week': cutoff = now - 7 * 24 * 60 * 60 * 1000; break
        default: cutoff = now - 30 * 24 * 60 * 60 * 1000
      }
      for (const r of cardRuns) {
        const ts = r.updated_at * 1000
        if (ts < cutoff) continue
        const d = new Date(ts)
        const key = useHour
          ? `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}T${String(d.getHours()).padStart(2,'0')}`
          : `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
        byBucket[key] = (byBucket[key] || 0) + (r.cost_usd ?? 0)
      }
    }
    // Build filled timeline (all hours or all days) so chart has no gaps
    const slots: { label: string; custo: number; tokens: number }[] = []
    const now = Date.now()
    if (timeframe === 'hour') {
      // 60 minute slots for last hour
      for (let i = 59; i >= 0; i--) {
        const d = new Date(now - i * 60 * 1000)
        const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}T${String(d.getHours()).padStart(2,'0')}`
        const label = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
        slots.push({ label, custo: Number((byBucket[key] || 0).toFixed(6)), tokens: 0 })
      }
    } else if (timeframe === 'day') {
      // 24 hourly slots for today
      const todayStart = new Date(); todayStart.setHours(0,0,0,0)
      for (let h = 0; h < 24; h++) {
        const d = new Date(todayStart.getTime() + h * 60 * 60 * 1000)
        const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}T${String(d.getHours()).padStart(2,'0')}`
        const label = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
        slots.push({ label, custo: Number((byBucket[key] || 0).toFixed(6)), tokens: 0 })
      }
    } else {
      // Daily slots for week (7) or month (30)
      const days = timeframe === 'week' ? 7 : 30
      for (let i = days - 1; i >= 0; i--) {
        const d = new Date(now - i * 24 * 60 * 60 * 1000)
        const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
        const label = d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
        slots.push({ label, custo: Number((byBucket[key] || 0).toFixed(6)), tokens: 0 })
      }
    }
    if (chartMode === 'cumulative') {
      let acc = 0
      return slots.map(d => { acc += d.custo; return { ...d, custo: Number(acc.toFixed(6)) } })
    }
    return slots
  })()

  // ── Custo por agente ────────────────────────────────────────────────────────
  const agentCostData = agentList
    .filter(a => a.total_cost > 0)
    .sort((a, b) => b.total_cost - a.total_cost)
    .slice(0, 10)
    .map(a => ({
      agente: a.agent.length > 14 ? a.agent.slice(0, 13) + '…' : a.agent,
      custo: Number(a.total_cost.toFixed(6)),
      fullName: a.agent,
    }))

  // ── Custo por história (card_key único) ────────────────────────────────────
  const storyCosts: CardStoryCost[] = (() => {
    const map: Record<string, CardStoryCost> = {}
    for (const r of cardRuns) {
      const cost = r.cost_usd ?? 0
      if (!map[r.card_key]) {
        map[r.card_key] = { card_key: r.card_key, card_title: r.card_title, provider: r.provider, runs: 0, run_count: 0, total_cost: 0, last_run: 0, llm_models: '' }
      }
      map[r.card_key].runs++
      map[r.card_key].run_count = Math.max(map[r.card_key].run_count, r.run_count ?? 1)
      map[r.card_key].total_cost += cost
      if (r.updated_at > map[r.card_key].last_run) map[r.card_key].last_run = r.updated_at
      if (r.llm_models) {
        const modelSet = new Set(map[r.card_key].llm_models ? map[r.card_key].llm_models.split(',') : [])
        r.llm_models.split(',').forEach(m => m && modelSet.add(m))
        map[r.card_key].llm_models = [...modelSet].join(',')
      }
    }
    return Object.values(map).sort((a, b) => b.total_cost - a.total_cost)
  })()

  // Custo total — usa soma dos cards (fonte autoritativa) com fallback para token_usage
  const storyTotalCost = storyCosts.reduce((s, c) => s + c.total_cost, 0)
  const totalCost = storyTotalCost > 0 ? storyTotalCost : (stats?.summary.totalCost ?? 0)
  const totalTokens = stats?.summary.totalTokens ?? 0

  if (!stats && !monthTrend && cardRuns.length === 0) {
    return (
      <div className="text-center text-muted-foreground py-12">
        <div className="text-lg mb-2">{t('noUsageData')}</div>
        <div className="text-sm max-w-sm mx-auto">{t('noUsageDataDesc')}</div>
        <Button onClick={onRefresh} variant="outline" size="sm" className="mt-4 text-xs">{t('refresh')}</Button>
      </div>
    )
  }

  return (
    <div className="space-y-6">

      {/* ── KPI strip ── */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <KpiCard
          label="Custo Total"
          value={formatCost(totalCost)}
          sub={`${formatNumber(totalTokens)} tokens`}
          accent="text-violet-400"
        />
        <KpiCard
          label="Custo Hoje"
          value={formatCost(todayCost)}
          sub={todayCost > 0 ? 'em andamento' : 'sem atividade'}
          accent={todayCost > 0 ? 'text-amber-400' : 'text-muted-foreground'}
        />
        <KpiCard
          label="Custo Este Mês"
          value={formatCost(monthlyCostTotal)}
          sub={`${monthlyCostData.filter(d => d.custo > 0).length} dias com atividade`}
          accent="text-sky-400"
        />
        <KpiCard
          label="Custo por Modelo"
          value={`${modelData.length}`}
          sub={modelData[0] ? `mais usado: ${modelData[0].name}` : 'sem dados'}
          accent="text-emerald-400"
        />
        <KpiCard
          label="Agentes Ativos"
          value={agentSummary?.agent_count ?? agentList.length}
          sub={agentList[0] ? `maior custo: ${agentList[0].agent}` : 'sem agentes'}
          accent="text-fuchsia-400"
        />
        <KpiCard
          label="Histórias"
          value={storyCosts.length}
          sub={`${cardRuns.length} execuções no total`}
          accent="text-orange-400"
        />
      </div>

      {/* ── Custo mensal + Custo por modelo ── */}
      <div className="grid lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 bg-card border border-border rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Custo — Últimos 5 Dias</p>
              <p className="text-2xl font-black text-sky-400 mt-0.5">{formatCost(monthlyCostTotal)}</p>
            </div>
            <div className="flex rounded-md border border-border overflow-hidden">
              {(['incremental', 'cumulative'] as const).map(m => (
                <button key={m} onClick={() => setChartMode(m)}
                  className={`px-2 py-1 text-[10px] font-medium ${chartMode === m ? 'bg-primary text-primary-foreground' : 'bg-card text-muted-foreground hover:text-foreground'}`}
                >{m === 'incremental' ? 'Diário' : 'Acumulado'}</button>
              ))}
            </div>
          </div>
          <div style={{ height: 160 }}>
            {monthlyCostData.length === 0 ? (
              <div className="h-full flex items-center justify-center text-muted-foreground text-sm">Sem dados de custo mensal</div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={monthlyCostData} barCategoryGap="20%" margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                  <XAxis dataKey="dia" tick={{ fontSize: 9, fill: '#6b7280' }} tickLine={false} axisLine={false} interval={0} />
                  <YAxis tick={{ fontSize: 9, fill: '#6b7280' }} tickLine={false} axisLine={false} tickFormatter={v => formatCost(Number(v))} />
                  <Tooltip formatter={(v) => [formatCost(Number(v)), 'Custo']} labelFormatter={(label) => `${label}`} />
                  <Bar dataKey="custo" fill="#38bdf8" radius={[3,3,0,0]} maxBarSize={18} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        <div className="bg-card border border-border rounded-xl p-5">
          <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-1">Custo por Modelo</p>
          {pieData.length === 0 ? (
            <div className="h-40 flex items-center justify-center text-muted-foreground text-sm">Sem dados</div>
          ) : (
            <>
              <div style={{ height: 140 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={pieData} cx="50%" cy="50%" innerRadius="45%" outerRadius="75%" paddingAngle={3} dataKey="value" strokeWidth={0}>
                      {pieData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                    </Pie>
                    <Tooltip formatter={(v) => formatCost(Number(v))} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="space-y-1 mt-1">
                {modelData.map((m, i) => (
                  <div key={m.fullName} className="flex items-center justify-between text-[10px]">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="w-2 h-2 rounded-full shrink-0" style={{ background: COLORS[i % COLORS.length] }} />
                      <span className="text-muted-foreground truncate">{m.name}</span>
                    </div>
                    <span className="font-semibold text-foreground shrink-0 ml-2">{formatCost(m.cost)}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── Custo por dia + Custo por agente ── */}
      <div className="grid lg:grid-cols-2 gap-4">
        <div className="bg-card border border-border rounded-xl p-5">
          <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-3">
            Custo por Dia — {timeframe === 'hour' ? 'última hora' : timeframe === 'day' ? 'hoje' : timeframe === 'week' ? 'últimos 7 dias' : 'últimos 30 dias'}
          </p>
          <div style={{ height: 160 }}>
            {dailyCostData.length === 0 ? (
              <div className="h-full flex items-center justify-center text-muted-foreground text-sm">Sem dados no período</div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={dailyCostData} barCategoryGap="20%" margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                  <XAxis dataKey="label" tick={{ fontSize: 9, fill: '#6b7280' }} tickLine={false} axisLine={false}
                    interval={timeframe === 'day' ? 3 : timeframe === 'hour' ? 9 : timeframe === 'week' ? 0 : 4} />
                  <YAxis tick={{ fontSize: 9, fill: '#6b7280' }} tickLine={false} axisLine={false} tickFormatter={v => formatCost(Number(v))} />
                  <Tooltip formatter={(v) => [formatCost(Number(v)), 'Custo']} labelFormatter={(label) => `${label}`} />
                  <Bar dataKey="custo" fill="#a78bfa" radius={[3,3,0,0]} maxBarSize={20} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        <div className="bg-card border border-border rounded-xl p-5">
          <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-3">Custo por Agente</p>
          {agentCostData.length === 0 ? (
            <div className="h-40 flex items-center justify-center text-muted-foreground text-sm">Sem dados de agentes</div>
          ) : (
            <div style={{ height: 160 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={agentCostData} layout="vertical" margin={{ top: 0, right: 50, left: 0, bottom: 0 }}>
                  <XAxis type="number" tick={{ fontSize: 9, fill: '#6b7280' }} tickLine={false} axisLine={false} tickFormatter={v => `$${v.toFixed(3)}`} />
                  <YAxis type="category" dataKey="agente" tick={{ fontSize: 9, fill: '#6b7280' }} tickLine={false} axisLine={false} width={70} />
                  <Tooltip formatter={(v) => formatCost(Number(v))} />
                  <Bar dataKey="custo" fill="#34d399" radius={[0,3,3,0]} maxBarSize={14}
                    label={{ position: 'right', fontSize: 9, fill: '#9ca3af', formatter: (v: any) => formatCost(Number(v)) }}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>

      {/* ── Custo por história ── */}
      <div className="bg-card border border-border rounded-xl p-5">
        <div className="flex items-center justify-between mb-4">
          <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Custo por História</p>
          <span className="text-[10px] text-muted-foreground">{storyCosts.length} cards únicos</span>
        </div>
        {storyCosts.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-6">Nenhuma história processada ainda</p>
        ) : (
          <div className="space-y-1.5 max-h-72 overflow-y-auto">
            {storyCosts.map((s, i) => {
              const share = totalCost > 0 ? (s.total_cost / totalCost) * 100 : 0
              return (
                <div key={s.card_key} className="flex items-center gap-3 py-1.5 border-b border-border/30 last:border-0">
                  <span className="text-[10px] text-muted-foreground/40 w-4 shrink-0">{i + 1}</span>
                  <span className="font-mono text-xs text-foreground shrink-0 w-20">{s.card_key}</span>
                  <span className="text-xs text-muted-foreground truncate flex-1">{s.card_title}</span>
                  <span
                    title={`Executado ${s.run_count}x no total`}
                    className={`text-[10px] font-semibold shrink-0 px-1.5 py-0.5 rounded-full ${
                      s.run_count <= 1
                        ? 'text-emerald-400 bg-emerald-400/10'
                        : s.run_count <= 3
                        ? 'text-amber-400 bg-amber-400/10'
                        : 'text-red-400 bg-red-400/10'
                    }`}
                  >
                    {s.run_count}x
                  </span>
                  <div className="w-16 hidden md:block shrink-0">
                    <div className="w-full bg-secondary rounded-full h-1">
                      <div className="bg-orange-400 h-1 rounded-full" style={{ width: `${Math.min(share, 100)}%` }} />
                    </div>
                  </div>
                  <span className="text-xs font-semibold text-foreground shrink-0 w-16 text-right">{formatCost(s.total_cost)}</span>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* ── Export ── */}
      <div className="bg-card border border-border rounded-xl p-5">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold">{t('exportData')}</h2>
            <p className="text-xs text-muted-foreground">{t('exportDataDesc')}</p>
          </div>
          <div className="flex gap-2">
            <Button onClick={() => exportData('csv')} disabled={isExporting} size="sm" variant="secondary">{isExporting ? t('exporting') : 'CSV'}</Button>
            <Button onClick={() => exportData('json')} disabled={isExporting} size="sm" variant="secondary">{isExporting ? t('exporting') : 'JSON'}</Button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── KpiCard ────────────────────────────────────────

function KpiCard({ label, value, sub, accent }: {
  label: string; value: string | number; sub: string; accent: string
}) {
  return (
    <div className="rounded-xl border border-border/60 bg-card px-4 py-4 flex flex-col gap-1">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60">{label}</p>
      <p className={`text-2xl font-black leading-none ${accent}`}>{value}</p>
      <p className="text-[10px] text-muted-foreground/50 leading-tight truncate">{sub}</p>
    </div>
  )
}

// ── Agents View ──────────────────────────────────

function AgentsView({
  agents, summary, maxCost, expandedAgent, setExpandedAgent, getAgentTasks, onRefresh,
}: {
  agents: ByAgentEntry[]; summary: ByAgentResponse['summary'] | undefined
  maxCost: number; expandedAgent: string | null
  setExpandedAgent: (a: string | null) => void
  getAgentTasks: (name: string) => TaskCostEntry[]; onRefresh: () => void
}) {
  const t = useTranslations('costTracker')
  const [expandedSection, setExpandedSection] = useState<'models' | 'tasks'>('tasks')

  if (!summary || agents.length === 0) {
    return (
      <div className="text-center text-muted-foreground py-12">
        <div className="text-lg mb-2">{t('noAgentData')}</div>
        <div className="text-sm">{t('noAgentDataDesc')}</div>
        <Button onClick={onRefresh} className="mt-4">{t('refresh')}</Button>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Summary row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-card border border-border rounded-lg p-5">
          <div className="text-3xl font-bold text-foreground">{summary.agent_count}</div>
          <div className="text-sm text-muted-foreground">{t('agents')}</div>
        </div>
        <div className="bg-card border border-border rounded-lg p-5">
          <div className="text-3xl font-bold text-foreground">{formatCost(summary.total_cost)}</div>
          <div className="text-sm text-muted-foreground">{t('totalCostDays', { days: summary.days })}</div>
        </div>
        <div className="bg-card border border-border rounded-lg p-5">
          <div className="text-3xl font-bold text-foreground">{formatNumber(summary.total_tokens)}</div>
          <div className="text-sm text-muted-foreground">{t('totalTokens')}</div>
        </div>
        <div className="bg-card border border-border rounded-lg p-5">
          <div className="text-3xl font-bold text-foreground">
            {summary.total_tokens > 0 ? `$${(summary.total_cost / summary.total_tokens * 1000).toFixed(4)}` : '-'}
          </div>
          <div className="text-sm text-muted-foreground">{t('avgPer1kTokens')}</div>
        </div>
      </div>

      {/* Cost bar chart */}
      <div className="bg-card border border-border rounded-lg p-6">
        <h2 className="text-xl font-semibold mb-4">{t('perAgentCost')}</h2>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={agents.slice(0, 12).map(a => ({
              name: a.agent.length > 12 ? a.agent.slice(0, 11) + '\u2026' : a.agent,
              cost: Number(a.total_cost.toFixed(4)),
            }))}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} /><YAxis tick={{ fontSize: 11 }} />
              <Tooltip formatter={(v) => formatCost(Number(v))} />
              <Bar dataKey="cost" fill="#0088FE" name="Cost ($)" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Agent detail rows */}
      <div className="bg-card border border-border rounded-lg p-6">
        <h2 className="text-xl font-semibold mb-4">{t('agentBreakdown')}</h2>
        <div className="space-y-2 max-h-[600px] overflow-y-auto">
          {agents.map(agent => {
            const costShare = (agent.total_cost / Math.max(summary.total_cost, 0.0001)) * 100
            const isExpanded = expandedAgent === agent.agent
            const agentTasks = getAgentTasks(agent.agent)
            return (
              <div key={agent.agent} className="border border-border rounded-lg overflow-hidden">
                <Button onClick={() => setExpandedAgent(isExpanded ? null : agent.agent)}
                  variant="ghost" className="w-full p-4 h-auto flex items-center justify-between text-left">
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="font-medium text-foreground truncate">{agent.agent}</span>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-secondary text-muted-foreground shrink-0">
                      {agent.session_count} session{agent.session_count !== 1 ? 's' : ''}
                    </span>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-500 shrink-0">
                      {agent.request_count} req{agent.request_count !== 1 ? 's' : ''}
                    </span>
                    {agentTasks.length > 0 && (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-green-500/10 text-green-500 shrink-0">
                        {agentTasks.length} task{agentTasks.length !== 1 ? 's' : ''}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-4 text-sm shrink-0">
                    <div className="w-24 hidden md:block">
                      <div className="w-full bg-secondary rounded-full h-2">
                        <div className="bg-blue-500 h-2 rounded-full" style={{ width: `${(agent.total_cost / maxCost) * 100}%` }} />
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-medium text-foreground">{formatCost(agent.total_cost)}</div>
                      <div className="text-xs text-muted-foreground">{costShare.toFixed(1)}%</div>
                    </div>
                    <div className="text-right">
                      <div className="text-muted-foreground">{formatNumber(agent.total_tokens)}</div>
                      <div className="text-xs text-muted-foreground">{t('tokens')}</div>
                    </div>
                    <svg className={`w-4 h-4 text-muted-foreground transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                      viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                      <polyline points="4,6 8,10 12,6" />
                    </svg>
                  </div>
                </Button>

                {isExpanded && (
                  <div className="px-4 pb-4 border-t border-border bg-secondary/30">
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 pt-3 mb-3">
                      <div><div className="text-xs text-muted-foreground">{t('inputTokens')}</div><div className="text-sm font-medium">{formatNumber(agent.total_input_tokens)}</div></div>
                      <div><div className="text-xs text-muted-foreground">{t('outputTokens')}</div><div className="text-sm font-medium">{formatNumber(agent.total_output_tokens)}</div></div>
                      <div><div className="text-xs text-muted-foreground">{t('ioRatio')}</div><div className="text-sm font-medium">{agent.total_output_tokens > 0 ? (agent.total_input_tokens / agent.total_output_tokens).toFixed(2) : '-'}</div></div>
                      <div><div className="text-xs text-muted-foreground">{t('lastActive')}</div><div className="text-sm font-medium">{new Date(agent.last_active).toLocaleDateString()}</div></div>
                    </div>

                    <div className="flex gap-2 mb-3">
                      <Button variant={expandedSection === 'tasks' ? 'default' : 'ghost'} size="sm" onClick={(e) => { e.stopPropagation(); setExpandedSection('tasks') }}>Tasks ({agentTasks.length})</Button>
                      <Button variant={expandedSection === 'models' ? 'default' : 'ghost'} size="sm" onClick={(e) => { e.stopPropagation(); setExpandedSection('models') }}>Models ({agent.models.length})</Button>
                    </div>

                    {expandedSection === 'tasks' && (
                      <div className="text-sm">
                        {agentTasks.length === 0 ? (
                          <div className="text-xs text-muted-foreground italic py-2">{t('noTaskCosts')}</div>
                        ) : (
                          <div className="space-y-1.5">
                            {agentTasks.map(task => (
                              <div key={task.taskId} className="flex items-center justify-between text-xs">
                                <div className="flex items-center gap-2 min-w-0 flex-1">
                                  <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                                    task.priority === 'critical' ? 'bg-red-500/10 text-red-500' :
                                    task.priority === 'high' ? 'bg-orange-500/10 text-orange-500' :
                                    task.priority === 'medium' ? 'bg-yellow-500/10 text-yellow-500' :
                                    'bg-secondary text-muted-foreground'
                                  }`}>{task.priority}</span>
                                  {task.project.ticketRef && <span className="text-muted-foreground font-mono">{task.project.ticketRef}</span>}
                                  <span className="text-foreground truncate">{task.title}</span>
                                </div>
                                <span className="font-medium text-foreground w-16 text-right shrink-0">{formatCost(task.stats.totalCost)}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    {expandedSection === 'models' && agent.models.length > 0 && (
                      <div className="space-y-1.5">
                        {agent.models.map(m => (
                          <div key={m.model} className="flex items-center justify-between text-xs">
                            <span className="text-muted-foreground truncate">{getModelDisplayName(m.model)}</span>
                            <div className="flex gap-4 shrink-0">
                              <span>{formatNumber(m.input_tokens)} in</span>
                              <span>{formatNumber(m.output_tokens)} out</span>
                              <span>{m.request_count} reqs</span>
                              <span className="font-medium text-foreground w-16 text-right">{formatCost(m.cost)}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ── Sessions View ──────────────────────────────────

function SessionsView({
  sessionCosts, sessions, sessionSort, setSessionSort,
}: {
  sessionCosts: SessionCostEntry[]; sessions: any[]
  sessionSort: 'cost' | 'tokens' | 'requests' | 'recent'
  setSessionSort: (s: 'cost' | 'tokens' | 'requests' | 'recent') => void
}) {
  const t = useTranslations('costTracker')
  const sorted = [...sessionCosts].sort((a, b) => {
    switch (sessionSort) {
      case 'cost': return b.totalCost - a.totalCost
      case 'tokens': return b.totalTokens - a.totalTokens
      case 'requests': return b.requestCount - a.requestCount
      case 'recent': return (b.lastSeen || '').localeCompare(a.lastSeen || '')
      default: return 0
    }
  })

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <span className="text-sm text-muted-foreground">{t('sortBy')}:</span>
        {(['cost', 'tokens', 'requests', 'recent'] as const).map(s => (
          <button key={s} onClick={() => setSessionSort(s)}
            className={`px-2 py-1 text-xs rounded ${sessionSort === s ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground hover:text-foreground'}`}
          >{s.charAt(0).toUpperCase() + s.slice(1)}</button>
        ))}
      </div>

      {sorted.length === 0 ? (
        <div className="text-center text-muted-foreground py-12">
          <p className="text-lg mb-1">{t('noSessionCostData')}</p>
          <p className="text-sm">{t('noSessionCostDataDesc')}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {sorted.map(entry => {
            const sessionInfo = sessions.find((s: any) => s.id === entry.sessionId)
            return (
              <div key={entry.sessionId} className="bg-card border border-border rounded-lg p-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="min-w-0">
                    <div className="font-medium text-foreground truncate">
                      {entry.sessionKey || sessionInfo?.key || entry.sessionId}
                    </div>
                    <div className="text-xs text-muted-foreground flex items-center gap-2">
                      {sessionInfo?.active && <span className="inline-block w-1.5 h-1.5 rounded-full bg-green-500" />}
                      <span>{sessionInfo?.active ? t('activeStatus') : t('inactiveStatus')}</span>
                      {entry.model && <span>| {getModelDisplayName(entry.model)}</span>}
                      {sessionInfo?.kind && <span>| {sessionInfo.kind}</span>}
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <div className="text-lg font-bold text-foreground">{formatCost(entry.totalCost)}</div>
                    <div className="text-xs text-muted-foreground">{formatNumber(entry.totalTokens)} tokens</div>
                  </div>
                </div>
                <div className="grid grid-cols-4 gap-4 text-xs text-muted-foreground border-t border-border/50 pt-2 mt-2">
                  <div><span className="font-medium text-foreground">{entry.requestCount}</span> {t('requests')}</div>
                  <div><span className="font-medium text-foreground">{formatNumber(entry.inputTokens || 0)}</span> {t('inShort')}</div>
                  <div><span className="font-medium text-foreground">{formatNumber(entry.outputTokens || 0)}</span> {t('outShort')}</div>
                  <div>{entry.totalTokens > 0 ? <span className="font-medium text-foreground">{formatCost(entry.totalCost / entry.requestCount)}</span> : '-'} {t('avgPerReq')}</div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── Tasks View ──────────────────────────────────

function TasksView({ taskData, cardRuns, onRefresh }: {
  taskData: TaskCostsResponse | null
  cardRuns: CardRunRaw[]
  onRefresh: () => void
}) {
  const t = useTranslations('costTracker')

  const storyCosts: CardStoryCost[] = (() => {
    const map: Record<string, CardStoryCost> = {}
    for (const r of cardRuns) {
      if (!map[r.card_key]) {
        map[r.card_key] = { card_key: r.card_key, card_title: r.card_title, provider: r.provider, runs: 0, run_count: 0, total_cost: 0, last_run: 0, llm_models: '' }
      }
      map[r.card_key].runs++
      map[r.card_key].run_count = Math.max(map[r.card_key].run_count, r.run_count ?? 1)
      map[r.card_key].total_cost += r.cost_usd ?? 0
      if (r.updated_at > map[r.card_key].last_run) map[r.card_key].last_run = r.updated_at
      if (r.llm_models) {
        const modelSet = new Set(map[r.card_key].llm_models ? map[r.card_key].llm_models.split(',') : [])
        r.llm_models.split(',').forEach(m => m && modelSet.add(m))
        map[r.card_key].llm_models = [...modelSet].join(',')
      }
    }
    return Object.values(map).sort((a, b) => b.total_cost - a.total_cost)
  })()

  const totalCost = storyCosts.reduce((s, c) => s + c.total_cost, 0)
  const reworkCards = storyCosts.filter(s => s.run_count > 1)
  const totalRestarts = storyCosts.reduce((s, c) => s + Math.max(0, c.run_count - 1), 0)
  const reworkRate = storyCosts.length > 0 ? (reworkCards.length / storyCosts.length) * 100 : 0

  if (cardRuns.length === 0) {
    return (
      <div className="text-center text-muted-foreground py-12">
        <div className="text-lg mb-2">{t('noTaskCostData')}</div>
        <div className="text-sm">{t('noTaskCostDataDesc')}</div>
        <Button onClick={onRefresh} variant="outline" size="sm" className="mt-4">{t('refresh')}</Button>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Compact summary strip */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 px-1 pb-4 border-b border-border text-sm">
        <span>
          <span className="font-semibold text-foreground tabular-nums">{storyCosts.length}</span>
          <span className="text-muted-foreground ml-1.5">cards</span>
        </span>
        <span>
          <span className="font-semibold text-foreground tabular-nums">{cardRuns.length}</span>
          <span className="text-muted-foreground ml-1.5">execuções</span>
        </span>
        <span>
          <span className="font-semibold text-violet-400 tabular-nums">{formatCost(totalCost)}</span>
          <span className="text-muted-foreground ml-1.5">custo total</span>
        </span>
        <span>
          <span className={`font-semibold tabular-nums ${reworkCards.length > 0 ? 'text-amber-400' : 'text-emerald-400'}`}>
            {reworkRate.toFixed(0)}%
          </span>
          <span className="text-muted-foreground ml-1.5">
            retrabalho{totalRestarts > 0 ? ` · ${totalRestarts} reinício${totalRestarts !== 1 ? 's' : ''}` : ''}
          </span>
        </span>
      </div>

      {/* Table */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="flex items-center gap-3 px-4 py-2.5 border-b border-border bg-secondary/30 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
          <span className="w-4 shrink-0">#</span>
          <span className="flex-1">Card</span>
          <span className="w-20 text-right shrink-0">Custo</span>
          <span className="w-12 text-center shrink-0">Exec.</span>
          <span className="w-24 text-right shrink-0">Retrabalho</span>
        </div>

        <div className="divide-y divide-border/40">
          {storyCosts.map((s, i) => {
            const reworks = s.run_count - 1
            const models = s.llm_models
              ? [...new Set(s.llm_models.split(',').map(m => getModelDisplayName(m)))].join(' · ')
              : ''
            const lastRunDate = s.last_run > 0
              ? new Date(s.last_run * 1000).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' })
              : ''
            return (
              <div key={s.card_key} className="flex items-center gap-3 px-4 py-3 hover:bg-secondary/20 transition-colors">
                <span className="text-[10px] text-muted-foreground/40 w-4 shrink-0 tabular-nums">{i + 1}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="font-mono text-xs font-semibold text-foreground shrink-0">{s.card_key}</span>
                    <span className="text-xs text-muted-foreground truncate">{s.card_title}</span>
                  </div>
                  {(models || lastRunDate) && (
                    <div className="flex items-center gap-2 mt-0.5">
                      {models && <span className="text-[10px] text-muted-foreground/50 truncate">{models}</span>}
                      {models && lastRunDate && <span className="text-[10px] text-muted-foreground/30">·</span>}
                      {lastRunDate && <span className="text-[10px] text-muted-foreground/40 shrink-0">{lastRunDate}</span>}
                    </div>
                  )}
                </div>
                <span className="text-xs font-semibold tabular-nums w-20 text-right shrink-0 text-foreground">
                  {formatCost(s.total_cost)}
                </span>
                <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full w-12 text-center shrink-0 ${
                  s.run_count <= 1 ? 'text-emerald-400 bg-emerald-400/10'
                  : s.run_count <= 3 ? 'text-amber-400 bg-amber-400/10'
                  : 'text-red-400 bg-red-400/10'
                }`}>
                  {s.run_count}x
                </span>
                <div className="w-24 text-right shrink-0">
                  {reworks === 0 ? (
                    <span className="text-[10px] text-emerald-400 font-medium">Nenhum</span>
                  ) : (
                    <div className="flex flex-col items-end">
                      <span className={`text-xs font-semibold tabular-nums ${reworks <= 2 ? 'text-amber-400' : 'text-red-400'}`}>
                        {reworks} {reworks === 1 ? 'vez' : 'vezes'}
                      </span>
                      <span className="text-[10px] text-muted-foreground">
                        voltou ao início
                      </span>
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
