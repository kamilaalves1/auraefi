'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Loader } from '@/components/ui/loader'
import { useMissionControl, Agent } from '@/store'
import { buildOfficeLayout } from '@/lib/office-layout'
import { getPortrait } from '@/lib/agent-portraits'

/* ─── helpers ──────────────────────────────────────────────────── */

function hashNum(s: string) {
  let h = 0
  for (let i = 0; i < s.length; i++) h = s.charCodeAt(i) + ((h << 5) - h)
  return Math.abs(h)
}

function getInitials(name: string) {
  return name.split(/[\s_-]+/).filter(Boolean).map(w => w[0]).join('').toUpperCase().slice(0, 2)
}

function formatLastSeen(ts?: number): string {
  if (!ts) return '—'
  const m = Math.floor((Date.now() - ts * 1000) / 60000)
  if (m < 1) return 'agora'
  if (m < 60) return `${m}min atrás`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h atrás`
  return `${Math.floor(h / 24)}d atrás`
}

const HASH_BG = [
  'from-violet-600 to-purple-700', 'from-indigo-600 to-blue-700',
  'from-sky-600 to-cyan-700',      'from-teal-600 to-emerald-700',
  'from-amber-600 to-orange-700',  'from-rose-600 to-pink-700',
]

function avatarBg(name: string) { return HASH_BG[hashNum(name) % HASH_BG.length] }

function isInactiveLocalSession(agent: Agent): boolean {
  return Boolean((agent.config as Record<string, unknown>)?.localSession) && agent.status !== 'busy'
}

interface SessionAgentRow {
  id: string; key: string; agent: string; kind: string; model: string
  active: boolean; lastActivity?: number; workingDir?: string | null
}
function inferLocalRole(row: SessionAgentRow): string {
  const ctx = [row.agent, row.key, row.workingDir].join(' ').toLowerCase()
  if (/frontend|ui|ux/.test(ctx)) return 'frontend-engineer'
  if (/backend|api|ops|deploy/.test(ctx)) return 'ops-engineer'
  if (/qa|test/.test(ctx)) return 'qa-engineer'
  if (/product|pm/.test(ctx)) return 'product-manager'
  return row.kind || 'software-engineer'
}

/* ─── skill mapping ────────────────────────────────────────────── */
function skill(role = ''): { icon: string; label: string; cls: string } {
  const r = role.toLowerCase()
  if (r.includes('orchestrat'))                        return { icon: '🎯', label: 'Orquestração', cls: 'bg-purple-500/15 text-purple-500 border-purple-500/30' }
  if (r.includes('architect'))                         return { icon: '🏗️', label: 'Arquitetura',  cls: 'bg-indigo-500/15 text-indigo-500 border-indigo-500/30' }
  if (r.includes('security') || r.includes('audit'))  return { icon: '🔒', label: 'Segurança',   cls: 'bg-red-500/15 text-red-500 border-red-500/30' }
  if (r.includes('ux') || r.includes('design'))       return { icon: '🎨', label: 'Design',      cls: 'bg-fuchsia-500/15 text-fuchsia-500 border-fuchsia-500/30' }
  if (r.includes('develop') || r.includes('engineer') || r.includes('developer')) return { icon: '💻', label: 'Dev', cls: 'bg-blue-500/15 text-blue-500 border-blue-500/30' }
  if (r.includes('qa') || r.includes('test'))         return { icon: '🧪', label: 'QA',          cls: 'bg-lime-500/15 text-lime-500 border-lime-500/30' }
  if (r.includes('deploy') || r.includes('devops'))   return { icon: '🚀', label: 'Deploy',      cls: 'bg-orange-500/15 text-orange-500 border-orange-500/30' }
  if (r.includes('product') || r.includes('owner'))   return { icon: '📋', label: 'Produto',     cls: 'bg-pink-500/15 text-pink-500 border-pink-500/30' }
  if (r.includes('analyst') || r.includes('business'))return { icon: '📊', label: 'Análise',     cls: 'bg-amber-500/15 text-amber-500 border-amber-500/30' }
  if (r.includes('scrum') || r.includes('master'))    return { icon: '🔄', label: 'Scrum',       cls: 'bg-teal-500/15 text-teal-500 border-teal-500/30' }
  if (r.includes('manager'))                          return { icon: '👔', label: 'Gestão',      cls: 'bg-cyan-500/15 text-cyan-500 border-cyan-500/30' }
  return { icon: '⚙️', label: 'Geral', cls: 'bg-zinc-500/15 text-zinc-400 border-zinc-500/20' }
}

/* ─── flow stage assignment ────────────────────────────────────── */
const STAGES = [
  { id: 'discovery', label: 'Descoberta',  icon: '🔍', grad: 'from-violet-500/20', border: 'border-violet-500/25', head: 'text-violet-500', bar: 'bg-violet-500' },
  { id: 'design',    label: 'Design',      icon: '🎨', grad: 'from-indigo-500/20', border: 'border-indigo-500/25', head: 'text-indigo-500', bar: 'bg-indigo-500' },
  { id: 'dev',       label: 'Dev',         icon: '💻', grad: 'from-blue-500/20',   border: 'border-blue-500/25',   head: 'text-blue-500',   bar: 'bg-blue-500' },
  { id: 'security',  label: 'Segurança',   icon: '🔒', grad: 'from-red-500/20',    border: 'border-red-500/25',    head: 'text-red-500',    bar: 'bg-red-500' },
  { id: 'qa',        label: 'QA',          icon: '🧪', grad: 'from-lime-500/20',   border: 'border-lime-500/25',   head: 'text-lime-500',   bar: 'bg-lime-500' },
  { id: 'deploy',    label: 'Deploy',      icon: '🚀', grad: 'from-orange-500/20', border: 'border-orange-500/25', head: 'text-orange-500', bar: 'bg-orange-500' },
]

function assignStage(agent: Agent): string {
  const r = (agent.role || '').toLowerCase()
  if (r.includes('analyst') || r.includes('product') || r.includes('owner') || r.includes('scrum') || r.includes('business')) return 'discovery'
  if (r.includes('architect') || r.includes('ux') || r.includes('designer') || r.includes('data engineer')) return 'design'
  if (r.includes('security') || r.includes('audit')) return 'security'
  if (r.includes('qa') || r.includes('test')) return 'qa'
  if (r.includes('orchestrat') || r.includes('deploy') || r.includes('devops')) return 'deploy'
  return 'dev'
}

/* ─── status config ─────────────────────────────────────────────── */
const S_DOT: Record<string, string>   = { busy:'bg-emerald-400', idle:'bg-sky-400', error:'bg-red-400', offline:'bg-zinc-400' }
const S_LABEL: Record<string, string> = { busy:'Ativo', idle:'Disponível', error:'Alerta', offline:'Offline' }
const S_RING: Record<string, string>  = { busy:'ring-2 ring-emerald-400/70', idle:'ring-1 ring-border/50', error:'ring-2 ring-red-400/60', offline:'ring-1 ring-border/30' }

/* ─── ThinkingDots ─────────────────────────────────────────────── */
function ThinkingDots() {
  return (
    <span className="inline-flex items-end gap-[3px] ml-1 mb-0.5">
      {[0,1,2].map(i => (
        <span key={i} className="w-1 h-1 rounded-full bg-emerald-400 inline-block"
          style={{ animation: `tdot 1.2s ease-in-out ${i*0.2}s infinite` }} />
      ))}
      <style>{`@keyframes tdot{0%,80%,100%{transform:translateY(0);opacity:.4}40%{transform:translateY(-4px);opacity:1}}`}</style>
    </span>
  )
}

/* ─── Photo avatar ─────────────────────────────────────────────── */
function Photo({ agent, size = 72 }: { agent: Agent; size?: number }) {
  const isBusy = agent.status === 'busy'
  const portrait = getPortrait(agent.name)

  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      {isBusy && <span className="absolute inset-0 rounded-full animate-ping bg-emerald-400/25" style={{ animationDuration: '2.2s' }} />}
      <div className={`rounded-full overflow-hidden ${S_RING[agent.status] ?? ''} bg-muted`} style={{ width: size, height: size }}>
        {portrait ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={portrait} alt={agent.name} width={size} height={size} className="w-full h-full object-cover object-top" />
        ) : (
          <div className={`w-full h-full flex items-center justify-center font-bold text-white text-lg bg-gradient-to-br ${avatarBg(agent.name)}`}>
            {getInitials(agent.name)}
          </div>
        )}
      </div>
      <span className={`absolute bottom-0 right-0 w-3.5 h-3.5 rounded-full border-2 border-card ${S_DOT[agent.status] ?? 'bg-zinc-400'} ${isBusy ? 'animate-pulse' : ''}`} />
    </div>
  )
}

/* ─── TeamCard ──────────────────────────────────────────────────── */
function TeamCard({ agent, ticketRef }: { agent: Agent; ticketRef?: string }) {
  const sk = skill(agent.role)
  const isBusy = agent.status === 'busy'

  return (
    <div className="group rounded-2xl border border-border/60 bg-card overflow-hidden hover:shadow-xl hover:-translate-y-0.5 transition-all duration-200">
      {/* colored top strip */}
      <div className={`h-1.5 w-full bg-gradient-to-r ${avatarBg(agent.name)}`} />

      <div className="p-4 flex flex-col items-center text-center gap-2.5">
        <Photo agent={agent} size={76} />

        <div>
          <p className="font-bold text-foreground text-sm leading-tight">{agent.name}</p>
          {agent.role && <p className="text-[11px] text-muted-foreground mt-0.5 capitalize">{agent.role}</p>}
        </div>

        <div className="flex gap-1.5 flex-wrap justify-center">
          <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${sk.cls}`}>
            {sk.icon} {sk.label}
          </span>
          <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full border flex items-center gap-1 ${isBusy ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20' : 'bg-muted/40 text-muted-foreground border-border/50'}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${S_DOT[agent.status]}`} />
            {S_LABEL[agent.status]}
          </span>
        </div>

        {/* activity bubble */}
        <div className="w-full rounded-xl bg-muted/30 border border-border/40 px-3 py-2 text-left min-h-[48px]">
          {agent.last_activity ? (
            <>
              <p className={`text-[9px] font-semibold uppercase tracking-wider mb-0.5 flex items-center gap-1 ${isBusy ? 'text-emerald-500' : 'text-muted-foreground/40'}`}>
                {isBusy ? <><span className="w-1 h-1 rounded-full bg-emerald-400 animate-pulse" /> Fazendo agora</> : 'Última atividade'}
              </p>
              <p className="text-[11px] text-foreground/75 leading-snug line-clamp-2">
                {agent.last_activity}{isBusy && <ThinkingDots />}
              </p>
            </>
          ) : ticketRef ? (
            <div className="flex flex-col items-center justify-center gap-0.5 mt-1">
              <p className="text-[9px] uppercase tracking-wider text-muted-foreground/35">Aguardando tarefa</p>
              <span className="text-[12px] font-bold text-primary/70 font-mono tracking-tight">{ticketRef}</span>
            </div>
          ) : (
            <p className="text-[11px] text-muted-foreground/35 italic text-center mt-2">
              {isBusy ? 'Processando…' : 'Aguardando tarefa'}
            </p>
          )}
        </div>

        {/* task bar */}
        {agent.taskStats && agent.taskStats.total > 0 && (() => {
          const pct = Math.round(((agent.taskStats.done + agent.taskStats.completed) / agent.taskStats.total) * 100)
          return (
            <div className="w-full space-y-0.5">
              <div className="flex justify-between text-[9px] text-muted-foreground/50">
                <span>{agent.taskStats.in_progress} em andamento</span>
                <span>{pct}%</span>
              </div>
              <div className="h-1 rounded-full bg-border/40 overflow-hidden">
                <div className="h-full rounded-full bg-gradient-to-r from-primary to-primary/60 transition-all duration-700" style={{ width: `${pct}%` }} />
              </div>
            </div>
          )
        })()}

        <p className="text-[9px] text-muted-foreground/35">{formatLastSeen(agent.last_seen ?? undefined)}</p>
      </div>
    </div>
  )
}

