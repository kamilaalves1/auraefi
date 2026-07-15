'use client'

import { useState, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'

// ── Types ─────────────────────────────────────────────────────────────────────

interface Pipeline {
  id: number
  name: string
  provider: 'none' | 'jira' | 'azure_devops'
  enabled: boolean
  config: Record<string, unknown>
  has_credentials: boolean
}

interface GitRepository { id: number; name: string; provider: string; repo_url: string; branch: string }

interface Assignment { role: string; agent_id: number | null; llm_model?: string; repo_id?: number | null }

interface PipelineColumn {
  id?: number
  column_name: string
  column_order: number
  is_trigger: boolean
  assignments: Assignment[]
  instructions: string | null
}

interface Agent { id: number; name: string; role: string }

// ── Constants ─────────────────────────────────────────────────────────────────

const PROVIDERS = {
  jira:         { label: 'Jira',         icon: '🎯', color: 'text-blue-400', bg: 'bg-blue-500/10' },
  azure_devops: { label: 'Azure DevOps', icon: '🔷', color: 'text-sky-400',  bg: 'bg-sky-500/10' },
}

// Models known per provider — only shown when that provider is connected
const PROVIDER_MODELS: Record<string, { value: string; label: string }[]> = {
  anthropic: [
    { value: 'anthropic:claude-haiku-4-5-20251001', label: 'Haiku 4.5 — rápido e barato' },
    { value: 'anthropic:claude-sonnet-4-6',         label: 'Sonnet 4.6 — balanceado' },
    { value: 'anthropic:claude-sonnet-5',           label: 'Sonnet 5 — avançado' },
    { value: 'anthropic:claude-opus-4-8',           label: 'Opus 4.8 — máximo' },
  ],
  openai: [
    { value: 'openai:gpt-4o-mini', label: 'GPT-4o mini — rápido' },
    { value: 'openai:gpt-4o',      label: 'GPT-4o — padrão' },
    { value: 'openai:o1',          label: 'o1 — raciocínio' },
  ],
  openrouter: [{ value: 'openrouter', label: 'OpenRouter' }],
  ollama:     [{ value: 'ollama',     label: 'Ollama (local)' }],
  venice:     [{ value: 'venice',     label: 'Venice AI' }],
  nvidia:     [{ value: 'nvidia',     label: 'NVIDIA' }],
  moonshot:   [{ value: 'moonshot',   label: 'Moonshot / Kimi' }],
}

interface LLMOption { value: string; label: string; provider: string }

function useLLMOptions() {
  const [options, setOptions]   = useState<LLMOption[]>([])
  const [loading, setLoading]   = useState(true)

  useEffect(() => {
    fetch('/api/integrations')
      .then(r => r.ok ? r.json() : { integrations: [] })
      .then((d: { integrations?: Array<{ id: string; name: string; category: string; status: string }> }) => {
        const connected = (d.integrations ?? [])
          .filter(i => i.category === 'ai' && i.status === 'connected')
        const opts: LLMOption[] = []
        for (const prov of connected) {
          const models = PROVIDER_MODELS[prov.id]
          if (models) {
            models.forEach(m => opts.push({ ...m, provider: prov.name }))
          } else {
            opts.push({ value: prov.id, label: prov.name, provider: prov.name })
          }
        }
        setOptions(opts)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  return { options, loading }
}

function useGitRepos() {
  const [repos, setRepos] = useState<GitRepository[]>([])
  useEffect(() => {
    fetch('/api/workspace/git-repositories')
      .then(r => r.ok ? r.json() : { repositories: [] })
      .then(d => setRepos(d.repositories ?? []))
      .catch(() => {})
  }, [])
  return repos
}

// ── Shared styles ──────────────────────────────────────────────────────────────

const lbl = 'block text-xs font-semibold text-foreground/70 mb-1'
const inp = 'w-full h-9 px-3 rounded-lg bg-secondary/50 border border-border text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary/40 focus:border-primary/60 transition-colors'
const sel = 'h-7 px-2 rounded-md bg-secondary/50 border border-border/70 text-xs text-foreground focus:outline-none focus:border-primary/50'

async function parseJson(res: Response) {
  const text = await res.text()
  try { return JSON.parse(text) } catch { return {} }
}

// ── LLM complexity card ───────────────────────────────────────────────────────

function LLMComplexityCard({
  pipelineId,
  config,
  llmOptions,
  llmLoading,
}: {
  pipelineId: number
  config: Record<string, string>
  llmOptions: LLMOption[]
  llmLoading: boolean
}) {
  const [simple,  setSimple]  = useState(config.llm_simple  ?? '')
  const [medium,  setMedium]  = useState(config.llm_medium  ?? '')
  const [complex, setComplex] = useState(config.llm_complex ?? '')
  const [saving,  setSaving]  = useState(false)
  const [msg,     setMsg]     = useState<{ ok: boolean; text: string } | null>(null)

  const handleSave = async () => {
    setSaving(true)
    try {
      const res = await fetch(`/api/workspace/work-pipelines/${pipelineId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config: { llm_simple: simple, llm_medium: medium, llm_complex: complex } }),
      })
      const data = await parseJson(res)
      if (!res.ok) throw new Error(data.error ?? 'Erro ao salvar')
      setMsg({ ok: true, text: 'Salvo' })
    } catch (e: any) {
      setMsg({ ok: false, text: e.message })
    } finally {
      setSaving(false)
      setTimeout(() => setMsg(null), 3000)
    }
  }

  // Group options by provider for <optgroup>
  const grouped = llmOptions.reduce<Record<string, LLMOption[]>>((acc, o) => {
    ;(acc[o.provider] ??= []).push(o)
    return acc
  }, {})

  return (
    <div className="rounded-xl border border-border/60 bg-card p-4 space-y-3">
      <div>
        <h4 className="text-sm font-semibold text-foreground">Modelo por complexidade</h4>
        <p className="text-[11px] text-muted-foreground mt-0.5">
          Agentes com modelo próprio têm prioridade sobre estas regras.
        </p>
      </div>

      {llmLoading ? (
        <p className="text-xs text-muted-foreground">Carregando integrações...</p>
      ) : llmOptions.length === 0 ? (
        <p className="text-xs text-amber-400">
          Nenhum provider de IA configurado.{' '}
          <a href="/integrations" className="underline hover:text-amber-300">Configurar em Integrações →</a>
        </p>
      ) : (
        <div className="space-y-2">
          {([
            { label: 'Simples', hint: 'bugs, textos, ajustes', value: simple,  set: setSimple  },
            { label: 'Média',   hint: 'features, refactors',   value: medium,  set: setMedium  },
            { label: 'Complexa',hint: 'arquitetura, análise',  value: complex, set: setComplex },
          ] as const).map(({ label, hint, value, set }) => (
            <div key={label} className="flex items-center gap-3">
              <div className="w-28 shrink-0">
                <p className="text-xs font-medium text-foreground">{label}</p>
                <p className="text-[10px] text-muted-foreground/60">{hint}</p>
              </div>
              <select
                value={value}
                onChange={e => (set as (v: string) => void)(e.target.value)}
                className={`${sel} flex-1`}
              >
                <option value="">— Sem regra —</option>
                {Object.entries(grouped).map(([provider, opts]) => (
                  <optgroup key={provider} label={provider}>
                    {opts.map(o => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </div>
          ))}
        </div>
      )}

      {msg && <p className={`text-xs font-medium ${msg.ok ? 'text-green-400' : 'text-red-400'}`}>{msg.text}</p>}

      <Button size="sm" onClick={handleSave} disabled={saving || llmOptions.length === 0} className="w-full h-8">
        {saving ? 'Salvando...' : 'Salvar'}
      </Button>
    </div>
  )
}

// ── Linked repos card ─────────────────────────────────────────────────────────

const PROVIDER_ICON: Record<string, string> = { github: '🐙', gitlab: '🦊', bitbucket: '🪣' }

function LinkedReposCard({
  pipelineId,
  config,
  allRepos,
  onUpdated,
}: {
  pipelineId: number
  config: Record<string, unknown>
  allRepos: GitRepository[]
  onUpdated: (newConfig: Record<string, unknown>) => void
}) {
  const linkedIds: number[] = Array.isArray(config.linkedRepoIds) ? (config.linkedRepoIds as number[]) : []
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [adding, setAdding] = useState(false)
  const [selected, setSelected] = useState('')

  const linked = allRepos.filter(r => linkedIds.includes(r.id))
  const available = allRepos.filter(r => !linkedIds.includes(r.id))

  const save = async (ids: number[]) => {
    setSaving(true)
    try {
      const res = await fetch(`/api/workspace/work-pipelines/${pipelineId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config: { ...config, linkedRepoIds: ids } }),
      })
      const data = await parseJson(res)
      if (!res.ok) throw new Error(data.error ?? 'Erro ao salvar')
      onUpdated(data.pipeline.config)
      setMsg({ ok: true, text: 'Salvo' })
    } catch (e: any) {
      setMsg({ ok: false, text: e.message })
    } finally {
      setSaving(false)
      setTimeout(() => setMsg(null), 2500)
    }
  }

  const add = () => {
    if (!selected) return
    save([...linkedIds, Number(selected)])
    setSelected(''); setAdding(false)
  }

  const remove = (id: number) => save(linkedIds.filter(x => x !== id))

  return (
    <div className="rounded-xl border border-border/60 bg-card p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h4 className="text-sm font-semibold text-foreground">Repositórios do sistema</h4>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            Repos que os agentes podem acessar neste pipeline.
          </p>
        </div>
        {!adding && available.length > 0 && (
          <button onClick={() => setAdding(true)} disabled={saving}
            className="text-xs text-primary/70 hover:text-primary transition-colors shrink-0">
            + Vincular
          </button>
        )}
      </div>

      {linked.length === 0 && !adding && (
        <p className="text-xs text-muted-foreground/60 italic">Nenhum repositório vinculado.</p>
      )}

      {linked.length > 0 && (
        <ul className="space-y-1.5">
          {linked.map(r => (
            <li key={r.id} className="flex items-center gap-2 rounded-lg bg-secondary/30 px-2.5 py-1.5">
              <span className="text-sm shrink-0">{PROVIDER_ICON[r.provider] ?? '📦'}</span>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-foreground truncate">{r.name}</p>
                <p className="text-[10px] text-muted-foreground/60 truncate">{r.repo_url} · {r.branch}</p>
              </div>
              <button onClick={() => remove(r.id)} disabled={saving}
                className="text-[10px] text-muted-foreground/40 hover:text-red-400 transition-colors shrink-0">✕</button>
            </li>
          ))}
        </ul>
      )}

      {adding && (
        <div className="flex items-center gap-2">
          <select value={selected} onChange={e => setSelected(e.target.value)}
            className={`${sel} flex-1`}>
            <option value="">— Selecione —</option>
            {available.map(r => (
              <option key={r.id} value={r.id}>{PROVIDER_ICON[r.provider] ?? '📦'} {r.name}</option>
            ))}
          </select>
          <button onClick={add} disabled={!selected || saving}
            className="text-xs text-primary/70 hover:text-primary transition-colors px-2 py-1 rounded-md border border-primary/30 hover:border-primary/60">
            OK
          </button>
          <button onClick={() => { setAdding(false); setSelected('') }}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors">
            ✕
          </button>
        </div>
      )}

      {allRepos.length === 0 && (
        <p className="text-xs text-amber-400">
          Nenhum repositório cadastrado.{' '}
          <a href="/git-repositories" className="underline hover:text-amber-300">Configurar em Repositórios →</a>
        </p>
      )}

      {msg && <p className={`text-xs font-medium ${msg.ok ? 'text-green-400' : 'text-red-400'}`}>{msg.text}</p>}
    </div>
  )
}

// ── Connected backlog card ────────────────────────────────────────────────────

function ConnectedBacklogCard({
  pipeline,
  onUpdated,
  onDeleted,
}: {
  pipeline: Pipeline
  onUpdated: (p: Pipeline) => void
  onDeleted: () => void
}) {
  const [editing,    setEditing]    = useState(false)
  const [deleting,   setDeleting]   = useState(false)
  const [confirmDel, setConfirmDel] = useState(false)
  const prov = PROVIDERS[pipeline.provider as keyof typeof PROVIDERS]

  const [name,      setName]      = useState(pipeline.name)
  const cfgStr = (k: string) => typeof pipeline.config[k] === 'string' ? pipeline.config[k] as string : ''
  const [jiraHost,  setJiraHost]  = useState(() => cfgStr('jiraHost'))
  const [jiraKey,   setJiraKey]   = useState(() => cfgStr('jiraProjectKey'))
  const [jiraEmail, setJiraEmail] = useState(() => cfgStr('jiraAccountEmail'))
  const [jiraToken, setJiraToken] = useState('')
  const [azureOrg,  setAzureOrg]  = useState(() => cfgStr('azureOrganizationUrl'))
  const [azureProj, setAzureProj] = useState(() => cfgStr('azureProject'))
  const [azurePat,  setAzurePat]  = useState('')
  const [saving,  setSaving]  = useState(false)
  const [status,  setStatus]  = useState('')
  const [error,   setError]   = useState('')

  const handleSave = async (andReimport = false) => {
    setSaving(true); setError('')
    try {
      const config = pipeline.provider === 'jira'
        ? { jiraHost: jiraHost.trim(), jiraProjectKey: jiraKey.trim(), jiraAccountEmail: jiraEmail.trim() }
        : { azureOrganizationUrl: azureOrg.trim(), azureProject: azureProj.trim() }
      const rawCred = pipeline.provider === 'jira' ? jiraToken.trim() : azurePat.trim()
      const credentials = rawCred
        ? (pipeline.provider === 'jira' ? { jiraApiToken: rawCred } : { azurePat: rawCred })
        : undefined
      setStatus('Salvando...')
      const res = await fetch(`/api/workspace/work-pipelines/${pipeline.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim() || pipeline.name, config, ...(credentials ? { credentials } : {}) }),
      })
      const data = await parseJson(res)
      if (!res.ok) throw new Error(data.error ?? 'Erro ao salvar')
      if (andReimport) {
        setStatus('Reimportando colunas...')
        await fetch(`/api/workspace/work-pipelines/${pipeline.id}/discover-columns`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ credentials, config }),
        })
      }
      onUpdated(data.pipeline)
      setEditing(false)
    } catch (e: any) {
      setError(e.message ?? 'Erro')
    } finally {
      setSaving(false); setStatus('')
    }
  }

  const handleDelete = async () => {
    setDeleting(true)
    await fetch(`/api/workspace/work-pipelines/${pipeline.id}`, { method: 'DELETE' })
    setDeleting(false)
    onDeleted()
  }

  return (
    <div className={`rounded-xl border bg-card overflow-hidden transition-all ${editing ? 'border-primary/40' : 'border-border/60'}`}>
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3">
        <div className={`w-9 h-9 rounded-xl flex items-center justify-center text-lg shrink-0 ${prov?.bg ?? 'bg-secondary'}`}>
          {prov?.icon ?? '🔗'}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-semibold text-foreground">{pipeline.name}</p>
            <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
              pipeline.has_credentials
                ? 'bg-green-500/10 text-green-400'
                : 'bg-amber-500/10 text-amber-400'
            }`}>
              {pipeline.has_credentials ? '🔑 OK' : '⚠ Sem credencial'}
            </span>
          </div>
          <p className="text-[11px] text-muted-foreground">
            {prov?.label} · {(pipeline.config.jiraHost as string) ?? (pipeline.config.azureOrganizationUrl as string) ?? '—'}
          </p>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button onClick={() => { setEditing(e => !e); setError('') }}
            className={`text-xs px-2.5 py-1 rounded-lg border transition-colors ${
              editing
                ? 'border-primary/40 bg-primary/10 text-primary'
                : 'border-border/50 text-muted-foreground hover:text-foreground'
            }`}>
            {editing ? 'Fechar' : 'Editar'}
          </button>
          {!confirmDel ? (
            <button onClick={() => setConfirmDel(true)}
              className="w-6 h-6 flex items-center justify-center rounded-lg text-muted-foreground/40 hover:text-red-400 hover:bg-red-500/10 transition-colors text-xs ml-0.5">
              ✕
            </button>
          ) : (
            <div className="flex items-center gap-1.5 ml-1">
              <span className="text-xs text-red-400">Remover?</span>
              <button onClick={handleDelete} disabled={deleting}
                className="text-xs px-2 py-0.5 rounded bg-red-500/20 text-red-400 hover:bg-red-500/30 transition-colors">
                {deleting ? '...' : 'Sim'}
              </button>
              <button onClick={() => setConfirmDel(false)} className="text-xs text-muted-foreground hover:text-foreground">Não</button>
            </div>
          )}
        </div>
      </div>

      {/* Edit form */}
      {editing && (
        <div className="px-4 pb-4 pt-3 border-t border-border/30 space-y-4 bg-secondary/10">
          {error && (
            <div className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">⚠ {error}</div>
          )}

          <div>
            <label className={lbl}>Nome da integração</label>
            <input value={name} onChange={e => setName(e.target.value)} className={inp} />
          </div>

          {pipeline.provider === 'jira' && (
            <div className="space-y-3">
              <div>
                <label className={lbl}>URL do Jira</label>
                <input
                  value={jiraHost}
                  onChange={e => setJiraHost(e.target.value)}
                  placeholder="https://empresa.atlassian.net"
                  className={`${inp} font-mono`}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={lbl}>Project Key</label>
                  <input
                    value={jiraKey}
                    onChange={e => setJiraKey(e.target.value)}
                    placeholder="PROJ"
                    className={`${inp} font-mono`}
                  />
                </div>
                <div>
                  <label className={lbl}>E-mail da conta</label>
                  <input
                    value={jiraEmail}
                    onChange={e => setJiraEmail(e.target.value)}
                    placeholder="voce@empresa.com"
                    className={inp}
                  />
                </div>
              </div>
              <div>
                <label className={lbl}>
                  Novo API Token
                  <span className="ml-1 text-[10px] font-normal text-muted-foreground">(deixe em branco para manter o atual)</span>
                </label>
                <input
                  type="password"
                  value={jiraToken}
                  onChange={e => setJiraToken(e.target.value)}
                  placeholder="••••••••••••••"
                  className={`${inp} font-mono`}
                />
              </div>
            </div>
          )}

          {pipeline.provider === 'azure_devops' && (
            <div className="space-y-3">
              <div>
                <label className={lbl}>URL da organização</label>
                <input
                  value={azureOrg}
                  onChange={e => setAzureOrg(e.target.value)}
                  placeholder="https://dev.azure.com/suaorg"
                  className={`${inp} font-mono`}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={lbl}>Projeto</label>
                  <input
                    value={azureProj}
                    onChange={e => setAzureProj(e.target.value)}
                    placeholder="MeuProjeto"
                    className={`${inp} font-mono`}
                  />
                </div>
                <div>
                  <label className={lbl}>
                    Novo PAT
                    <span className="ml-1 text-[10px] font-normal text-muted-foreground">(em branco = manter)</span>
                  </label>
                  <input
                    type="password"
                    value={azurePat}
                    onChange={e => setAzurePat(e.target.value)}
                    placeholder="••••••••••"
                    className={`${inp} font-mono`}
                  />
                </div>
              </div>
            </div>
          )}

          {status && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground bg-secondary/30 rounded-lg px-3 py-1.5">
              <div className="w-2.5 h-2.5 border border-primary/40 border-t-primary rounded-full animate-spin shrink-0" />
              {status}
            </div>
          )}
          <div className="flex gap-2">
            <Button size="sm" onClick={() => handleSave(false)} disabled={saving} className="flex-1 h-9">
              {saving ? '...' : 'Salvar'}
            </Button>
            <Button size="sm" variant="outline" onClick={() => handleSave(true)} disabled={saving} className="h-9 text-xs">
              Salvar e reimportar colunas
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Create form ───────────────────────────────────────────────────────────────

function IntegrationForm({ onSuccess, onCancel }: {
  onSuccess: (pipeline: Pipeline, columns: string[]) => void
  onCancel: () => void
}) {
  const [provider,  setProvider]  = useState<'jira' | 'azure_devops'>('jira')
  const [name,      setName]      = useState('')
  const [saving,    setSaving]    = useState(false)
  const [status,    setStatus]    = useState('')
  const [error,     setError]     = useState('')

  const [jiraHost,  setJiraHost]  = useState('')
  const [jiraKey,   setJiraKey]   = useState('')
  const [jiraEmail, setJiraEmail] = useState('')
  const [jiraToken, setJiraToken] = useState('')
  const [azureOrg,  setAzureOrg]  = useState('')
  const [azureProj, setAzureProj] = useState('')
  const [azurePat,  setAzurePat]  = useState('')

  const canSubmit = provider === 'jira'
    ? Boolean(jiraHost && jiraKey && jiraEmail && jiraToken)
    : Boolean(azureOrg && azureProj && azurePat)

  const handleSubmit = async () => {
    setSaving(true); setError('')
    let pipelineId: number | null = null
    try {
      const config = provider === 'jira'
        ? { jiraHost, jiraProjectKey: jiraKey, jiraAccountEmail: jiraEmail }
        : { azureOrganizationUrl: azureOrg, azureProject: azureProj }
      const credentials = provider === 'jira' ? { jiraApiToken: jiraToken } : { azurePat }
      const finalName = name.trim() || (provider === 'jira' ? (jiraKey || 'Jira') : (azureProj || 'Azure'))

      setStatus('Salvando...')
      const saveRes = await fetch('/api/workspace/work-pipelines', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: finalName, provider, config, credentials }),
      })
      const saveData = await parseJson(saveRes)
      if (!saveRes.ok) throw new Error(saveData.error ?? 'Erro ao salvar')
      pipelineId = saveData.pipeline.id

      setStatus('Validando credenciais e importando colunas...')
      const discRes = await fetch(`/api/workspace/work-pipelines/${pipelineId}/discover-columns`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ credentials, config }),
      })
      const discData = await parseJson(discRes)
      if (!discRes.ok) throw new Error(discData.error ?? 'Falha ao validar credenciais')

      onSuccess(saveData.pipeline, discData.columns ?? [])
    } catch (e: any) {
      setError(e.message ?? 'Erro desconhecido')
      if (pipelineId) await fetch(`/api/workspace/work-pipelines/${pipelineId}`, { method: 'DELETE' }).catch(() => {})
    } finally {
      setSaving(false); setStatus('')
    }
  }

  return (
    <div className="rounded-xl border border-primary/30 bg-card overflow-hidden">
      <div className="px-4 py-3 border-b border-border/40 bg-secondary/20 flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-foreground">Conectar backlog</h3>
          <p className="text-xs text-muted-foreground mt-0.5">As colunas do board são importadas automaticamente.</p>
        </div>
        <button onClick={onCancel} disabled={saving}
          className="w-6 h-6 flex items-center justify-center rounded text-muted-foreground hover:text-foreground text-xs">✕</button>
      </div>
      <div className="p-4 space-y-4">
        {error && (
          <div className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">⚠ {error}</div>
        )}

        {/* Provider selector */}
        <div>
          <label className={lbl}>Provedor</label>
          <div className="flex gap-2">
            {(['jira', 'azure_devops'] as const).map(k => (
              <button key={k} type="button" onClick={() => setProvider(k)}
                className={`flex items-center gap-1.5 h-9 px-3 rounded-lg border text-sm font-medium transition-all ${
                  provider === k
                    ? 'border-primary/60 bg-primary/10 text-primary'
                    : 'border-border/60 text-muted-foreground hover:border-border/80 hover:text-foreground'
                }`}>
                <span>{PROVIDERS[k].icon}</span> {PROVIDERS[k].label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className={lbl}>
            Nome <span className="font-normal text-muted-foreground">(opcional)</span>
          </label>
          <input value={name} onChange={e => setName(e.target.value)}
            placeholder={provider === 'jira' ? 'Ex: Sprint Backend' : 'Ex: Squad Frontend'}
            className={inp} />
        </div>

        {provider === 'jira' && (
          <div className="space-y-3 rounded-lg border border-border/50 bg-secondary/20 p-3">
            <p className="text-xs font-semibold text-foreground/60 uppercase tracking-wide">Credenciais Jira</p>
            <div>
              <label className={lbl}>URL do Jira</label>
              <input value={jiraHost} onChange={e => setJiraHost(e.target.value)}
                placeholder="https://suaempresa.atlassian.net"
                className={`${inp} font-mono`} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={lbl}>Project Key</label>
                <input value={jiraKey} onChange={e => setJiraKey(e.target.value)}
                  placeholder="PROJ" className={`${inp} font-mono`} />
              </div>
              <div>
                <label className={lbl}>E-mail da conta</label>
                <input value={jiraEmail} onChange={e => setJiraEmail(e.target.value)}
                  placeholder="voce@empresa.com" className={inp} />
              </div>
            </div>
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className={lbl}>API Token</label>
                <a href="https://id.atlassian.com/manage-profile/security/api-tokens"
                  target="_blank" rel="noopener noreferrer"
                  className="text-xs text-primary/70 hover:text-primary">↗ gerar token</a>
              </div>
              <input type="password" value={jiraToken} onChange={e => setJiraToken(e.target.value)}
                placeholder="••••••••••••" className={`${inp} font-mono`} />
            </div>
          </div>
        )}

        {provider === 'azure_devops' && (
          <div className="space-y-3 rounded-lg border border-border/50 bg-secondary/20 p-3">
            <p className="text-xs font-semibold text-foreground/60 uppercase tracking-wide">Credenciais Azure DevOps</p>
            <div>
              <label className={lbl}>URL da organização</label>
              <input value={azureOrg} onChange={e => setAzureOrg(e.target.value)}
                placeholder="https://dev.azure.com/suaorg" className={`${inp} font-mono`} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={lbl}>Projeto</label>
                <input value={azureProj} onChange={e => setAzureProj(e.target.value)}
                  placeholder="MeuProjeto" className={`${inp} font-mono`} />
              </div>
              <div>
                <label className={lbl}>Personal Access Token</label>
                <input type="password" value={azurePat} onChange={e => setAzurePat(e.target.value)}
                  placeholder="••••••••••" className={`${inp} font-mono`} />
              </div>
            </div>
          </div>
        )}

        {status && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground bg-secondary/30 rounded-lg px-3 py-1.5">
            <div className="w-2.5 h-2.5 border border-primary/40 border-t-primary rounded-full animate-spin shrink-0" />
            {status}
          </div>
        )}
        <Button onClick={handleSubmit} disabled={saving || !canSubmit} className="w-full h-9">
          {saving ? 'Aguarde...' : 'Validar e importar colunas →'}
        </Button>
      </div>
    </div>
  )
}

// ── Column configurator ────────────────────────────────────────────────────────

function ColumnConfigurator({
  pipelineId,
  initialColumns,
  agents,
  llmOptions,
  repos,
}: {
  pipelineId: number
  initialColumns: string[]
  agents: Agent[]
  llmOptions: LLMOption[]
  repos: GitRepository[]
}) {
  const uniqueRoles = Array.from(new Set(agents.map(a => a.role).filter(Boolean))).sort()

  const toRows = (names: string[]): PipelineColumn[] =>
    names.map((n, i) => ({ column_name: n, column_order: i, is_trigger: false, assignments: [], instructions: null }))

  const [columns,   setColumns]   = useState<PipelineColumn[]>(toRows(initialColumns))
  const [loading,   setLoading]   = useState(initialColumns.length === 0)
  const [discovering, setDisc]    = useState(false)
  const [saving,    setSaving]    = useState(false)
  const [msg,       setMsg]       = useState<{ ok: boolean; text: string } | null>(null)
  const [expanded,  setExpanded]  = useState<Set<number>>(new Set())

  useEffect(() => {
    if (initialColumns.length > 0) return
    fetch(`/api/workspace/work-pipelines/${pipelineId}/columns`)
      .then(r => r.ok ? r.json() : { columns: [] })
      .then(d => setColumns((d.columns ?? []).map((c: any) => ({
        ...c, is_trigger: Boolean(c.is_trigger),
        assignments: Array.isArray(c.assignments) ? c.assignments : [],
      }))))
      .finally(() => setLoading(false))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pipelineId])

  const flash = (ok: boolean, text: string) => {
    setMsg({ ok, text }); setTimeout(() => setMsg(null), 4000)
  }

  const handleReimport = async () => {
    setDisc(true)
    try {
      const res = await fetch(`/api/workspace/work-pipelines/${pipelineId}/discover-columns`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
      })
      const data = await parseJson(res)
      if (!res.ok) throw new Error(data.error)
      setColumns(prev => (data.columns as string[]).map((name, i) => {
        const ex = prev.find(c => c.column_name === name)
        return ex ?? { column_name: name, column_order: i, is_trigger: false, assignments: [], instructions: null }
      }))
      flash(true, `${data.columns.length} colunas importadas`)
    } catch (e: any) { flash(false, e.message ?? 'Erro') } finally { setDisc(false) }
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      const res = await fetch(`/api/workspace/work-pipelines/${pipelineId}/columns`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ columns: columns.map((c, i) => ({ ...c, column_order: i })) }),
      })
      const data = await parseJson(res)
      if (!res.ok) throw new Error(data.error)
      flash(true, 'Configuração salva')
    } catch (e: any) { flash(false, e.message ?? 'Erro') } finally { setSaving(false) }
  }

  const updateCol    = (idx: number, patch: Partial<PipelineColumn>) =>
    setColumns(prev => prev.map((c, i) => i === idx ? { ...c, ...patch } : c))
  const addAssignment   = (ci: number) =>
    updateCol(ci, { assignments: [...columns[ci].assignments, { role: '', agent_id: null, llm_model: '' }] })
  const removeAssign    = (ci: number, ai: number) =>
    updateCol(ci, { assignments: columns[ci].assignments.filter((_, i) => i !== ai) })
  const updateAssign    = (ci: number, ai: number, patch: Partial<Assignment>) =>
    updateCol(ci, { assignments: columns[ci].assignments.map((a, i) => i === ai ? { ...a, ...patch } : a) })

  const toggleExpand = (idx: number) => {
    setExpanded(prev => { const n = new Set(prev); n.has(idx) ? n.delete(idx) : n.add(idx); return n })
  }

  if (loading) return (
    <div className="flex items-center gap-2 py-8 text-xs text-muted-foreground justify-center">
      <div className="w-3 h-3 border border-primary/40 border-t-primary rounded-full animate-spin" />
      Carregando colunas...
    </div>
  )

  if (columns.length === 0) return (
    <div className="flex flex-col items-center justify-center py-16 gap-3 rounded-xl border border-dashed border-border/50">
      <p className="text-sm text-muted-foreground">Nenhuma coluna importada.</p>
      <Button size="sm" onClick={handleReimport} disabled={discovering}>⟳ Importar colunas do board</Button>
    </div>
  )

  const triggerCol = columns.find(c => c.is_trigger)

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          {msg && (
            <span className={`text-xs font-medium ${msg.ok ? 'text-green-400' : 'text-red-400'}`}>{msg.text}</span>
          )}
          {!msg && triggerCol && (
            <span className="text-xs text-muted-foreground">
              Gatilho: <span className="text-primary font-medium">{triggerCol.column_name}</span>
            </span>
          )}
          {!msg && !triggerCol && (
            <span className="text-xs text-amber-400">⚡ Nenhum gatilho definido — clique em ⚡ em uma coluna</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button onClick={handleReimport} disabled={discovering}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1 px-2 py-1 rounded-lg hover:bg-secondary">
            ⟳ {discovering ? 'Importando...' : 'Re-importar'}
          </button>
          <Button size="sm" onClick={handleSave} disabled={saving} className="h-7 text-xs">
            {saving ? 'Salvando...' : 'Salvar colunas'}
          </Button>
        </div>
      </div>

      {/* Flow preview */}
      <div className="overflow-x-auto pb-1">
        <div className="flex items-center gap-1 min-w-max">
          {columns.map((col, i) => (
            <div key={i} className="flex items-center gap-1">
              <div className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-medium border whitespace-nowrap cursor-pointer transition-all ${
                col.is_trigger
                  ? 'border-primary/50 bg-primary/10 text-primary'
                  : 'border-border/50 bg-secondary/40 text-muted-foreground hover:border-border'
              }`} onClick={() => updateCol(i, { is_trigger: !col.is_trigger })}>
                {col.is_trigger && <span>⚡</span>}
                {col.column_name}
                {col.assignments.length > 0 && (
                  <span className="ml-1 opacity-60">{col.assignments.length}×</span>
                )}
              </div>
              {i < columns.length - 1 && <span className="text-muted-foreground/25 text-[10px]">→</span>}
            </div>
          ))}
        </div>
      </div>

      {/* Columns */}
      <div className="space-y-2">
        {columns.map((col, colIdx) => {
          const isOpen = expanded.has(colIdx)
          return (
            <div key={colIdx} className={`rounded-xl border transition-all ${
              col.is_trigger ? 'border-primary/30 bg-primary/5' : 'border-border/50 bg-card'
            }`}>
              {/* Column header row */}
              <div className="flex items-center gap-2.5 px-3 py-2.5">
                <button
                  type="button"
                  onClick={() => updateCol(colIdx, { is_trigger: !col.is_trigger })}
                  title={col.is_trigger ? 'Gatilho ativo — clique para remover' : 'Definir como gatilho'}
                  className={`w-6 h-6 rounded-md border transition-all flex items-center justify-center text-xs shrink-0 ${
                    col.is_trigger
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-border/50 text-muted-foreground/30 hover:border-primary/40 hover:text-primary/50'
                  }`}>
                  ⚡
                </button>
                <div className="flex-1 min-w-0 flex items-center gap-2">
                  <span className="text-xs font-medium text-foreground truncate">{col.column_name}</span>
                  {col.is_trigger && (
                    <span className="text-[10px] text-primary/60 bg-primary/8 px-1.5 py-0.5 rounded shrink-0">gatilho</span>
                  )}
                  {col.assignments.length > 0 && (
                    <span className="text-[10px] text-muted-foreground/50 shrink-0">
                      {col.assignments.length} agente{col.assignments.length > 1 ? 's' : ''}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {col.instructions && (
                    <span className="text-[10px] text-amber-400/60" title="Tem instruções">📝</span>
                  )}
                  <button
                    onClick={() => toggleExpand(colIdx)}
                    className={`text-xs px-2 py-1 rounded-lg border transition-colors ${
                      isOpen
                        ? 'border-border text-foreground bg-secondary'
                        : 'border-border/40 text-muted-foreground/50 hover:text-foreground hover:border-border'
                    }`}>
                    {isOpen ? '▲ Fechar' : `▼ ${col.assignments.length ? 'Editar' : '+ Agentes'}`}
                  </button>
                </div>
              </div>

              {/* Expanded: assignments + instructions */}
              {isOpen && (
                <div className="px-3 pb-3 pt-1 border-t border-border/20 space-y-3">
                  {/* Instructions */}
                  <div>
                    <label className="block text-xs font-semibold text-foreground/70 mb-1.5">
                      📝 Instruções para o agente
                    </label>
                    <textarea
                      value={col.instructions ?? ''}
                      onChange={e => updateCol(colIdx, { instructions: e.target.value || null })}
                      placeholder="Ex: Quando um card chegar, analise os requisitos e crie um plano de implementação..."
                      rows={2}
                      className="w-full px-3 py-2 rounded-lg bg-secondary/50 border border-border text-xs text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:border-primary/50 resize-none"
                    />
                  </div>

                  {/* Assignments */}
                  {col.assignments.length > 0 && (
                    <div className="space-y-1.5">
                      <label className="block text-xs font-semibold text-foreground/70">Agentes atribuídos</label>
                      {col.assignments.map((a, aIdx) => {
                        const filteredAgents = a.role ? agents.filter(ag => ag.role === a.role) : agents
                        return (
                          <div key={aIdx} className="flex items-center gap-1.5">
                            <select value={a.role}
                              onChange={e => updateAssign(colIdx, aIdx, { role: e.target.value, agent_id: null })}
                              className={`${sel} flex-1`}>
                              <option value="">— Função —</option>
                              {uniqueRoles.map(r => <option key={r} value={r}>{r}</option>)}
                            </select>
                            <select value={a.agent_id != null ? String(a.agent_id) : ''}
                              onChange={e => updateAssign(colIdx, aIdx, { agent_id: e.target.value ? Number(e.target.value) : null })}
                              className={`${sel} flex-1`}>
                              <option value="">— Agente —</option>
                              {filteredAgents.map(ag => <option key={ag.id} value={String(ag.id)}>{ag.name}</option>)}
                            </select>
                            {repos.length > 0 && (
                              <select
                                value={a.repo_id != null ? String(a.repo_id) : ''}
                                onChange={e => updateAssign(colIdx, aIdx, { repo_id: e.target.value ? Number(e.target.value) : null })}
                                className={`${sel} w-36`}
                                title="Repositório para este agente nesta coluna">
                                <option value="">— Repo padrão —</option>
                                {repos.map(r => (
                                  <option key={r.id} value={String(r.id)}>{PROVIDER_ICON[r.provider] ?? '📦'} {r.name}</option>
                                ))}
                              </select>
                            )}
                            {llmOptions.length > 0 && (
                              <select
                                value={a.llm_model ?? ''}
                                onChange={e => updateAssign(colIdx, aIdx, { llm_model: e.target.value })}
                                className={`${sel} w-36`}
                                title="LLM para este agente nesta coluna">
                                <option value="">— LLM padrão —</option>
                                {llmOptions.map(o => (
                                  <option key={o.value} value={o.value}>{o.provider !== o.label ? `${o.provider} / ${o.label}` : o.label}</option>
                                ))}
                              </select>
                            )}
                            <button onClick={() => removeAssign(colIdx, aIdx)}
                              className="w-5 h-5 flex items-center justify-center rounded text-muted-foreground/40 hover:text-red-400 transition-colors text-[10px] shrink-0">✕</button>
                          </div>
                        )
                      })}
                    </div>
                  )}
                  <button onClick={() => addAssignment(colIdx)}
                    className="text-xs text-primary/60 hover:text-primary transition-colors flex items-center gap-1">
                    + Associar agente
                  </button>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Main panel ────────────────────────────────────────────────────────────────

export function ClientPipelinesPanel() {
  const [loading,   setLoading]   = useState(true)
  const [pipelines, setPipelines] = useState<Pipeline[]>([])
  const [agents,    setAgents]    = useState<Agent[]>([])
  const [creating,  setCreating]  = useState(false)
  const [initCols,  setInitCols]  = useState<Record<number, string[]>>({})
  const { options: llmOptions, loading: llmLoading } = useLLMOptions()
  const allRepos = useGitRepos()

  const load = useCallback(async () => {
    const [pRes, aRes] = await Promise.all([
      fetch('/api/workspace/work-pipelines'),
      fetch('/api/agents'),
    ])
    if (pRes.ok) {
      const data = await pRes.json()
      const list: Pipeline[] = (data.pipelines ?? []).filter((p: Pipeline) => p.provider !== 'none')
      setPipelines(list)
    }
    if (aRes.ok) setAgents((await aRes.json()).agents ?? [])
  }, [])

  useEffect(() => { load().finally(() => setLoading(false)) }, [load])

  const pipeline = pipelines[0] ?? null

  if (loading) {
    return (
      <div className="flex items-center justify-center p-12 min-h-[200px]">
        <div className="flex flex-col items-center gap-3 text-muted-foreground">
          <div className="w-5 h-5 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
          <span className="text-sm">Carregando...</span>
        </div>
      </div>
    )
  }

  /* ── Form full-screen mode ── */
  if (creating) {
    return (
      <div className="p-5 space-y-5">
        <div className="flex items-center gap-3">
          <button onClick={() => setCreating(false)}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1">
            ← Voltar
          </button>
          <h2 className="text-base font-semibold text-foreground">Conectar backlog</h2>
        </div>
        <IntegrationForm
          onSuccess={(p, cols) => {
            setPipelines([p])
            setInitCols({ [p.id]: cols })
            setCreating(false)
          }}
          onCancel={() => setCreating(false)}
        />
      </div>
    )
  }

  return (
    <div className="p-5 space-y-5 max-w-[1400px]">

      {/* ── Header ── */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-foreground">Fluxo de desenvolvimento</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Conecte o backlog, defina o gatilho, associe agentes por coluna e configure os modelos de IA.
          </p>
        </div>
        {!pipeline && (
          <Button size="sm" onClick={() => setCreating(true)} className="shrink-0 h-8">
            + Conectar backlog
          </Button>
        )}
      </div>

      {/* ── Empty state ── */}
      {!pipeline && (
        <div className="rounded-xl border border-dashed border-border/60 bg-card px-4 py-16 flex flex-col items-center gap-3 text-center">
          <div className="flex items-center gap-3 text-2xl">
            <span>🎯</span>
            <span className="text-muted-foreground/30 text-base">ou</span>
            <span>🔷</span>
          </div>
          <p className="text-sm font-semibold text-foreground">Nenhum backlog conectado</p>
          <p className="text-xs text-muted-foreground">Conecte ao Jira ou Azure DevOps para começar.</p>
          <Button size="sm" onClick={() => setCreating(true)} className="h-8 mt-1">+ Conectar</Button>
        </div>
      )}

      {/* ── Two-column body (only when pipeline exists) ── */}
      {pipeline && (
      <div className="grid grid-cols-1 xl:grid-cols-[380px_1fr] gap-5 items-start">

        {/* LEFT: connection + config */}
        <div className="flex flex-col gap-3">

          <ConnectedBacklogCard
            pipeline={pipeline}
            onUpdated={updated => setPipelines([updated])}
            onDeleted={() => { setPipelines([]); setInitCols({}) }}
          />

          <LinkedReposCard
            pipelineId={pipeline.id}
            config={pipeline.config}
            allRepos={allRepos}
            onUpdated={newConfig => setPipelines([{ ...pipeline, config: newConfig }])}
          />

          <LLMComplexityCard
            pipelineId={pipeline.id}
            config={pipeline.config as Record<string, string>}
            llmOptions={llmOptions}
            llmLoading={llmLoading}
          />

          <div className="rounded-xl border border-border/40 bg-secondary/20 px-3 py-3 space-y-1 text-xs text-muted-foreground">
            <p className="font-semibold text-foreground text-xs mb-1.5">Prioridade do modelo</p>
            <div className="flex items-start gap-1.5"><span className="text-primary shrink-0">1</span><span>Modelo definido no agente (coluna → atribuição)</span></div>
            <div className="flex items-start gap-1.5"><span className="text-primary shrink-0">2</span><span>Regra por complexidade da tarefa</span></div>
            <div className="flex items-start gap-1.5"><span className="text-primary shrink-0">3</span><span>Padrão do provider configurado em Integrações</span></div>
          </div>
        </div>

        {/* RIGHT: column configurator */}
        <div>
          <ColumnConfigurator
            pipelineId={pipeline.id}
            initialColumns={initCols[pipeline.id] ?? []}
            agents={agents}
            llmOptions={llmOptions}
            repos={allRepos.filter(r => {
              const ids = Array.isArray(pipeline.config.linkedRepoIds) ? (pipeline.config.linkedRepoIds as number[]) : []
              return ids.length === 0 || ids.includes(r.id)
            })}
          />
        </div>
      </div>
      )}
    </div>
  )
}
