'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, AreaChart, Area, CartesianGrid,
} from 'recharts'

// ── Types ─────────────────────────────────────────────────────────────────────
interface Agent {
  id: number; name: string; role: string
  status: 'busy' | 'idle' | 'offline' | 'error'
  last_activity?: string | null; last_seen?: number | null
}
interface CardRun {
  id: number; card_key: string; card_title: string; card_url: string
  provider: string
  status: 'running' | 'waiting_input' | 'done' | 'failed' | 'cancelled'
  current_stage_id: string; updated_at: number; created_at: number
  cost_usd?: number | null
  run_count?: number | null
}
interface Activity {
  id: number; type: string; description: string; created_at: number; actor?: string
}
interface TokenSummary {
  total_cost: number; total_tokens: number; agent_count: number
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function formatCost(usd: number): string {
  if (usd === 0) return '$0.00'
  if (usd < 0.001) return '< $0.001'
  if (usd < 0.01) return `$${usd.toFixed(4)}`
  if (usd < 1) return `$${usd.toFixed(3)}`
  return `$${usd.toFixed(2)}`
}

function timeAgo(ts: number): string {
  const d = Math.floor(Date.now() / 1000) - ts
  if (d < 60) return 'agora'
  if (d < 3600) return `${Math.floor(d / 60)}m`
  if (d < 86400) return `${Math.floor(d / 3600)}h`
  return `${Math.floor(d / 86400)}d`
}

function initials(name: string) {
  return name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()
}

const AVATAR_COLORS = [
  'from-violet-500 to-indigo-500', 'from-sky-500 to-cyan-400',
  'from-emerald-500 to-teal-400', 'from-orange-500 to-amber-400',
  'from-rose-500 to-pink-400', 'from-fuchsia-500 to-purple-400',
]
function avatarColor(name: string) {
  let h = 0; for (const c of name) h = (h * 31 + c.charCodeAt(0)) & 0xffff
  return AVATAR_COLORS[h % AVATAR_COLORS.length]
}

const NOISE_PATTERNS = [/marked offline/i, /no heartbeat/i, /heartbeat/i, /pipeline engine: polled/i, /All agents healthy/i]
function isNoise(desc: string) { return NOISE_PATTERNS.some(p => p.test(desc)) }

// ── Chart colours ─────────────────────────────────────────────────────────────
const CHART_COLORS = {
  done:      '#34d399',
  running:   '#f59e0b',
  failed:    '#f87171',
  cancelled: '#6b7280',
  waiting:   '#60a5fa',
  idle:      '#38bdf8',
  busy:      '#34d399',
  offline:   '#4b5563',
  cost:      '#a78bfa',
}

// ── Sub-components ────────────────────────────────────────────────────────────
function Avatar({ agent, size = 32 }: { agent: Agent; size?: number }) {
  const dot = { busy: 'bg-emerald-400 animate-pulse', idle: 'bg-sky-400', error: 'bg-red-400', offline: 'bg-zinc-500' }[agent.status]
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <div className={`w-full h-full rounded-full bg-gradient-to-br ${avatarColor(agent.name)} flex items-center justify-center`}>
        <span className="text-white font-bold" style={{ fontSize: size * 0.33 }}>{initials(agent.name)}</span>
      </div>
      <span className={`absolute bottom-0 right-0 w-2 h-2 rounded-full border-2 border-card ${dot}`} />
    </div>
  )
}

function StatCard({ label, value, sub, accent, pulse }: {
  label: string; value: string | number; sub: string; accent: string; pulse?: boolean
}) {
  return (
    <div className="rounded-xl border border-border/60 bg-card px-4 py-4 flex flex-col gap-1">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60">{label}</p>
      <div className="flex items-end gap-2">
        <p className={`text-3xl font-black leading-none ${accent}`}>{value}</p>
        {pulse && <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse mb-1" />}
      </div>
      <p className="text-[10px] text-muted-foreground/50 leading-tight">{sub}</p>
    </div>
  )
}

const CustomTooltip = ({ active, payload, label, prefix = '' }: any) => {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2 text-xs shadow-lg">
      <p className="text-muted-foreground mb-1">{label}</p>
      {payload.map((p: any, i: number) => (
        <p key={i} style={{ color: p.color }} className="font-semibold">{prefix}{p.value}</p>
      ))}
    </div>
  )
}