/* ─── Role tier ─────────────────────────────────────────────────── */
function roleTier(role = ''): 'orchestrator' | 'strategic' | 'execution' {
  const r = role.toLowerCase()
  if (r.includes('orchestrat')) return 'orchestrator'
  if (r.includes('architect') || r.includes('product owner') || r.includes('scrum') || r.includes('product manager')) return 'strategic'
  return 'execution'
}

const TIER_ORDER: Record<string, number> = { orchestrator: 0, strategic: 1, execution: 2 }
function sortByTier(agents: Agent[]) {
  return [...agents].sort((a, b) => TIER_ORDER[roleTier(a.role)] - TIER_ORDER[roleTier(b.role)])
}

/* ─── Orchestrator hero card ────────────────────────────────────── */
function OrchestratorHero({ agent, ticketRef }: { agent: Agent; ticketRef?: string }) {
  const sk = skill(agent.role)
  const isBusy = agent.status === 'busy'
  return (
    <div className="relative w-full max-w-lg rounded-2xl border-2 border-primary/25 bg-gradient-to-br from-card via-card to-primary/5 shadow-2xl shadow-primary/8 overflow-hidden">
      <div className={`h-2 w-full bg-gradient-to-r ${avatarBg(agent.name)}`} />
      <div className="p-5 flex items-center gap-5">
        <div className="relative shrink-0">
          {isBusy && <span className="absolute inset-0 rounded-full animate-ping bg-emerald-400/20" style={{ animationDuration: '2.4s' }} />}
          <Photo agent={agent} size={88} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 mb-0.5">
            <span className="text-sm">👑</span>
            <p className="font-extrabold text-lg text-foreground tracking-tight">{agent.name}</p>
          </div>
          <p className="text-sm text-muted-foreground capitalize mb-2.5">{agent.role}</p>
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${sk.cls}`}>
              {sk.icon} {sk.label}
            </span>
            <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full border flex items-center gap-1 ${isBusy ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20' : 'bg-muted/40 text-muted-foreground border-border/50'}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${S_DOT[agent.status]}`} />
              {S_LABEL[agent.status]}{isBusy && <ThinkingDots />}
            </span>
          </div>
        </div>
        <div className="hidden sm:block text-right min-w-[130px] max-w-[180px] shrink-0">
          {agent.last_activity ? (
            <>
              <p className="text-[9px] uppercase tracking-wider text-muted-foreground/35 mb-1">
                {isBusy ? 'Fazendo agora' : 'Última atividade'}
              </p>
              <p className="text-[11px] text-muted-foreground/65 leading-snug line-clamp-3">{agent.last_activity}</p>
            </>
          ) : ticketRef ? (
            <>
              <p className="text-[9px] uppercase tracking-wider text-muted-foreground/35 mb-1">Aguardando tarefa</p>
              <span className="text-[14px] font-bold text-primary/70 font-mono">{ticketRef}</span>
            </>
          ) : null}
        </div>
      </div>
    </div>
  )
}

