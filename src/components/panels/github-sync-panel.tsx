'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { Button } from '@/components/ui/button'
import type { GitRepository, GitProvider } from '@/lib/delivery-flow-types'

// ── Import helpers ────────────────────────────────────────────────────────────

interface ImportRow {
  id: string
  name: string
  url: string
  branch: string
  token: string
  provider: GitProvider
  valid: boolean
  error?: string
}

function detectProvider(url: string): GitProvider {
  if (url.includes('gitlab')) return 'gitlab'
  if (url.includes('bitbucket')) return 'bitbucket'
  return 'github'
}

function nameFromUrl(url: string): string {
  try {
    const path = new URL(url).pathname.replace(/^\//, '').replace(/\.git$/, '')
    const parts = path.split('/').filter(Boolean)
    return parts[parts.length - 1] ?? url
  } catch {
    return url.split('/').pop()?.replace(/\.git$/, '') ?? url
  }
}

function parseImportText(raw: string): ImportRow[] {
  const lines = raw.trim().split(/\r?\n/).filter(l => l.trim())
  if (!lines.length) return []

  let id = 0
  const next = () => String(id++)

  // Detect CSV: any line has a comma or semicolon
  const isCsv = lines.some(l => /[,;]/.test(l))

  if (isCsv) {
    // Find header row or assume col order: nome, url, branch, token
    const firstLower = lines[0].toLowerCase()
    const hasHeader = firstLower.includes('url') || firstLower.includes('nome') || firstLower.includes('name')
    let urlCol = 1, nameCol = 0, branchCol = 2, tokenCol = 3
    let startIdx = 0

    if (hasHeader) {
      const headers = lines[0].split(/[,;]/).map(h => h.trim().toLowerCase())
      urlCol    = Math.max(0, headers.findIndex(h => h.includes('url') || h.includes('repo')))
      nameCol   = Math.max(0, headers.findIndex(h => h.includes('nome') || h.includes('name')))
      branchCol = headers.findIndex(h => h.includes('branch') || h.includes('ramo'))
      tokenCol  = headers.findIndex(h => h.includes('token') || h.includes('senha') || h.includes('key') || h.includes('pat'))
      if (branchCol < 0) branchCol = 2
      if (tokenCol  < 0) tokenCol  = 3
      startIdx = 1
    }

    return lines.slice(startIdx).map(line => {
      const cols = line.split(/[,;]/).map(c => c.trim().replace(/^["']|["']$/g, ''))
      const url    = cols[urlCol]  ?? ''
      const name   = cols[nameCol] || nameFromUrl(url)
      const branch = cols[branchCol]?.trim() || 'main'
      const token  = cols[tokenCol]?.trim()  ?? ''
      const valid  = url.startsWith('http')
      return { id: next(), name, url, branch, token, provider: detectProvider(url), valid, error: valid ? undefined : 'URL inválida' }
    }).filter(r => r.url)
  }

  // Plain URL list — one per line
  return lines.map(line => {
    const url = line.trim()
    const valid = url.startsWith('http')
    return { id: next(), name: nameFromUrl(url), url, branch: 'main', token: '', provider: detectProvider(url), valid, error: valid ? undefined : 'URL inválida' }
  })
}

// ── Import panel ──────────────────────────────────────────────────────────────

function ImportPanel({ onDone, onCancel }: {
  onDone: () => void
  onCancel: () => void
}) {
  const [step, setStep] = useState<'input' | 'preview' | 'importing' | 'done'>('input')
  const [tab, setTab] = useState<'text' | 'file'>('text')
  const [text, setText] = useState('')
  const [rows, setRows] = useState<ImportRow[]>([])
  const [results, setResults] = useState<Array<{ name: string; ok: boolean; error?: string }>>([])
  const fileRef = useRef<HTMLInputElement>(null)

  const EXAMPLE_CSV = `nome,url,branch,token
API Principal,https://github.com/org/api,main,ghp_xxx
Frontend,https://github.com/org/frontend,develop,`

  const handleParse = () => {
    const parsed = parseImportText(text)
    setRows(parsed)
    if (parsed.length) setStep('preview')
  }

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const content = await file.text()
    setText(content)
    const parsed = parseImportText(content)
    setRows(parsed)
    if (parsed.length) setStep('preview')
  }

  const handleRemoveRow = (id: string) => setRows(prev => prev.filter(r => r.id !== id))

  const validRows = rows.filter(r => r.valid)

  const handleImport = async () => {
    setStep('importing')
    const res: typeof results = []
    for (const row of validRows) {
      try {
        const resp = await fetch('/api/workspace/git-repositories', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: row.name,
            provider: row.provider,
            repo_url: row.url,
            branch: row.branch,
            access_token: row.token || null,
            base_url: null,
          }),
        })
        const data = await resp.json()
        res.push(resp.ok
          ? { name: row.name, ok: true }
          : { name: row.name, ok: false, error: data.error ?? 'Falha' })
      } catch {
        res.push({ name: row.name, ok: false, error: 'Erro de rede' })
      }
      setResults([...res])
    }
    setStep('done')
    onDone()
  }

  return (
    <div className="rounded-xl border border-primary/30 bg-primary/5 overflow-hidden">

      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-primary/20">
        <div>
          <h3 className="text-sm font-semibold text-foreground">Importar repositórios em lote</h3>
          <p className="text-[10px] text-muted-foreground mt-0.5">Cole URLs, CSV ou envie um arquivo .csv</p>
        </div>
        <button onClick={onCancel} className="text-muted-foreground hover:text-foreground text-lg leading-none">×</button>
      </div>

      {/* Step: input */}
      {(step === 'input' || (step === 'preview' && !rows.length)) && (
        <div className="p-4 space-y-4">
          {/* Tabs */}
          <div className="flex gap-1 bg-secondary/50 rounded-lg p-1 w-fit">
            {(['text', 'file'] as const).map(t => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${tab === t ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
              >
                {t === 'text' ? '📋 Colar texto' : '📂 Arquivo'}
              </button>
            ))}
          </div>

          {tab === 'text' && (
            <div className="space-y-2">
              <textarea
                value={text}
                onChange={e => setText(e.target.value)}
                placeholder={`Cole URLs (uma por linha) ou CSV:\n\n${EXAMPLE_CSV}`}
                rows={8}
                className="w-full rounded-lg bg-background border border-border/60 px-3 py-2.5 text-xs text-foreground font-mono placeholder:text-muted-foreground/30 focus:outline-none focus:border-primary/50 resize-none"
              />
              <div className="flex items-start gap-2 text-[10px] text-muted-foreground/60">
                <span>💡</span>
                <span>
                  Aceita <strong className="text-muted-foreground">URLs simples</strong> (uma por linha) ou <strong className="text-muted-foreground">CSV</strong> com colunas: nome, url, branch, token.
                  Separe com vírgula ou ponto-e-vírgula. Cabeçalho é opcional.
                </span>
              </div>
            </div>
          )}

          {tab === 'file' && (
            <div
              onClick={() => fileRef.current?.click()}
              className="rounded-xl border-2 border-dashed border-border/50 hover:border-primary/40 bg-secondary/20 hover:bg-primary/5 transition-all py-10 flex flex-col items-center gap-3 cursor-pointer"
            >
              <span className="text-3xl">📂</span>
              <div className="text-center">
                <p className="text-sm font-medium text-foreground">Clique para selecionar o arquivo</p>
                <p className="text-xs text-muted-foreground mt-0.5">Aceita .csv — para Excel, exporte como CSV primeiro</p>
              </div>
              <p className="text-[10px] text-muted-foreground/50">Arquivo → Salvar como → CSV UTF-8 no Excel</p>
              <input ref={fileRef} type="file" accept=".csv,.txt" className="hidden" onChange={handleFile} />
            </div>
          )}

          <div className="flex gap-2">
            <Button size="sm" onClick={handleParse} disabled={!text.trim()}>
              Analisar →
            </Button>
            <Button size="sm" variant="outline" onClick={onCancel}>Cancelar</Button>
          </div>
        </div>
      )}

      {/* Step: preview */}
      {step === 'preview' && rows.length > 0 && (
        <div className="p-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">
              <span className="text-foreground font-medium">{validRows.length}</span> repositórios válidos
              {rows.length !== validRows.length && (
                <span className="text-red-400 ml-1">· {rows.length - validRows.length} com erro</span>
              )}
            </p>
            <button onClick={() => setStep('input')} className="text-[10px] text-muted-foreground hover:text-foreground transition-colors">
              ← Editar texto
            </button>
          </div>

          <div className="rounded-lg border border-border/50 overflow-hidden">
            <div className="grid grid-cols-[auto_1fr_80px_80px_32px] gap-0 text-[10px] font-medium text-muted-foreground uppercase tracking-wider px-3 py-2 bg-secondary/40 border-b border-border/40">
              <span />
              <span>Repositório</span>
              <span>Branch</span>
              <span>Token</span>
              <span />
            </div>
            <div className="divide-y divide-border/30 max-h-72 overflow-y-auto">
              {rows.map(row => (
                <div key={row.id} className={`grid grid-cols-[auto_1fr_80px_80px_32px] items-center gap-2 px-3 py-2 ${!row.valid ? 'bg-red-500/5' : ''}`}>
                  <span className="text-base">{PROVIDERS[row.provider].icon}</span>
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-foreground truncate">{row.name}</p>
                    <p className="text-[10px] text-muted-foreground font-mono truncate">{row.url}</p>
                    {row.error && <p className="text-[10px] text-red-400">{row.error}</p>}
                  </div>
                  <span className="text-[10px] font-mono text-muted-foreground truncate">{row.branch}</span>
                  <span className="text-[10px]">{row.token ? '🔑 sim' : <span className="text-muted-foreground/40">—</span>}</span>
                  <button onClick={() => handleRemoveRow(row.id)} className="text-muted-foreground/40 hover:text-red-400 transition-colors text-xs">✕</button>
                </div>
              ))}
            </div>
          </div>

          <div className="flex gap-2">
            <Button size="sm" onClick={handleImport} disabled={validRows.length === 0}>
              Importar {validRows.length} {validRows.length === 1 ? 'repositório' : 'repositórios'}
            </Button>
            <Button size="sm" variant="outline" onClick={() => setStep('input')}>Voltar</Button>
          </div>
        </div>
      )}

      {/* Step: importing / done */}
      {(step === 'importing' || step === 'done') && (
        <div className="p-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium text-foreground">
              {step === 'importing' ? 'Importando...' : `Importação concluída — ${results.filter(r => r.ok).length}/${validRows.length} adicionados`}
            </p>
            {step === 'done' && (
              <Button size="sm" onClick={onCancel} variant="outline">Fechar</Button>
            )}
          </div>

          <div className="rounded-lg border border-border/50 overflow-hidden divide-y divide-border/30 max-h-64 overflow-y-auto">
            {validRows.map((row, i) => {
              const result = results[i]
              return (
                <div key={row.id} className="flex items-center gap-3 px-3 py-2">
                  <span className="text-base shrink-0">{PROVIDERS[row.provider].icon}</span>
                  <span className="text-xs text-foreground flex-1 truncate">{row.name}</span>
                  {!result && step === 'importing' && i === results.length && (
                    <span className="text-[10px] text-primary animate-pulse">importando...</span>
                  )}
                  {!result && i > results.length && (
                    <span className="text-[10px] text-muted-foreground/40">aguardando</span>
                  )}
                  {result && (
                    result.ok
                      ? <span className="text-[10px] text-green-400 font-medium">✓ adicionado</span>
                      : <span className="text-[10px] text-red-400 truncate max-w-[120px]">✗ {result.error}</span>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Provider metadata ─────────────────────────────────────────────────────────

const PROVIDERS: Record<GitProvider, { label: string; icon: string; host: string; placeholder: string; tokenHint: string }> = {
  github:    { label: 'GitHub',    icon: '🐙', host: 'github.com',    placeholder: 'https://github.com/org/repo',           tokenHint: 'ghp_...' },
  gitlab:    { label: 'GitLab',    icon: '🦊', host: 'gitlab.com',    placeholder: 'https://gitlab.com/grupo/projeto',       tokenHint: 'glpat-...' },
  bitbucket: { label: 'Bitbucket', icon: '🪣', host: 'bitbucket.org', placeholder: 'https://bitbucket.org/workspace/repo',   tokenHint: 'usuario:app_password' },
}

const STATUS_LABELS: Record<string, { label: string; dot: string }> = {
  success: { label: 'Sincronizado',  dot: 'bg-green-500' },
  partial: { label: 'Parcial',       dot: 'bg-yellow-500' },
  error:   { label: 'Falhou',        dot: 'bg-red-500' },
  failed:  { label: 'Falhou',        dot: 'bg-red-500' },
}

// ── Repo form (create / edit) ─────────────────────────────────────────────────

function RepoForm({
  initial,
  onSave,
  onCancel,
  saving,
}: {
  initial?: Partial<GitRepository>
  onSave: (data: { name: string; provider: GitProvider; repo_url: string; branch: string; access_token: string | null; base_url: string | null }) => void
  onCancel: () => void
  saving: boolean
}) {
  const [name, setName] = useState(initial?.name ?? '')
  const [provider, setProvider] = useState<GitProvider>(initial?.provider ?? 'github')
  const [repoUrl, setRepoUrl] = useState(initial?.repo_url ?? '')
  const [branch, setBranch] = useState(initial?.branch ?? 'main')
  const [token, setToken] = useState(initial?.access_token ?? '')
  const [baseUrl, setBaseUrl] = useState(initial?.base_url ?? '')
  const [showToken, setShowToken] = useState(false)

  return (
    <div className="rounded-xl border border-primary/30 bg-primary/5 p-4 space-y-3">
      <p className="text-xs font-semibold text-foreground uppercase tracking-wider">
        {initial?.id ? 'Editar repositório' : 'Novo repositório'}
      </p>

      {/* Name */}
      <div>
        <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block">Nome</label>
        <input
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="Ex: API Principal, Frontend..."
          className="w-full h-8 px-3 rounded-lg bg-background border border-border/60 text-xs text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:border-primary/50"
        />
      </div>

      {/* Provider selector */}
      <div>
        <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1.5 block">Provedor</label>
        <div className="flex gap-2 flex-wrap">
          {(Object.keys(PROVIDERS) as GitProvider[]).map(p => (
            <button
              key={p}
              type="button"
              onClick={() => setProvider(p)}
              className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border transition-all font-medium ${
                provider === p
                  ? 'border-primary/60 bg-primary/10 text-primary'
                  : 'border-border/50 text-muted-foreground hover:border-border hover:text-foreground'
              }`}
            >
              {PROVIDERS[p].icon} {PROVIDERS[p].label}
            </button>
          ))}
        </div>
      </div>

      {/* URL */}
      <div>
        <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block">URL do repositório</label>
        <input
          value={repoUrl}
          onChange={e => setRepoUrl(e.target.value)}
          placeholder={PROVIDERS[provider].placeholder}
          className="w-full h-8 px-3 rounded-lg bg-background border border-border/60 text-xs text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:border-primary/50 font-mono"
        />
      </div>

      {/* Branch */}
      <div>
        <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block">Branch monitorada</label>
        <input
          value={branch}
          onChange={e => setBranch(e.target.value)}
          placeholder="main"
          className="w-full h-8 px-3 rounded-lg bg-background border border-border/60 text-xs text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:border-primary/50 font-mono"
        />
      </div>

      {/* Access token */}
      <div>
        <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block">
          Token de acesso
          <span className="ml-1 normal-case font-normal text-muted-foreground/50">(para repositórios privados)</span>
        </label>
        <div className="relative">
          <input
            type={showToken ? 'text' : 'password'}
            value={token}
            onChange={e => setToken(e.target.value)}
            placeholder={PROVIDERS[provider].tokenHint}
            className="w-full h-8 px-3 pr-16 rounded-lg bg-background border border-border/60 text-xs text-foreground placeholder:text-muted-foreground/30 focus:outline-none focus:border-primary/50 font-mono"
          />
          <button
            type="button"
            onClick={() => setShowToken(v => !v)}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground/50 hover:text-foreground transition-colors px-1"
          >
            {showToken ? 'ocultar' : 'mostrar'}
          </button>
        </div>
      </div>

      {/* GitLab base URL */}
      {provider === 'gitlab' && (
        <div>
          <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block">
            URL base <span className="normal-case font-normal text-muted-foreground/50">(self-hosted — ex: https://gitlab.empresa.com)</span>
          </label>
          <input
            value={baseUrl}
            onChange={e => setBaseUrl(e.target.value)}
            placeholder="https://gitlab.empresa.com"
            className="w-full h-8 px-3 rounded-lg bg-background border border-border/60 text-xs text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:border-primary/50 font-mono"
          />
        </div>
      )}

      <div className="flex gap-2 pt-1">
        <Button
          size="sm"
          onClick={() => onSave({
            name, provider,
            repo_url: repoUrl.trim(),
            branch,
            access_token: token.trim() || null,
            base_url: baseUrl.trim() || null,
          })}
          disabled={saving || !name.trim() || !repoUrl.trim()}
          className="min-w-[80px]"
        >
          {saving ? '...' : initial?.id ? 'Salvar' : 'Adicionar'}
        </Button>
        <Button size="sm" variant="outline" onClick={onCancel}>Cancelar</Button>
      </div>
    </div>
  )
}

// ── Repo card ─────────────────────────────────────────────────────────────────

function RepoCard({
  repo,
  lastSync,
  onEdit,
  onDelete,
  deletingId,
}: {
  repo: GitRepository
  lastSync?: { status: string; created_at: number; changes_pulled: number }
  onEdit: () => void
  onDelete: () => void
  deletingId: number | null
}) {
  const [testStatus, setTestStatus] = useState<{ ok: boolean; user?: string; error?: string } | null>(null)
  const [testing, setTesting] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const p = PROVIDERS[repo.provider]

  const handleTest = async () => {
    setTesting(true)
    setTestStatus(null)
    try {
      const res = await fetch(`/api/workspace/git-repositories/${repo.id}/test`, { method: 'POST' })
      const data = await res.json()
      setTestStatus(data)
    } catch {
      setTestStatus({ ok: false, error: 'Erro de rede' })
    } finally {
      setTesting(false)
    }
  }

  const syncInfo = lastSync ? STATUS_LABELS[lastSync.status] : null

  return (
    <div className="rounded-xl border border-border/60 bg-card overflow-hidden">
      {/* Card header */}
      <div className="px-4 py-3 flex items-start justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0">
          {/* Provider icon */}
          <div className="w-9 h-9 rounded-lg bg-secondary flex items-center justify-center text-lg shrink-0 mt-0.5">
            {p.icon}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="text-sm font-semibold text-foreground">{repo.name}</p>
              <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-secondary text-muted-foreground">{p.label}</span>
              {repo.access_token && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-500/10 text-green-400 font-medium">🔑 privado</span>
              )}
            </div>
            <p className="text-[11px] text-muted-foreground font-mono truncate mt-0.5 max-w-[360px]">
              {repo.repo_url}
            </p>
            <div className="flex items-center gap-3 mt-1.5 flex-wrap">
              <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                <span className="opacity-50">branch</span>
                <span className="font-mono text-foreground/70">{repo.branch}</span>
              </span>
              {syncInfo && (
                <span className="inline-flex items-center gap-1.5 text-[10px] text-muted-foreground">
                  <span className={`w-1.5 h-1.5 rounded-full ${syncInfo.dot}`} />
                  {syncInfo.label}
                  {lastSync && (
                    <span className="opacity-50">
                      · {new Date(lastSync.created_at * 1000).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                    </span>
                  )}
                </span>
              )}
              {lastSync && lastSync.changes_pulled > 0 && (
                <span className="text-[10px] text-muted-foreground">
                  <span className="text-primary font-mono">{lastSync.changes_pulled}</span> commits
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1 shrink-0">
          <Button
            size="sm"
            variant="outline"
            onClick={handleTest}
            disabled={testing}
            className="h-7 text-[11px]"
          >
            {testing ? '...' : 'Testar'}
          </Button>
          <button
            onClick={onEdit}
            className="w-7 h-7 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors text-sm"
            title="Editar"
          >
            ✎
          </button>
          <button
            onClick={() => setConfirmDelete(true)}
            disabled={deletingId === repo.id}
            className="w-7 h-7 rounded-lg flex items-center justify-center text-muted-foreground hover:text-red-400 hover:bg-red-500/10 transition-colors text-sm"
            title="Remover"
          >
            {deletingId === repo.id ? '...' : '✕'}
          </button>
        </div>
      </div>

      {/* Test result */}
      {testStatus && (
        <div className={`mx-4 mb-3 text-[11px] font-medium px-3 py-2 rounded-lg flex items-center gap-1.5 ${
          testStatus.ok
            ? 'bg-green-500/10 text-green-400 border border-green-500/20'
            : 'bg-red-500/10 text-red-400 border border-red-500/20'
        }`}>
          {testStatus.ok ? '✓' : '✗'}
          {testStatus.ok
            ? `Conexão OK${testStatus.user ? ` — autenticado como ${testStatus.user}` : ''}`
            : (testStatus.error ?? 'Falha na conexão')}
        </div>
      )}

      {/* Delete confirmation */}
      {confirmDelete && (
        <div className="mx-4 mb-3 rounded-lg border border-red-500/30 bg-red-500/5 px-3 py-2.5 space-y-2">
          <p className="text-xs font-medium text-red-400">Remover &quot;{repo.name}&quot;?</p>
          <p className="text-[11px] text-muted-foreground">
            O repositório será removido de todos os fluxos de entrega vinculados.
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => { setConfirmDelete(false); onDelete() }}
              className="text-[11px] font-medium px-3 py-1 rounded-lg bg-red-500/20 text-red-400 hover:bg-red-500/30 transition-colors"
            >
              Sim, remover
            </button>
            <button
              onClick={() => setConfirmDelete(false)}
              className="text-[11px] px-3 py-1 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Main panel ────────────────────────────────────────────────────────────────

export function GitHubSyncPanel() {
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [repos, setRepos] = useState<GitRepository[]>([])
  const [syncs, setSyncs] = useState<any[]>([])
  const [showForm, setShowForm] = useState(false)
  const [showImport, setShowImport] = useState(false)
  const [editingRepo, setEditingRepo] = useState<GitRepository | null>(null)
  const [saving, setSaving] = useState(false)
  const [deletingId, setDeletingId] = useState<number | null>(null)
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null)

  const showFeedback = (ok: boolean, text: string) => {
    setFeedback({ ok, text })
    setTimeout(() => setFeedback(null), 4000)
  }

  const load = useCallback(async () => {
    try {
      const [reposRes, syncRes] = await Promise.all([
        fetch('/api/workspace/git-repositories', { signal: AbortSignal.timeout(8000) }),
        fetch('/api/git-sync?action=status', { signal: AbortSignal.timeout(8000) }),
      ])
      if (reposRes.ok) setRepos((await reposRes.json()).repositories ?? [])
      if (syncRes.ok) setSyncs((await syncRes.json()).syncs ?? [])
    } catch { /* ignore */ }
  }, [])

  useEffect(() => { load().finally(() => setLoading(false)) }, [load])

  const handleSync = async () => {
    setSyncing(true)
    try {
      const res = await fetch('/api/git-sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'trigger-all' }),
        signal: AbortSignal.timeout(30000),
      })
      if (res.ok) {
        await load()
        showFeedback(true, 'Sincronização concluída')
      } else {
        showFeedback(false, 'Falha ao sincronizar')
      }
    } catch {
      showFeedback(false, 'Erro de rede')
    } finally {
      setSyncing(false)
    }
  }

  const handleCreate = async (data: Parameters<typeof RepoForm>[0]['onSave'] extends (d: infer D) => any ? D : never) => {
    setSaving(true)
    try {
      const res = await fetch('/api/workspace/git-repositories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      setRepos(prev => [...prev, json.repository])
      setShowForm(false)
      showFeedback(true, `"${data.name}" adicionado`)
    } catch (e: any) {
      showFeedback(false, e.message ?? 'Erro ao criar')
    } finally {
      setSaving(false)
    }
  }

  const handleUpdate = async (data: Parameters<typeof RepoForm>[0]['onSave'] extends (d: infer D) => any ? D : never) => {
    if (!editingRepo) return
    setSaving(true)
    try {
      const res = await fetch(`/api/workspace/git-repositories/${editingRepo.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      setRepos(prev => prev.map(r => r.id === editingRepo.id ? json.repository : r))
      setEditingRepo(null)
      showFeedback(true, 'Repositório atualizado')
    } catch (e: any) {
      showFeedback(false, e.message ?? 'Erro ao salvar')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id: number, name: string) => {
    setDeletingId(id)
    try {
      const res = await fetch(`/api/workspace/git-repositories/${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error((await res.json()).error)
      setRepos(prev => prev.filter(r => r.id !== id))
      showFeedback(true, `"${name}" removido`)
    } catch (e: any) {
      showFeedback(false, e.message ?? 'Erro ao remover')
    } finally {
      setDeletingId(null)
    }
  }

  // Find the most recent sync for a given repo URL
  const lastSyncFor = (repoUrl: string) =>
    syncs.find((s: any) => s.repo === repoUrl)

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

  const totalCommits = syncs.reduce((acc: number, s: any) => acc + (s.changes_pulled ?? 0), 0)
  const successCount = syncs.filter((s: any) => s.status === 'success').length

  return (
    <div className="p-5 space-y-5">

      {/* ── Header ── */}
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1 min-w-0">
          <h2 className="text-base font-semibold text-foreground">Repositórios Git</h2>
          <p className="text-xs text-muted-foreground max-w-2xl">
            Conecte seus repositórios para que os agentes acompanhem commits, PRs e mudanças de código.
            Vincule cada repo a um fluxo de entrega e a sincronização acontece automaticamente.
          </p>
          <div className="flex items-center gap-2 pt-0.5 flex-wrap">
            {(['Cadastre o repositório', 'Vincule a um fluxo de entrega', 'Agentes monitoram automaticamente'] as const).map((step, i) => (
              <span key={i} className="inline-flex items-center gap-1.5 text-[10px] text-muted-foreground/70">
                {i > 0 && <span className="text-muted-foreground/25 mr-0.5">→</span>}
                <span className="w-4 h-4 rounded-full bg-primary/15 text-primary flex items-center justify-center text-[9px] font-bold shrink-0">{i + 1}</span>
                {step}
              </span>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {repos.length > 0 && (
            <Button
              size="sm"
              variant="outline"
              onClick={handleSync}
              disabled={syncing}
              className="h-8 text-xs"
            >
              {syncing ? '↺ Sincronizando...' : '↺ Sincronizar agora'}
            </Button>
          )}
          {!showForm && !editingRepo && !showImport && (
            <>
              <Button size="sm" variant="outline" onClick={() => setShowImport(true)} className="h-8 text-xs">
                ↑ Importar em lote
              </Button>
              <Button size="sm" onClick={() => setShowForm(true)} className="h-8 text-xs">
                + Adicionar repositório
              </Button>
            </>
          )}
        </div>
      </div>

      {feedback && (
        <div className={`rounded-xl p-3 text-xs font-medium border ${
          feedback.ok
            ? 'bg-green-500/10 text-green-400 border-green-500/20'
            : 'bg-red-500/10 text-red-400 border-red-500/20'
        }`}>
          {feedback.text}
        </div>
      )}

      {/* ── Import panel ── */}
      {showImport && (
        <ImportPanel
          onDone={() => { setShowImport(false); load() }}
          onCancel={() => setShowImport(false)}
        />
      )}

      {/* ── Empty state ── */}
      {repos.length === 0 && !showForm && !showImport && (
        <div className="rounded-xl border border-dashed border-border/60 bg-secondary/20 py-16 px-6 flex flex-col items-center gap-4 text-center">
          <div className="w-14 h-14 rounded-2xl bg-secondary flex items-center justify-center text-3xl">🐙</div>
          <div>
            <p className="text-sm font-semibold text-foreground">Nenhum repositório conectado</p>
            <p className="text-xs text-muted-foreground mt-1 max-w-sm">
              Adicione um repositório para que os agentes acompanhem commits e PRs automaticamente.
              Funciona com GitHub, GitLab e Bitbucket.
            </p>
          </div>
          <div className="grid grid-cols-3 gap-4 text-xs text-muted-foreground mt-1">
            <div className="flex flex-col items-center gap-1.5">
              <span className="text-lg">📋</span>
              <span>Commits vinculados a cards do backlog</span>
            </div>
            <div className="flex flex-col items-center gap-1.5">
              <span className="text-lg">🔀</span>
              <span>Avisos automáticos de PRs abertos</span>
            </div>
            <div className="flex flex-col items-center gap-1.5">
              <span className="text-lg">📈</span>
              <span>Velocidade de entrega por repositório</span>
            </div>
          </div>
          <Button size="sm" onClick={() => setShowForm(true)} className="mt-1">
            + Conectar primeiro repositório
          </Button>
        </div>
      )}

      {/* ── Single add form ── */}
      {showForm && !showImport && (
        <RepoForm onSave={handleCreate} onCancel={() => setShowForm(false)} saving={saving} />
      )}

      {/* ── Two-column layout: repos + history ── */}
      {(repos.length > 0 || editingRepo) && (
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">

          {/* Left: repo list */}
          <div className="xl:col-span-2 space-y-3">

            {/* Stats bar */}
            {repos.length > 0 && (
              <div className="grid grid-cols-3 gap-3">
                <div className="rounded-xl border border-border/50 bg-card px-4 py-3">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Repositórios</p>
                  <p className="text-2xl font-semibold text-foreground mt-0.5">{repos.length}</p>
                </div>
                <div className="rounded-xl border border-border/50 bg-card px-4 py-3">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Commits sincronizados</p>
                  <p className="text-2xl font-semibold text-foreground mt-0.5">{totalCommits}</p>
                </div>
                <div className="rounded-xl border border-border/50 bg-card px-4 py-3">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Sincronizações OK</p>
                  <p className="text-2xl font-semibold text-foreground mt-0.5">{successCount}</p>
                </div>
              </div>
            )}

            {/* Repo cards */}
            {repos.map(repo => (
              editingRepo?.id === repo.id ? (
                <RepoForm
                  key={repo.id}
                  initial={repo}
                  onSave={handleUpdate}
                  onCancel={() => setEditingRepo(null)}
                  saving={saving}
                />
              ) : (
                <RepoCard
                  key={repo.id}
                  repo={repo}
                  lastSync={lastSyncFor(repo.repo_url)}
                  onEdit={() => setEditingRepo(repo)}
                  onDelete={() => handleDelete(repo.id, repo.name)}
                  deletingId={deletingId}
                />
              )
            ))}
          </div>

          {/* Right: sync history */}
          <div className="xl:col-span-1">
            <div className="rounded-xl border border-border/60 bg-card overflow-hidden sticky top-0">
              <div className="px-4 py-3 border-b border-border/50 flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-medium text-foreground">Histórico de sincronização</h3>
                  {syncs.length > 0 && (
                    <p className="text-[10px] text-muted-foreground mt-0.5">Últimas {Math.min(syncs.length, 30)} sincronizações</p>
                  )}
                </div>
                <button
                  onClick={load}
                  className="text-[10px] text-muted-foreground hover:text-foreground transition-colors px-2 py-1 rounded-lg hover:bg-secondary"
                  title="Atualizar"
                >
                  ↺
                </button>
              </div>

              {syncs.length === 0 ? (
                <div className="px-4 py-8 text-center">
                  <p className="text-xs text-muted-foreground">Nenhuma sincronização ainda</p>
                  <p className="text-[10px] text-muted-foreground/50 mt-1">Clique em &quot;Sincronizar agora&quot; para começar</p>
                </div>
              ) : (
                <div className="divide-y divide-border/40 max-h-[560px] overflow-y-auto">
                  {syncs.slice(0, 30).map((sync: any) => {
                    const info = STATUS_LABELS[sync.status] ?? { label: sync.status, dot: 'bg-muted-foreground/40' }
                    const p = PROVIDERS[sync.provider as GitProvider]
                    const shortRepo = sync.repo?.replace(/^https?:\/\/[^/]+\//, '').replace(/\.git$/, '')
                    return (
                      <div key={sync.id} className="px-4 py-2.5 hover:bg-secondary/30 transition-colors">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${info.dot}`} />
                            <span className="text-xs text-foreground/80 font-mono truncate">{shortRepo ?? sync.repo}</span>
                          </div>
                          <span className="text-[10px] text-muted-foreground shrink-0">{p?.icon}</span>
                        </div>
                        <div className="flex items-center gap-3 mt-0.5 pl-3.5">
                          <span className="text-[10px] text-muted-foreground">{info.label}</span>
                          {sync.changes_pulled > 0 && (
                            <span className="text-[10px] text-primary font-mono">+{sync.changes_pulled}</span>
                          )}
                          <span className="text-[10px] text-muted-foreground/40 ml-auto">
                            {new Date(sync.created_at * 1000).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

    </div>
  )
}