// ── Main ──────────────────────────────────────────────────────────────────────
export function OverviewPanel() {
  const [agents, setAgents]   = useState<Agent[]>([])
  const [runs,   setRuns]     = useState<CardRun[]>([])
  const [acts,   setActs]     = useState<Activity[]>([])
  const [tokens, setTokens]   = useState<TokenSummary>({ total_cost: 0, total_tokens: 0, agent_count: 0 })
  const [loading, setLoading] = useState(true)
  const [ts, setTs]           = useState(Date.now())

  const load = useCallback(async () => {
    const [ar, rr, acr, tokr] = await Promise.allSettled([
      fetch('/api/agents').then(r => r.ok ? r.json() : {}),
      fetch('/api/pipeline/engine/runs?limit=500').then(r => r.ok ? r.json() : {}),
      fetch('/api/activities?limit=80').then(r => r.ok ? r.json() : {}),
      fetch('/api/tokens/by-agent?timeframe=month').then(r => r.ok ? r.json() : {}),
    ])
    if (ar.status === 'fulfilled') setAgents(ar.value.agents ?? [])
    if (rr.status === 'fulfilled') setRuns(rr.value.runs ?? [])
    if (acr.status === 'fulfilled') {
      const d = acr.value
      const all: Activity[] = Array.isArray(d) ? d : (d.activities ?? [])
      setActs(all.filter(a => !isNoise(a.description ?? '')))
    }
    if (tokr.status === 'fulfilled') setTokens(tokr.value.summary ?? { total_cost: 0, total_tokens: 0, agent_count: 0 })
    setLoading(false)
    setTs(Date.now())
  }, [])

  useEffect(() => { load() }, [load])
  useEffect(() => { const iv = setInterval(load, 20000); return () => clearInterval(iv) }, [load])

  // ── Derived data ────────────────────────────────────────────────────────────
  const busy    = agents.filter(a => a.status === 'busy')
  const idle    = agents.filter(a => a.status === 'idle')
  const offline = agents.filter(a => a.status === 'offline')

  const activeRuns = runs.filter(r => r.status === 'running' || r.status === 'waiting_input')
  const now = Date.now() / 1000

  const totalCostAllTime = runs.reduce((s, r) => s + (r.cost_usd ?? 0), 0)
  const totalCostFromTokens = tokens.total_cost ?? 0
  const totalCost = Math.max(totalCostAllTime, totalCostFromTokens)

  const doneRuns     = runs.filter(r => r.status === 'done')
  const failedRuns   = runs.filter(r => r.status === 'failed')
  const uniqueCards  = new Set(runs.map(r => r.card_key)).size

  // Rework: cards that were restarted at least once (run_count > 1)
  const reworkCards  = runs.filter(r => (r.run_count ?? 1) > 1)
  const reworkRate   = uniqueCards > 0 ? (reworkCards.length / uniqueCards) * 100 : 0
  const totalRestarts = runs.reduce((s, r) => s + Math.max(0, (r.run_count ?? 1) - 1), 0)

  // Donut: run status breakdown
  const runStatusCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const r of runs) counts[r.status] = (counts[r.status] ?? 0) + 1
    return Object.entries(counts).map(([name, value]) => ({ name, value }))
  }, [runs])

  // Bar chart: runs per day (last 14 days)
  const runsPerDay = useMemo(() => {
    const days: { day: string; concluídos: number; falhas: number }[] = []
    for (let i = 13; i >= 0; i--) {
      const dayStart = now - (i + 1) * 86400
      const dayEnd   = now - i * 86400
      const dayRuns  = runs.filter(r => r.created_at >= dayStart && r.created_at < dayEnd)
      const label    = new Date(dayEnd * 1000).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
      days.push({
        day: label,
        concluídos: dayRuns.filter(r => r.status === 'done').length,
        falhas:     dayRuns.filter(r => r.status === 'failed').length,
      })
    }
    return days
  }, [runs, now])

  // Area chart: activity per hour (last 24h)
  const activityByHour = useMemo(() => {
    const hours: { hora: string; eventos: number }[] = []
    for (let i = 23; i >= 0; i--) {
      const hourStart = now - (i + 1) * 3600
      const hourEnd   = now - i * 3600
      const count     = acts.filter(a => a.created_at >= hourStart && a.created_at < hourEnd).length
      const label     = new Date(hourEnd * 1000).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
      hours.push({ hora: label, eventos: count })
    }
    return hours
  }, [acts, now])

  // Bar chart: runs per agent (by provider/card)
  const runsByProvider = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const r of runs) {
      const key = r.provider === 'jira' ? 'JIRA' : r.provider === 'azure_devops' ? 'Azure' : r.provider
      counts[key] = (counts[key] ?? 0) + 1
    }
    return Object.entries(counts).map(([provedor, cards]) => ({ provedor, cards }))
  }, [runs])

  const systemStatus = activeRuns.length > 0 || busy.length > 0
    ? 'OPERACIONAL' : offline.length > agents.length / 2 && agents.length > 0
    ? 'DEGRADADO' : 'EM ESPERA'
  const systemColor = systemStatus === 'OPERACIONAL'
    ? 'text-emerald-400 border-emerald-500/30 bg-emerald-500/5'
    : systemStatus === 'DEGRADADO'
    ? 'text-amber-400 border-amber-500/30 bg-amber-500/5'
    : 'text-sky-400 border-sky-500/30 bg-sky-500/5'

  if (loading) return (
    <div className="flex items-center gap-2 p-10 text-muted-foreground text-sm">
      <span className="w-4 h-4 rounded-full border-2 border-primary border-t-transparent animate-spin" />
      Carregando…
    </div>
  )

  const DONUT_COLORS_RUN: Record<string, string> = {
    done: CHART_COLORS.done, running: CHART_COLORS.running,
    failed: CHART_COLORS.failed, cancelled: CHART_COLORS.cancelled,
    waiting_input: CHART_COLORS.waiting,
  }