/* ─── Org node card ─────────────────────────────────────────────── */
function OrgNode({ agent, tier, ticketRef }: { agent: Agent; tier: 'strategic' | 'execution'; ticketRef?: string }) {
  const sk = skill(agent.role)
  const st = STAGES.find(s => s.id === assignStage(agent))
  const isBusy = agent.status === 'busy'
  const isSt = tier === 'strategic'

  return (
    <div className={`rounded-xl border bg-card overflow-hidden transition-all hover:shadow-lg hover:-translate-y-0.5 ${isBusy ? 'border-emerald-500/30 shadow-md shadow-emerald-500/5' : 'border-border/60'} ${isSt ? 'w-40' : 'w-32'}`}>
      <div className={`bg-gradient-to-r ${avatarBg(agent.name)} ${isSt ? 'h-1.5' : 'h-1'}`} />
      <div className={`flex flex-col items-center text-center ${isSt ? 'p-3 gap-2' : 'p-2.5 gap-1.5'}`}>
        <Photo agent={agent} size={isSt ? 56 : 44} />
        <div>
          <p className={`font-bold text-foreground leading-tight ${isSt ? 'text-xs' : 'text-[11px]'}`}>{agent.name}</p>
          {agent.role && (
            <p className={`text-muted-foreground capitalize truncate max-w-full ${isSt ? 'text-[10px] mt-0.5' : 'text-[9px]'}`}>{agent.role}</p>
          )}
        </div>
        <div className="flex flex-wrap justify-center gap-1">
          <span className={`font-semibold px-1.5 py-0.5 rounded-full border ${sk.cls} ${isSt ? 'text-[9px]' : 'text-[8px]'}`}>
            {sk.icon} {sk.label}
          </span>
          {st && (
            <span className={`px-1.5 py-0.5 rounded-full border font-medium ${st.border} ${st.head} ${isSt ? 'text-[9px]' : 'text-[8px]'}`}>
              {st.icon} {st.label}
            </span>
          )}
        </div>
        <span className={`flex items-center gap-1 px-1.5 py-0.5 rounded-full border font-medium ${isBusy ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20' : 'bg-muted/40 text-muted-foreground border-border/50'} ${isSt ? 'text-[9px]' : 'text-[8px]'}`}>
          <span className={`w-1 h-1 rounded-full ${S_DOT[agent.status]}`} />
          {S_LABEL[agent.status]}
        </span>
        {isBusy && agent.last_activity ? (
          <p className={`text-muted-foreground/55 truncate w-full leading-snug ${isSt ? 'text-[9px]' : 'text-[8px]'}`}>
            {agent.last_activity}<ThinkingDots />
          </p>
        ) : ticketRef ? (
          <span className={`font-bold text-primary/65 font-mono ${isSt ? 'text-[10px]' : 'text-[9px]'}`}>{ticketRef}</span>
        ) : null}
      </div>
    </div>
  )
}

/* ─── Org connector label ───────────────────────────────────────── */
function OrgConnector({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center">
      <div className="w-px h-5 bg-border/40" />
      <div className="flex items-center gap-2 text-[9px] uppercase tracking-[0.18em] text-muted-foreground/30 py-0.5">
        <div className="h-px w-8 bg-border/25" />{label}<div className="h-px w-8 bg-border/25" />
      </div>
      <div className="w-px h-4 bg-border/40" />
    </div>
  )
}

/* ─── FlowView (org chart) ──────────────────────────────────────── */
function FlowView({ agents, tickets }: { agents: Agent[]; tickets: Map<string, string> }) {
  const orchestrator = useMemo(() => agents.find(a => roleTier(a.role) === 'orchestrator'), [agents])
  const strategic    = useMemo(() => agents.filter(a => roleTier(a.role) === 'strategic'), [agents])
  const execution    = useMemo(() => agents.filter(a => roleTier(a.role) === 'execution'), [agents])

  return (
    <div className="flex flex-col items-center gap-0 w-full">

      {/* ── Nível 0: Orquestrador ─────────────────── */}
      {orchestrator && <OrchestratorHero agent={orchestrator} ticketRef={tickets.get(orchestrator.name.toLowerCase())} />}

      {/* ── Conector orch → estratégico ──────────── */}
      {orchestrator && strategic.length > 0 && <OrgConnector label="coordena" />}

      {/* ── Nível 1: Estratégico ──────────────────── */}
      {strategic.length > 0 && (
        <div className="relative flex justify-center gap-4">
          {strategic.length > 1 && (
            <div
              className="absolute top-0 h-px bg-border/30"
              style={{
                width: `${(strategic.length - 1) * 176}px`,
                left: '50%',
                transform: 'translateX(-50%)',
              }}
            />
          )}
          {strategic.map(a => (
            <div key={a.id} className="flex flex-col items-center">
              <div className="w-px h-4 bg-border/35" />
              <OrgNode agent={a} tier="strategic" ticketRef={tickets.get(a.name.toLowerCase())} />
            </div>
          ))}
        </div>
      )}

      {/* ── Conector estratégico → execução ──────── */}
      {execution.length > 0 && <OrgConnector label="executa" />}

      {/* ── Nível 2: Execução ─────────────────────── */}
      {execution.length > 0 && (
        <div className="relative flex justify-center gap-3 flex-wrap max-w-4xl w-full">
          {execution.length > 1 && (
            <div className="absolute top-0 h-px bg-border/20"
              style={{ width: `${(execution.length - 1) * 140}px`, left: '50%', transform: 'translateX(-50%)' }} />
          )}
          {execution.map(a => (
            <div key={a.id} className="flex flex-col items-center">
              <div className="w-px h-3 bg-border/25" />
              <OrgNode agent={a} tier="execution" ticketRef={tickets.get(a.name.toLowerCase())} />
            </div>
          ))}
        </div>
      )}

      {/* ── Fallback sem orquestrador ─────────────── */}
      {!orchestrator && (
        <div className="flex justify-center gap-3 flex-wrap max-w-4xl w-full">
          {agents.map(a => (
            <OrgNode key={a.id} agent={a}
              tier={roleTier(a.role) === 'strategic' ? 'strategic' : 'execution'}
              ticketRef={tickets.get(a.name.toLowerCase())} />
          ))}
        </div>
      )}

      {/* ── Ticker de atividade ───────────────────── */}
      <div className="w-full mt-6">
        <ActivityTicker agents={agents} />
      </div>
    </div>
  )
}