const STATUS_PT: Record<string, string> = {
    done: 'Concluído', running: 'Executando', failed: 'Falhou',
    cancelled: 'Cancelado', waiting_input: 'Aguardando',
    in_progress: 'Em andamento', pending: 'Pendente',
    assigned: 'Atribuído', blocked: 'Bloqueado',
  }

  return (
    <div className="flex flex-col gap-4 p-4 md:p-5 h-full">

      {/* ── Header ── */}
      <div className="flex items-center justify-between gap-3 shrink-0">
        <div className="flex items-center gap-3">
          <h2 className="text-base font-bold text-foreground">Visão Geral</h2>
          <span className={`text-[10px] font-bold px-2.5 py-1 rounded-full border tracking-widest ${systemColor}`}>
            ● {systemStatus}
          </span>
          <span className="text-[10px] text-muted-foreground/40">
            atualizado {timeAgo(Math.floor(ts / 1000))} atrás
          </span>
        </div>
        <button
          onClick={load}
          className="text-[11px] px-3 py-1.5 rounded-lg border border-border/50 text-muted-foreground hover:text-foreground hover:border-border transition-colors shrink-0"
        >
          ↻ Atualizar
        </button>
      </div>

      {/* ── KPI row ── */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3 shrink-0">
        <StatCard
          label="Custo Total"
          value={formatCost(totalCost)}
          sub={tokens.total_tokens > 0 ? `${(tokens.total_tokens / 1000).toFixed(1)}K tokens` : 'tokens não registrados'}
          accent="text-violet-400"
        />
        <StatCard
          label="Taxa de Retrabalho"
          value={`${reworkRate.toFixed(0)}%`}
          sub={reworkCards.length > 0 ? `${reworkCards.length} card${reworkCards.length !== 1 ? 's' : ''} reiniciado${reworkCards.length !== 1 ? 's' : ''} · ${totalRestarts} vez${totalRestarts !== 1 ? 'es' : ''}` : 'Nenhum retrabalho'}
          accent={reworkRate === 0 ? 'text-emerald-400' : reworkRate < 30 ? 'text-amber-400' : 'text-red-400'}
        />
        <StatCard
          label="Agentes Online"
          value={busy.length + idle.length}
          sub={busy.length > 0 ? `${busy.length} trabalhando agora` : 'Todos disponíveis'}
          accent={busy.length > 0 ? 'text-emerald-400' : 'text-sky-400'}
          pulse={busy.length > 0}
        />
        <StatCard
          label="Cards Ativos"
          value={activeRuns.length}
          sub={activeRuns.length > 0 ? activeRuns.map(r => r.card_key).join(', ') : 'Nenhum em execução'}
          accent={activeRuns.length > 0 ? 'text-amber-400' : 'text-muted-foreground'}
          pulse={activeRuns.length > 0}
        />
        <StatCard
          label="Cards Únicos"
          value={uniqueCards}
          sub={`${runs.length} execuções no total`}
          accent="text-sky-400"
        />
        <StatCard
          label="Concluídos"
          value={doneRuns.length}
          sub={failedRuns.length > 0 ? `${failedRuns.length} com falha` : 'Sem falhas'}
          accent={doneRuns.length > 0 ? 'text-emerald-400' : 'text-muted-foreground'}
        />
        <StatCard
          label="Atividades (24h)"
          value={acts.filter(a => now - a.created_at < 86400).length}
          sub={`${acts.length} no total`}
          accent="text-fuchsia-400"
        />
      </div>

      {/* ── Charts row 1 ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 min-h-0 flex-1">

        {/* Cards por dia — bar */}
        <div className="lg:col-span-2 rounded-xl border border-border/60 bg-card p-4 flex flex-col">
          <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-3 shrink-0">
            Cards por dia — últimos 14 dias
          </p>
          <div className="flex-1 min-h-0" style={{ minHeight: 160 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={runsPerDay} barCategoryGap="30%" margin={{ top: 4, right: 4, left: -24, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                <XAxis dataKey="day" tick={{ fontSize: 9, fill: '#6b7280' }} tickLine={false} axisLine={false} interval={1} />
                <YAxis tick={{ fontSize: 9, fill: '#6b7280' }} tickLine={false} axisLine={false} allowDecimals={false} />
                <Tooltip content={<CustomTooltip />} />
                <Bar dataKey="concluídos" fill={CHART_COLORS.done}    radius={[3,3,0,0]} maxBarSize={20} />
                <Bar dataKey="falhas"     fill={CHART_COLORS.failed}  radius={[3,3,0,0]} maxBarSize={20} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="flex items-center gap-4 mt-2 shrink-0">
            <span className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
              <span className="w-2 h-2 rounded-sm" style={{ background: CHART_COLORS.done }} /> Concluídos
            </span>
            <span className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
              <span className="w-2 h-2 rounded-sm" style={{ background: CHART_COLORS.failed }} /> Falhas
            </span>
          </div>
        </div>

        {/* Donut: status dos cards */}
        <div className="rounded-xl border border-border/60 bg-card p-4 flex flex-col">
          <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-1 shrink-0">
            Status dos cards
          </p>
          {runStatusCounts.length === 0 ? (
            <p className="text-xs text-muted-foreground/40 text-center my-auto">Nenhum card ainda</p>
          ) : (
            <div className="flex-1 min-h-0 flex flex-col" style={{ minHeight: 140 }}>
              <ResponsiveContainer width="100%" height="70%">
                <PieChart>
                  <Pie
                    data={runStatusCounts} dataKey="value" cx="50%" cy="50%"
                    innerRadius="55%" outerRadius="80%" paddingAngle={2} strokeWidth={0}
                  >
                    {runStatusCounts.map((entry, i) => (
                      <Cell key={i} fill={DONUT_COLORS_RUN[entry.name] ?? '#6b7280'} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(v: number, n: string) => [v, STATUS_PT[n] ?? n]} />
                </PieChart>
              </ResponsiveContainer>
              <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2 shrink-0">
                {runStatusCounts.map((e, i) => (
                  <span key={i} className="flex items-center gap-1 text-[10px] text-muted-foreground">
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ background: DONUT_COLORS_RUN[e.name] ?? '#6b7280' }} />
                    {STATUS_PT[e.name] ?? e.name}: <strong className="text-foreground">{e.value}</strong>
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Charts row 2 ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 shrink-0">

        {/* Atividade por hora */}
        <div className="lg:col-span-2 rounded-xl border border-border/60 bg-card p-4 flex flex-col">
          <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-3 shrink-0">
            Atividade nas últimas 24 horas
          </p>
          <div style={{ height: 110 }}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={activityByHour} margin={{ top: 4, right: 4, left: -24, bottom: 0 }}>
                <defs>
                  <linearGradient id="gradAct" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor="#a78bfa" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#a78bfa" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                <XAxis dataKey="hora" tick={{ fontSize: 8, fill: '#6b7280' }} tickLine={false} axisLine={false} interval={5} />
                <YAxis tick={{ fontSize: 9, fill: '#6b7280' }} tickLine={false} axisLine={false} allowDecimals={false} />
                <Tooltip content={<CustomTooltip />} />
                <Area type="monotone" dataKey="eventos" stroke="#a78bfa" strokeWidth={1.5} fill="url(#gradAct)" dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Cards por provedor */}
        <div className="rounded-xl border border-border/60 bg-card p-4 flex flex-col">
          <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-3 shrink-0">
            Cards por provedor
          </p>
          {runsByProvider.length === 0 ? (
            <p className="text-xs text-muted-foreground/40 text-center my-auto">Nenhum card processado</p>
          ) : (
            <div style={{ height: 110 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={runsByProvider} layout="vertical" margin={{ top: 0, right: 8, left: 0, bottom: 0 }}>
                  <XAxis type="number" tick={{ fontSize: 9, fill: '#6b7280' }} tickLine={false} axisLine={false} allowDecimals={false} />
                  <YAxis type="category" dataKey="provedor" tick={{ fontSize: 9, fill: '#6b7280' }} tickLine={false} axisLine={false} width={60} />
                  <Tooltip content={<CustomTooltip />} />
                  <Bar dataKey="cards" fill="#818cf8" radius={[0,3,3,0]} maxBarSize={12} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>

      {/* ── Bottom row: Agentes + Atividade recente ── */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4 shrink-0">

        {/* Agentes */}
        <div className="lg:col-span-2 rounded-xl border border-border/60 bg-card overflow-hidden">
          <div className="px-4 py-3 border-b border-border/40 flex items-center justify-between">
            <h3 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Agentes</h3>
            <div className="flex items-center gap-2 text-[10px] text-muted-foreground/50">
              {busy.length > 0 && <span className="text-emerald-400 font-semibold">{busy.length} ativo{busy.length > 1 ? 's' : ''}</span>}
              <span>{idle.length} {idle.length !== 1 ? 'disponíveis' : 'disponível'}</span>
              {offline.length > 0 && <span>{offline.length} offline</span>}
            </div>
          </div>
          <div className="overflow-y-auto max-h-48">
            {agents.length === 0 && (
              <p className="text-xs text-muted-foreground/40 text-center py-6">Nenhum agente cadastrado</p>
            )}
            {[...busy, ...idle, ...offline].map(a => (
              <div key={a.id} className={`flex items-center gap-3 px-4 py-2.5 border-b border-border/20 last:border-0 ${a.status === 'offline' ? 'opacity-40' : ''}`}>
                <Avatar agent={a} size={28} />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-foreground truncate">{a.name}</p>
                  <p className="text-[10px] text-muted-foreground/60 truncate">
                    {a.status === 'busy' && a.last_activity ? a.last_activity : a.role}
                  </p>
                </div>
                <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full border shrink-0 ${
                  a.status === 'busy'   ? 'text-emerald-400 bg-emerald-400/10 border-emerald-500/30' :
                  a.status === 'idle'  ? 'text-sky-400 bg-sky-400/10 border-sky-500/30' :
                  a.status === 'error' ? 'text-red-400 bg-red-400/10 border-red-500/30' :
                                         'text-zinc-500 bg-zinc-500/10 border-zinc-600/30'
                }`}>
                  {a.status === 'busy' ? 'ATIVO' : a.status === 'idle' ? 'LIVRE' : a.status === 'error' ? 'ERRO' : 'OFF'}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Atividade recente */}
        <div className="lg:col-span-3 rounded-xl border border-border/60 bg-card overflow-hidden">
          <div className="px-4 py-3 border-b border-border/40 flex items-center justify-between">
            <h3 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Atividade Recente</h3>
            <span className="text-[10px] text-muted-foreground/40">{acts.length} eventos</span>
          </div>
          {acts.length === 0
            ? <p className="text-xs text-muted-foreground/40 text-center py-6">Sem atividade relevante</p>
            : (
              <div className="overflow-y-auto max-h-48 divide-y divide-border/20">
                {acts.slice(0, 12).map((a, i) => (
                  <div key={a.id ?? i} className="flex items-start gap-3 px-4 py-2.5">
                    <span className="w-1 h-1 rounded-full bg-fuchsia-400/40 mt-2 shrink-0" />
                    <p className="flex-1 text-xs text-foreground/70 leading-relaxed">{a.description}</p>
                    <span className="text-[10px] text-muted-foreground/35 shrink-0 whitespace-nowrap pt-0.5">{timeAgo(a.created_at)}</span>
                  </div>
                ))}
              </div>
            )}
        </div>

      </div>
    </div>
  )
}