/* ─── Activity ticker ───────────────────────────────────────────── */
function ActivityTicker({ agents }: { agents: Agent[] }) {
  const busy = agents.filter(a => a.status === 'busy' && a.last_activity)
  if (busy.length === 0) return null

  const items = [...busy, ...busy, ...busy] // triple for seamless loop

  return (
    <div className="rounded-xl border border-border/40 bg-muted/20 overflow-hidden">
      <div className="flex items-center gap-3 px-3 py-2 border-b border-border/30">
        <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse shrink-0" />
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">Atividade em tempo real</span>
      </div>
      <div className="relative overflow-hidden h-8">
        <div
          className="absolute flex items-center gap-8 h-full whitespace-nowrap"
          style={{ animation: `tickerScroll ${busy.length * 6}s linear infinite` }}
        >
          {items.map((a, i) => (
            <span key={i} className="flex items-center gap-2 text-[11px] text-muted-foreground/70 shrink-0">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              <span className="font-semibold text-foreground/80">{a.name}</span>
              <span className="text-muted-foreground/40">·</span>
              <span>{a.last_activity}</span>
            </span>
          ))}
        </div>
        <style>{`@keyframes tickerScroll { from { transform: translateX(0); } to { transform: translateX(-33.33%); } }`}</style>
      </div>
    </div>
  )
}

/* ─── Pipeline Animation ────────────────────────────────────────── */
function pipelineOrder(role = ''): number {
  const r = role.toLowerCase()
  if (r.includes('orchestrat')) return -1
  if (r.includes('develop') || r.includes('engineer')) return 0
  if (r.includes('qa') || r.includes('test')) return 1
  if (r.includes('architect')) return 2
  return 3
}

function PipelineAnimation({ agents, tickets }: { agents: Agent[]; tickets: Map<string, string> }) {
  // Pipeline agents sorted by role order (exclude orchestrators)
  const pipeline = useMemo(() =>
    [...agents]
      .filter(a => pipelineOrder(a.role) >= 0)
      .sort((a, b) => pipelineOrder(a.role) - pipelineOrder(b.role)),
    [agents]
  )

  // Real-time step: index of currently busy agent (-1 = none)
  const currentStep = useMemo(() =>
    pipeline.findIndex(a => a.status === 'busy'),
    [pipeline]
  )

  const hasActivity = currentStep >= 0
  const activeAgent = hasActivity ? pipeline[currentStep] : null
  const ticketRef = activeAgent ? tickets.get(activeAgent.name.toLowerCase()) : undefined

  // Only show agents up to current step (done + active), not future waiting ones
  const visible = hasActivity ? pipeline.slice(0, currentStep + 1) : []
  const total = pipeline.length

  if (!hasActivity) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-3 text-muted-foreground/40">
        <div className="text-5xl">⏳</div>
        <p className="text-sm font-medium">Aguardando próximo card JIRA…</p>
        <p className="text-xs">O pipeline aparece aqui quando um agente começar a trabalhar</p>
      </div>
    )
  }

  // Progress pct: from JIRA (5%) to last done agent (relative to total)
  const progressPct = 5 + (currentStep / Math.max(total - 1, 1)) * 82

  return (
    <div className="w-full flex flex-col gap-8 py-4">

      {/* live badge + ticket */}
      <div className="flex items-center gap-3">
        <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-[10px] font-bold text-emerald-500 uppercase tracking-widest">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
          Ao vivo
        </span>
        {ticketRef && (
          <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-blue-500/10 border border-blue-500/20 text-[10px] font-mono font-bold text-blue-400">
            📋 {ticketRef}
          </span>
        )}
        <span className="text-xs text-muted-foreground/50">
          {activeAgent?.name} trabalhando…
        </span>
      </div>

      {/* track */}
      <div className="relative w-full" style={{ minHeight: 220 }}>
        {/* grey base line */}
        <div className="absolute top-[52px] h-px bg-border/20 z-0" style={{ left: '6%', right: '6%' }} />
        {/* green progress line */}
        <div
          className="absolute top-[51px] h-0.5 z-0 transition-all duration-1000 ease-in-out"
          style={{
            left: '6%',
            background: 'linear-gradient(90deg, #10b981, #6366f1)',
            width: `${progressPct}%`,
          }}
        />

        {/* JIRA source node */}
        <div className="absolute left-0 top-0 flex flex-col items-center z-10" style={{ width: '7%' }}>
          <div className="w-12 h-12 rounded-xl flex items-center justify-center text-xl border-2 border-blue-500/60 bg-blue-500/10 shadow-lg shadow-blue-500/15">
            📋
          </div>
          <span className="text-[9px] font-bold uppercase tracking-widest mt-2 text-blue-400/70">JIRA</span>
          <span className="text-[8px] text-blue-400/50 mt-0.5 animate-pulse">ativo</span>
        </div>

        {/* agent nodes — only done + active */}
        <div className="flex justify-around" style={{ paddingLeft: '10%', paddingRight: '10%' }}>
          {/* render all pipeline slots to keep spacing, but render visible only */}
          {pipeline.map((agent, i) => {
            const isActive = currentStep === i
            const isDone = currentStep > i
            const isHidden = i > currentStep

            if (isHidden) return <div key={agent.id} style={{ minWidth: 110, maxWidth: 150 }} />

            return (
              <div key={agent.id} className="relative flex flex-col items-center gap-2.5 z-10" style={{ minWidth: 110, maxWidth: 150 }}>
                {/* bouncing ticket above active agent */}
                {isActive && (
                  <div
                    className="absolute flex items-center gap-1 px-2 py-0.5 rounded-lg bg-blue-500/15 border border-blue-500/30 text-[9px] font-bold text-blue-400 whitespace-nowrap"
                    style={{ top: -28, left: '50%', transform: 'translateX(-50%)', animation: 'bounce 2s ease-in-out infinite' }}
                  >
                    📋 {ticketRef || 'card'}
                  </div>
                )}

                {/* photo */}
                <div className={`relative transition-all duration-700 ${isActive ? 'scale-[1.15]' : 'scale-100'}`}>
                  <Photo agent={agent} size={64} />
                  {isDone && (
                    <span className="absolute -bottom-0.5 -right-0.5 w-5 h-5 rounded-full bg-emerald-500 border-2 border-background flex items-center justify-center text-[9px] font-bold text-white z-20">✓</span>
                  )}
                </div>

                {/* name + role */}
                <div className="text-center">
                  <p className={`text-xs font-bold transition-colors duration-500 ${isActive ? 'text-emerald-400' : 'text-foreground/60'}`}>
                    {agent.name}
                  </p>
                  <p className={`text-[9px] capitalize ${isActive ? 'text-muted-foreground/60' : 'text-muted-foreground/35'}`}>{agent.role}</p>
                </div>

                {/* activity bubble */}
                <div className={`w-full rounded-xl border px-2.5 py-2 min-h-[44px] flex items-center justify-center text-center transition-all duration-700 ${isActive ? 'border-emerald-500/30 bg-emerald-500/8' : 'border-border/20 bg-muted/8'}`}>
                  {isActive ? (
                    <p className="text-[10px] text-emerald-400 leading-snug line-clamp-2">
                      {agent.last_activity || 'Processando…'}<ThinkingDots />
                    </p>
                  ) : (
                    <p className="text-[10px] text-muted-foreground/40 font-medium">✓ Aprovado</p>
                  )}
                </div>
              </div>
            )
          })}
        </div>

        {/* GitHub merge node — dim until all done */}
        <div className="absolute right-0 top-0 flex flex-col items-center z-10" style={{ width: '7%' }}>
          <div className="w-12 h-12 rounded-xl flex items-center justify-center text-xl border-2 border-border/25 bg-card/60 opacity-30">
            🔀
          </div>
          <span className="text-[9px] font-bold uppercase tracking-widest mt-2 text-muted-foreground/30">Main</span>
        </div>
      </div>

      {/* progress bar */}
      <div className="w-full space-y-1.5">
        <div className="flex justify-between text-[10px] text-muted-foreground/40">
          <span className="font-medium">Etapa {currentStep + 1} de {total}</span>
          <span>{Math.round(((currentStep + 1) / total) * 100)}% concluído</span>
        </div>
        <div className="h-1.5 rounded-full bg-border/25 overflow-hidden">
          <div
            className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-indigo-400 transition-all duration-1000"
            style={{ width: `${((currentStep + 1) / total) * 100}%` }}
          />
        </div>
      </div>

      <style>{`@keyframes bounce{0%,100%{transform:translateX(-50%) translateY(0)}50%{transform:translateX(-50%) translateY(-6px)}}`}</style>
    </div>
  )
}

/* ─── Main panel ────────────────────────────────────────────────── */
export function OfficePanel() {
  const t = useTranslations('office')
  const { agents, dashboardMode } = useMissionControl()
  const isLocalMode = dashboardMode === 'local'
  const [localAgents, setLocalAgents] = useState<Agent[]>([])
  const [sessionAgents, setSessionAgents] = useState<Agent[]>([])
  const [viewMode, setViewMode] = useState<'team' | 'flow' | 'anim'>('team')
  const [loading, setLoading] = useState(true)
  const [localBootstrapping, setLocalBootstrapping] = useState(isLocalMode)
  const [search, setSearch] = useState('')
  const [activeOnly, setActiveOnly] = useState(false)
  const [agentTickets, setAgentTickets] = useState<Map<string, string>>(new Map())

  const fetchAgents = useCallback(async () => {
    try {
      const [agentRes, sessionRes, taskRes] = await Promise.all([
        fetch('/api/agents'),
        isLocalMode ? fetch('/api/sessions') : Promise.resolve(null),
        fetch('/api/tasks?status=assigned&limit=200'),
      ])
      if (agentRes.ok) {
        const data = await agentRes.json()
        setLocalAgents(Array.isArray(data.agents) ? data.agents : [])
      }
      if (taskRes.ok) {
        const taskData = await taskRes.json().catch(() => ({}))
        const tasks: Array<{ assigned_to?: string; ticket_ref?: string; project_prefix?: string; project_ticket_no?: number }> =
          Array.isArray(taskData.tasks) ? taskData.tasks : []
        const map = new Map<string, string>()
        for (const task of tasks) {
          const name = (task.assigned_to || '').trim().toLowerCase()
          if (!name) continue
          const ref = task.ticket_ref || (task.project_prefix && task.project_ticket_no ? `${task.project_prefix}-${task.project_ticket_no}` : '')
          if (ref && !map.has(name)) map.set(name, ref)
        }
        setAgentTickets(map)
      }
      if (isLocalMode && sessionRes?.ok) {
        const json = await sessionRes.json().catch(() => ({}))
        const rows: SessionAgentRow[] = Array.isArray(json?.sessions) ? json.sessions : []
        const byAgent = new Map<string, Agent>()
        let idx = 0
        for (const row of rows) {
          const name = String(row.agent || '').trim()
          if (!name) continue
          const existing = byAgent.get(name)
          const nowSec = Math.floor(Date.now() / 1000)
          const candidate: Agent = {
            id: -5000 - idx++, name, role: inferLocalRole(row),
            status: row.active ? 'busy' : 'idle',
            last_seen: row.lastActivity ? Math.floor(row.lastActivity / 1000) : nowSec,
            last_activity: `${row.kind || 'session'} · ${row.model || ''}`,
            created_at: nowSec, updated_at: nowSec,
            config: { localSession: { sessionId: row.id, key: row.key, workingDir: row.workingDir || null, kind: row.kind } },
          }
          const replace = !existing
            || (existing.status !== 'busy' && candidate.status === 'busy')
            || (existing.status === candidate.status && (candidate.last_seen || 0) > (existing.last_seen || 0))
          if (replace) byAgent.set(name, candidate)
        }
        setSessionAgents(Array.from(byAgent.values()))
      }
    } catch { /* ignore */ }
    setLoading(false)
  }, [isLocalMode])

  useEffect(() => { void fetchAgents() }, [fetchAgents])
  useEffect(() => {
    if (!isLocalMode) { setLocalBootstrapping(false); return }
    setLocalBootstrapping(true)
    const timer = setTimeout(() => setLocalBootstrapping(false), 4500)
    return () => clearTimeout(timer)
  }, [isLocalMode])
  useEffect(() => {
    const iv = setInterval(() => void fetchAgents(), 10000)
    return () => clearInterval(iv)
  }, [fetchAgents])

  const displayAgents = useMemo(() => {
    if (agents.length > 0) return agents
    if (isLocalMode) {
      const merged = new Map<string, Agent>()
      for (const a of [...sessionAgents, ...localAgents]) {
        const k = a.name.trim().toLowerCase(); if (!k) continue
        const ex = merged.get(k)
        const replace = !ex || (ex.status !== 'busy' && a.status === 'busy')
          || (ex.status === a.status && (a.last_seen || 0) > (ex.last_seen || 0))
        if (replace) merged.set(k, a)
      }
      return Array.from(merged.values())
    }
    return localAgents.length > 0 ? localAgents : []
  }, [agents, isLocalMode, localAgents, sessionAgents])

  const visible = useMemo(() =>
    isLocalMode ? displayAgents.filter(a => !isInactiveLocalSession(a)) : displayAgents,
    [displayAgents, isLocalMode])

  const filtered = useMemo(() => {
    let list = visible
    if (activeOnly) list = list.filter(a => a.status === 'busy')
    const q = search.trim().toLowerCase()
    return q ? list.filter(a => a.name.toLowerCase().includes(q) || (a.role || '').toLowerCase().includes(q)) : list
  }, [visible, search, activeOnly])

  const counts = useMemo(() => {
    const c = { busy: 0, idle: 0, error: 0, offline: 0 }
    for (const a of visible) c[a.status as keyof typeof c]++
    return c
  }, [visible])

  // suppress unused warning — buildOfficeLayout is kept for potential future zone grouping
  void buildOfficeLayout

  if ((loading || (isLocalMode && localBootstrapping)) && visible.length === 0) {
    return <Loader variant="panel" label={t('loadingOffice')} />
  }

  return (
    <div className="p-6 space-y-5 max-w-[1600px] mx-auto">

      {/* header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">{t('title')}</h1>
          <p className="text-sm text-muted-foreground mt-0.5">{t('subtitle')}</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {counts.busy > 0    && <Chip color="emerald" label={`${counts.busy} ativo${counts.busy > 1?'s':''}`} pulse />}
          {counts.idle > 0    && <Chip color="sky"     label={`${counts.idle} disponível${counts.idle!==1?'is':''}`} />}
          {counts.error > 0   && <Chip color="red"     label={`${counts.error} alerta${counts.error!==1?'s':''}`} pulse />}
          {counts.offline > 0 && <Chip color="zinc"    label={`${counts.offline} offline`} />}
          <span className="h-5 w-px bg-border mx-1" />
          {/* active-only toggle */}
          <button
            onClick={() => setActiveOnly(v => !v)}
            className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border font-medium transition-all ${
              activeOnly
                ? 'bg-emerald-500/15 text-emerald-500 border-emerald-500/30 shadow-sm shadow-emerald-500/10'
                : 'bg-card text-muted-foreground border-border hover:text-foreground'
            }`}
          >
            <span className={`w-1.5 h-1.5 rounded-full ${activeOnly ? 'bg-emerald-400 animate-pulse' : 'bg-muted-foreground/40'}`} />
            Apenas ativos
          </button>

          <div className="flex rounded-lg border border-border overflow-hidden text-xs">
            {(['team', 'flow', 'anim'] as const).map(v => (
              <button key={v} onClick={() => setViewMode(v)}
                className={`px-3 py-1.5 font-medium transition-colors ${viewMode===v ? 'bg-primary text-primary-foreground' : 'bg-card text-muted-foreground hover:text-foreground'}`}>
                {v === 'team' ? '👥 Equipe' : v === 'flow' ? '⚡ Fluxo' : '🎬 Pipeline'}
              </button>
            ))}
          </div>
          <Button variant="ghost" size="sm" onClick={() => void fetchAgents()}>↺</Button>
        </div>
      </div>

      {/* search */}
      <div className="relative w-56">
        <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/40 text-sm pointer-events-none">🔍</span>
        <input type="search" placeholder="Buscar agente ou função…" value={search}
          onChange={e => setSearch(e.target.value)}
          className="h-9 pl-8 pr-3 text-sm rounded-lg border border-border bg-card text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-primary/40 w-full" />
      </div>

      {/* empty */}
      {filtered.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 text-muted-foreground/40">
          <div className="text-5xl mb-4">👥</div>
          <p className="text-sm text-muted-foreground">{search ? 'Nenhum agente encontrado' : t('emptyDeck')}</p>
          <p className="text-xs mt-1">{search ? 'Tente outro termo' : t('emptyDeckSubtitle')}</p>
        </div>
      )}

      {/* team view */}
      {viewMode === 'team' && filtered.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
          {sortByTier(filtered).map(a => (
            <TeamCard key={a.id} agent={a} ticketRef={agentTickets.get(a.name.toLowerCase())} />
          ))}
        </div>
      )}

      {/* flow view */}
      {viewMode === 'flow' && filtered.length > 0 && (
        <FlowView agents={filtered} tickets={agentTickets} />
      )}

      {/* pipeline animation */}
      {viewMode === 'anim' && (
        filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-muted-foreground/40">
            <div className="text-5xl mb-4">🎬</div>
            <p className="text-sm text-muted-foreground">Nenhum agente para animar</p>
          </div>
        ) : (
          <div className="rounded-2xl border border-border/50 bg-card/50 p-8">
            <div className="mb-6">
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/50">Simulação</p>
              <h2 className="text-lg font-bold text-foreground mt-0.5">Jornada de uma história pelo pipeline</h2>
              <p className="text-xs text-muted-foreground mt-1">Veja como um card percorre cada agente até o merge na main.</p>
            </div>
            <PipelineAnimation agents={filtered} tickets={agentTickets} />
          </div>
        )
      )}
    </div>
  )
}

/* ─── Chip ──────────────────────────────────────────────────────── */
function Chip({ color, label, pulse }: { color: string; label: string; pulse?: boolean }) {
  const cls: Record<string,string> = {
    emerald:'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20',
    sky:'bg-sky-500/10 text-sky-600 dark:text-sky-300 border-sky-500/20',
    red:'bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20',
    zinc:'bg-zinc-500/10 text-zinc-500 border-zinc-500/20',
  }
  const dot: Record<string,string> = { emerald:'bg-emerald-400', sky:'bg-sky-400', red:'bg-red-400', zinc:'bg-zinc-400' }
  return (
    <span className={`flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border font-medium ${cls[color]??cls.zinc}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${dot[color]??'bg-zinc-400'} ${pulse?'animate-pulse':''}`} />
      {label}
    </span>
  )
}
