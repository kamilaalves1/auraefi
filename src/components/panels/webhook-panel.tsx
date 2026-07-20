'use client'

import { useState, useEffect, useCallback } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { useSmartPoll } from '@/lib/use-smart-poll'
import { useMissionControl } from '@/store'

interface Webhook {
  id: number
  name: string
  url: string
  secret: string | null
  events: string[]
  enabled: boolean
  last_fired_at: number | null
  last_status: number | null
  total_deliveries: number
  successful_deliveries: number
  failed_deliveries: number
  created_at: number
  updated_at: number
}

interface Delivery {
  id: number
  webhook_id: number
  webhook_name: string
  webhook_url: string
  event_type: string
  payload: string
  status_code: number | null
  response_body: string | null
  error: string | null
  duration_ms: number
  created_at: number
}

interface SchedulerTask {
  id: string
  name: string
  enabled: boolean
  lastRun: number | null
  nextRun: number | null
  running: boolean
  lastResult?: { ok: boolean; message: string; timestamp: number }
}

const AVAILABLE_EVENTS = [
  { value: '*',                       label: 'Todos os eventos',   description: 'Recebe todos os tipos de evento',              group: 'geral' },
  { value: 'agent.error',             label: 'Erro de agente',     description: 'Agente entrou em estado de erro',              group: 'agentes' },
  { value: 'agent.status_change',     label: 'Status do agente',   description: 'Qualquer transição de status de agente',       group: 'agentes' },
  { value: 'security.login_failed',   label: 'Login falhou',       description: 'Tentativa de login malsucedida',               group: 'seguranca' },
  { value: 'security.user_created',   label: 'Usuário criado',     description: 'Nova conta de usuário criada',                 group: 'seguranca' },
  { value: 'security.user_deleted',   label: 'Usuário removido',   description: 'Conta de usuário excluída',                   group: 'seguranca' },
  { value: 'security.password_change',label: 'Senha alterada',     description: 'Senha de usuário modificada',                  group: 'seguranca' },
  { value: 'notification.mention',    label: 'Menção',             description: 'Agente foi @mencionado',                      group: 'atividade' },
  { value: 'notification.assignment', label: 'Atribuição',         description: 'Tarefa atribuída a agente',                   group: 'atividade' },
  { value: 'activity.task_created',   label: 'Tarefa criada',      description: 'Nova tarefa adicionada',                      group: 'atividade' },
  { value: 'activity.task_updated',   label: 'Tarefa atualizada',  description: 'Status de tarefa alterado',                   group: 'atividade' },
]

export function WebhookPanel() {
  const t = useTranslations('webhooks')
  const { dashboardMode } = useMissionControl()
  const isLocalMode = dashboardMode === 'local'
  const [webhooks, setWebhooks] = useState<Webhook[]>([])
  const [webhookAutomations, setWebhookAutomations] = useState<SchedulerTask[]>([])
  const [deliveries, setDeliveries] = useState<Delivery[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [editingWebhook, setEditingWebhook] = useState<Webhook | null>(null)
  const [selectedWebhook, setSelectedWebhook] = useState<number | null>(null)
  const [testingId, setTestingId] = useState<number | null>(null)
  const [testResult, setTestResult] = useState<any>(null)
  const [newSecret, setNewSecret] = useState<string | null>(null)
  const [copiedSecret, setCopiedSecret] = useState(false)
  const [deletingId, setDeletingId] = useState<number | null>(null)
  const [runningAutomationId, setRunningAutomationId] = useState<string | null>(null)

  const fetchWebhooks = useCallback(async () => {
    try {
      setLoading(true)
      const res = await fetch('/api/webhooks')
      if (!res.ok) {
        const data = await res.json()
        setError(data.error || 'Failed to fetch webhooks')
        return
      }
      const data = await res.json()
      setWebhooks(data.webhooks || [])
      setError('')
    } catch {
      setError('Network error')
    } finally {
      setLoading(false)
    }
  }, [])

  const fetchDeliveries = useCallback(async () => {
    if (!selectedWebhook) return
    try {
      const res = await fetch(`/api/webhooks/deliveries?webhook_id=${selectedWebhook}&limit=20`)
      if (res.ok) {
        const data = await res.json()
        setDeliveries(data.deliveries || [])
      }
    } catch { /* silent */ }
  }, [selectedWebhook])

  const fetchWebhookAutomations = useCallback(async () => {
    if (!isLocalMode) {
      setWebhookAutomations([])
      return
    }
    try {
      const res = await fetch('/api/scheduler')
      if (!res.ok) return
      const data = await res.json()
      const tasks = Array.isArray(data.tasks) ? data.tasks : []
      const webhookTasks = tasks.filter((task: SchedulerTask) =>
        typeof task.id === 'string' && task.id.includes('webhook')
      )
      setWebhookAutomations(webhookTasks)
    } catch {
      // Keep UI usable if scheduler endpoint is unavailable.
    }
  }, [isLocalMode])

  useEffect(() => { fetchWebhooks() }, [fetchWebhooks])
  useEffect(() => { fetchDeliveries() }, [fetchDeliveries])
  useEffect(() => { fetchWebhookAutomations() }, [fetchWebhookAutomations])
  useSmartPoll(fetchWebhooks, 60000, { pauseWhenDisconnected: true })
  useSmartPoll(fetchWebhookAutomations, 60000, { pauseWhenDisconnected: true })

  async function handleCreate(form: { name: string; url: string; events: string[] }) {
    try {
      const res = await fetch('/api/webhooks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, generate_secret: true }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error); return }
      setNewSecret(data.secret)
      setShowCreate(false)
      fetchWebhooks()
    } catch { setError('Failed to create webhook') }
  }

  async function handleToggle(id: number, enabled: boolean) {
    await fetch('/api/webhooks', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, enabled }),
    })
    fetchWebhooks()
  }

  async function handleDelete(id: number) {
    await fetch(`/api/webhooks?id=${id}`, { method: 'DELETE' })
    if (selectedWebhook === id) setSelectedWebhook(null)
    setDeletingId(null)
    fetchWebhooks()
  }

  async function handleUpdate(form: { name: string; url: string; events: string[] }) {
    if (!editingWebhook) return
    try {
      const res = await fetch('/api/webhooks', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: editingWebhook.id, ...form }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error || 'Falha ao atualizar webhook'); return }
      setEditingWebhook(null)
      fetchWebhooks()
    } catch { setError('Falha ao atualizar webhook') }
  }

  async function copySecret(secret: string) {
    try {
      await navigator.clipboard.writeText(secret)
      setCopiedSecret(true)
      setTimeout(() => setCopiedSecret(false), 2000)
    } catch { /* ignore */ }
  }

  async function handleTest(id: number) {
    setTestingId(id)
    setTestResult(null)
    try {
      const res = await fetch('/api/webhooks/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      })
      const data = await res.json()
      setTestResult(data)
      fetchWebhooks()
      if (selectedWebhook === id) fetchDeliveries()
    } catch {
      setTestResult({ error: 'Network error' })
    } finally {
      setTestingId(null)
    }
  }

  async function handleRunAutomation(taskId: string) {
    setRunningAutomationId(taskId)
    try {
      const res = await fetch('/api/scheduler', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ task_id: taskId }),
      })
      const data = await res.json()
      setTestResult({
        success: !!data.ok && res.ok,
        error: data.error || (!data.ok ? data.message : null),
        duration_ms: undefined,
        status_code: res.status,
      })
      await fetchWebhookAutomations()
    } catch {
      setTestResult({ success: false, error: 'Failed to run local automation' })
    } finally {
      setRunningAutomationId(null)
    }
  }

  function formatTime(ts: number) {
    return new Date(ts * 1000).toLocaleString(undefined, {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    })
  }

  return (
    <div className="p-5 space-y-4">

      {/* ── Header ── */}
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-0.5">
          <h2 className="text-base font-semibold text-foreground">{t('title')}</h2>
          <p className="text-xs text-muted-foreground max-w-xl">{t('subtitle')}</p>
          {webhooks.length > 0 && (
            <p className="text-2xs text-muted-foreground/50">{t('configured', { count: webhooks.length })}</p>
          )}
        </div>
        <Button onClick={() => { setShowCreate(true); setTestResult(null) }} size="sm" className="shrink-0">
          {t('addWebhook')}
        </Button>
      </div>

      {error && (
        <div className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-md px-3 py-2">
          {error}
        </div>
      )}

      {/* ── Segredo do webhook (logo após criação) ── */}
      {newSecret && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-4 space-y-3">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-xs font-bold text-amber-400">⚠ {t('secretLabel')}</p>
              <p className="text-2xs text-amber-300/70 mt-0.5">{t('secretWarning')}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <code className="flex-1 text-xs font-mono bg-secondary rounded px-2 py-2 text-foreground break-all select-all">
              {newSecret}
            </code>
            <Button
              size="sm"
              variant="outline"
              onClick={() => copySecret(newSecret)}
              className="shrink-0 text-xs border-amber-500/40 text-amber-400 hover:bg-amber-500/10"
            >
              {copiedSecret ? t('secretCopied') : t('copySecret')}
            </Button>
          </div>
          <Button variant="link" size="xs" onClick={() => setNewSecret(null)} className="text-muted-foreground">
            {t('dismiss')}
          </Button>
        </div>
      )}

      {/* ── Resultado do teste ── */}
      {testResult && (
        <div className={`rounded-lg border p-3 space-y-1 ${
          testResult.success ? 'border-green-500/30 bg-green-500/5' : 'border-red-500/30 bg-red-500/5'
        }`}>
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold">
              {testResult.success
                ? <span className="text-green-400">✓ {t('testSuccessful')}</span>
                : <span className="text-red-400">✗ {t('testFailed')}</span>
              }
            </p>
            <Button variant="link" size="xs" onClick={() => setTestResult(null)} className="text-muted-foreground">
              {t('dismiss')}
            </Button>
          </div>
          <div className="text-xs text-muted-foreground space-y-0.5">
            {testResult.status_code && <p>{t('testStatus')} <span className="font-mono text-foreground">{testResult.status_code}</span></p>}
            {testResult.duration_ms && <p>{t('testDuration')} <span className="font-mono text-foreground">{testResult.duration_ms}ms</span></p>}
            {testResult.error && <p className="text-red-400">{t('testError')} {testResult.error}</p>}
          </div>
        </div>
      )}

      {/* ── Formulário de criação ── */}
      {showCreate && (
        <WebhookForm
          title={t('newWebhook')}
          submitLabel={t('createWebhook')}
          onSubmit={handleCreate}
          onCancel={() => setShowCreate(false)}
        />
      )}

      {/* ── Formulário de edição ── */}
      {editingWebhook && (
        <WebhookForm
          title={t('editWebhook')}
          submitLabel={t('saveChanges')}
          initial={{ name: editingWebhook.name, url: editingWebhook.url, events: editingWebhook.events }}
          onSubmit={handleUpdate}
          onCancel={() => setEditingWebhook(null)}
        />
      )}

      {/* ── Lista de webhooks ── */}
      <div className="space-y-2">

        {/* Automações locais */}
        {isLocalMode && webhookAutomations.length > 0 && (
          <div className="rounded-lg border border-cyan-500/30 bg-cyan-500/5 p-3">
            <h3 className="text-xs font-semibold text-cyan-200">{t('localAutomations')}</h3>
            <p className="text-2xs text-cyan-300/70 mt-0.5 mb-2">{t('localAutomationsDesc')}</p>
            <div className="space-y-2">
              {webhookAutomations.map((task) => (
                <div key={task.id} className="rounded border border-cyan-500/20 bg-background/30 p-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className={`w-2 h-2 rounded-full shrink-0 ${task.running ? 'bg-blue-400 animate-pulse' : task.enabled ? 'bg-green-500' : 'bg-muted-foreground/40'}`} />
                        <span className="text-xs font-medium text-foreground truncate">{task.name}</span>
                        <span className="px-1.5 py-0.5 text-[10px] rounded bg-cyan-500/15 text-cyan-300 font-mono shrink-0">{task.id}</span>
                      </div>
                      <div className="text-2xs text-muted-foreground mt-1">
                        {task.nextRun ? t('nextRun', { time: formatTime(task.nextRun / 1000) }) : t('noNextRun')}
                        {task.lastResult?.message ? ` · ${task.lastResult.message}` : ''}
                      </div>
                    </div>
                    <Button
                      variant="ghost" size="xs"
                      onClick={() => handleRunAutomation(task.id)}
                      disabled={runningAutomationId === task.id}
                      className="text-cyan-300 hover:text-cyan-200 hover:bg-cyan-500/10 text-2xs shrink-0"
                    >
                      {runningAutomationId === task.id ? t('running') : t('run')}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Estado de carregamento */}
        {loading && webhooks.length === 0 && (
          <div className="space-y-2">
            {[...Array(3)].map((_, i) => <div key={i} className="h-16 rounded-lg shimmer" />)}
          </div>
        )}

        {/* Estado vazio */}
        {!loading && webhooks.length === 0 && (
          <div className="rounded-xl border border-dashed border-border bg-secondary/20 py-12 px-6 text-center space-y-3">
            <div className="text-2xl">🔗</div>
            <div>
              <p className="text-sm font-medium text-foreground">{t('noWebhooks')}</p>
              <p className="text-xs text-muted-foreground mt-1 max-w-md mx-auto">{t('noWebhooksDesc')}</p>
            </div>
            <p className="text-2xs text-muted-foreground/50">{t('noWebhooksExamples')}</p>
            <Button size="sm" onClick={() => setShowCreate(true)} className="mt-2">
              {t('addWebhook')}
            </Button>
          </div>
        )}

        {/* Linhas de webhook */}
        {webhooks.map((wh) => {
          const isExpanded = selectedWebhook === wh.id
          const isDeleting = deletingId === wh.id

          return (
            <div
              key={wh.id}
              className={`rounded-lg border transition-colors ${
                isExpanded ? 'border-primary/40 bg-primary/5' : 'border-border'
              }`}
            >
              <div className="flex items-start gap-3 p-3">

                {/* Área clicável principal */}
                <button
                  className="flex-1 min-w-0 text-left"
                  onClick={() => { setSelectedWebhook(isExpanded ? null : wh.id); setDeletingId(null) }}
                  title={t('expandHint')}
                >
                  <div className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full shrink-0 ${wh.enabled ? 'bg-green-500' : 'bg-muted-foreground/30'}`} />
                    <span className="text-sm font-medium text-foreground">{wh.name}</span>
                    {!wh.enabled && (
                      <span className="text-2xs px-1.5 py-0.5 rounded bg-muted/40 text-muted-foreground">inativo</span>
                    )}
                    {wh.last_status !== null && (
                      <span className={`text-2xs font-mono px-1.5 py-0.5 rounded ${
                        wh.last_status >= 200 && wh.last_status < 300
                          ? 'bg-green-500/10 text-green-400'
                          : 'bg-red-500/10 text-red-400'
                      }`}>
                        {wh.last_status}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground font-mono truncate mt-0.5">{wh.url}</p>
                  <div className="flex items-center gap-3 mt-1.5 text-2xs text-muted-foreground flex-wrap">
                    <span>{wh.events.includes('*') ? t('allEvents') : t('eventCount', { count: wh.events.length })}</span>
                    <span>{t('deliveries', { count: wh.total_deliveries })}</span>
                    {wh.failed_deliveries > 0 && (
                      <span className="text-red-400">{t('failed', { count: wh.failed_deliveries })}</span>
                    )}
                    {wh.last_fired_at && (
                      <span>{t('lastFired', { time: formatTime(wh.last_fired_at) })}</span>
                    )}
                  </div>
                </button>

                {/* Ações + chevron */}
                <div className="flex items-center gap-1 shrink-0">
                  <Button
                    variant="ghost" size="xs"
                    onClick={() => handleTest(wh.id)}
                    disabled={testingId === wh.id}
                    title={t('sendTestEvent')}
                    className="text-2xs"
                  >
                    {testingId === wh.id ? t('testing') : t('test')}
                  </Button>
                  <Button
                    variant="ghost" size="xs"
                    onClick={() => { setEditingWebhook(wh); setShowCreate(false); setSelectedWebhook(null); setDeletingId(null) }}
                    className="text-2xs text-blue-400 hover:bg-blue-500/10"
                  >
                    {t('edit')}
                  </Button>
                  <Button
                    variant="ghost" size="xs"
                    onClick={() => handleToggle(wh.id, !wh.enabled)}
                    className={`text-2xs ${wh.enabled ? 'text-amber-400 hover:bg-amber-500/10' : 'text-green-400 hover:bg-green-500/10'}`}
                  >
                    {wh.enabled ? t('disable') : t('enable')}
                  </Button>
                  <Button
                    variant="ghost" size="xs"
                    onClick={() => setDeletingId(isDeleting ? null : wh.id)}
                    className="text-red-400 hover:bg-red-500/10 text-2xs"
                  >
                    {t('delete')}
                  </Button>
                  {/* Chevron indica que a linha é expansível */}
                  <button
                    onClick={() => { setSelectedWebhook(isExpanded ? null : wh.id); setDeletingId(null) }}
                    className="ml-1 text-muted-foreground/40 hover:text-muted-foreground transition-colors"
                    aria-label={isExpanded ? 'Fechar histórico' : 'Ver histórico de disparos'}
                  >
                    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"
                      className={`w-3.5 h-3.5 transition-transform ${isExpanded ? 'rotate-180' : ''}`}>
                      <path d="M4 6l4 4 4-4" />
                    </svg>
                  </button>
                </div>
              </div>

              {/* Confirmação de exclusão */}
              {isDeleting && (
                <div className="mx-3 mb-3 rounded-md border border-red-500/30 bg-red-500/5 p-3 space-y-2">
                  <p className="text-xs font-semibold text-red-400">{t('deleteConfirmTitle')}</p>
                  <p className="text-2xs text-muted-foreground">{t('deleteConfirmDesc')}</p>
                  <div className="flex gap-2">
                    <Button size="xs" variant="ghost" onClick={() => setDeletingId(null)} className="text-muted-foreground">
                      {t('deleteCancel')}
                    </Button>
                    <Button size="xs" onClick={() => handleDelete(wh.id)}
                      className="bg-red-500/15 text-red-400 hover:bg-red-500/30 border border-red-500/20">
                      {t('deleteConfirmBtn')}
                    </Button>
                  </div>
                </div>
              )}

              {/* Histórico de disparos (expandido) */}
              {isExpanded && (
                <div className="mx-3 mb-3 pt-3 border-t border-border space-y-2">
                  <div className="flex items-center justify-between">
                    <h4 className="text-xs font-semibold text-foreground">{t('recentDeliveries')}</h4>
                    {deliveries.length > 0 && (
                      <span className="text-2xs text-muted-foreground">
                        {deliveries.filter(d => d.status_code && d.status_code >= 200 && d.status_code < 300).length}/{deliveries.length} bem-sucedidos
                      </span>
                    )}
                  </div>
                  {deliveries.length === 0 ? (
                    <p className="text-2xs text-muted-foreground italic">{t('noDeliveries')}</p>
                  ) : (
                    <div className="space-y-0.5 max-h-60 overflow-y-auto rounded-md bg-secondary/30 p-1.5">
                      {deliveries.map((d) => {
                        const ok = d.status_code !== null && d.status_code >= 200 && d.status_code < 300
                        return (
                          <div key={d.id} className="flex items-center gap-2 text-2xs py-1 px-2 rounded hover:bg-secondary/60">
                            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${ok ? 'bg-green-500' : 'bg-red-500'}`} />
                            <span className="font-mono text-muted-foreground w-28 shrink-0 truncate">{d.event_type}</span>
                            <span className={`font-mono w-8 shrink-0 ${ok ? 'text-green-400' : 'text-red-400'}`}>
                              {d.status_code ?? 'ERR'}
                            </span>
                            <span className="text-muted-foreground font-mono w-14 shrink-0">{d.duration_ms}ms</span>
                            {d.error && <span className="text-red-400 truncate">{d.error}</span>}
                            <span className="text-muted-foreground/40 ml-auto shrink-0">{formatTime(d.created_at)}</span>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function WebhookForm({
  title,
  submitLabel,
  initial,
  onSubmit,
  onCancel,
}: {
  title: string
  submitLabel: string
  initial?: { name: string; url: string; events: string[] }
  onSubmit: (form: { name: string; url: string; events: string[] }) => void
  onCancel: () => void
}) {
  const t = useTranslations('webhooks')
  const [name, setName] = useState(initial?.name ?? '')
  const [url, setUrl] = useState(initial?.url ?? '')
  const [selectedEvents, setSelectedEvents] = useState<string[]>(initial?.events ?? ['*'])

  function toggleEvent(value: string) {
    if (value === '*') {
      setSelectedEvents(['*'])
      return
    }
    setSelectedEvents((prev) => {
      const without = prev.filter((e) => e !== '*' && e !== value)
      if (prev.includes(value)) return without.length === 0 ? ['*'] : without
      return [...without, value]
    })
  }

  const eventGroups = [
    { key: 'geral',     label: t('formEventsGroupActivity'), events: AVAILABLE_EVENTS.filter(e => e.group === 'geral') },
    { key: 'agentes',   label: t('formEventsGroupAgent'),    events: AVAILABLE_EVENTS.filter(e => e.group === 'agentes') },
    { key: 'seguranca', label: t('formEventsGroupSecurity'), events: AVAILABLE_EVENTS.filter(e => e.group === 'seguranca') },
    { key: 'atividade', label: t('formEventsGroupActivity'), events: AVAILABLE_EVENTS.filter(e => e.group === 'atividade') },
  ].filter(g => g.events.length > 0)

  return (
    <div className="rounded-lg border border-primary/30 bg-primary/5 p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        <button onClick={onCancel} className="text-muted-foreground hover:text-foreground text-lg leading-none">×</button>
      </div>

      <div className="space-y-3">
        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1">{t('formName')}</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('formNameHint')}
            className="w-full h-8 px-2.5 rounded-md bg-secondary border border-border text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1">{t('formUrl')}</label>
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder={t('formUrlHint')}
            className="w-full h-8 px-2.5 rounded-md bg-secondary border border-border text-sm text-foreground font-mono focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-2">{t('formEventsTitle')}</label>
          <div className="space-y-2.5">
            {eventGroups.map(group => (
              <div key={group.key}>
                <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/50 mb-1">{group.label}</p>
                <div className="flex flex-wrap gap-1.5">
                  {group.events.map((ev) => (
                    <Button
                      key={ev.value}
                      type="button"
                      variant={selectedEvents.includes(ev.value) ? 'default' : 'secondary'}
                      size="xs"
                      onClick={() => toggleEvent(ev.value)}
                      title={ev.description}
                      className="h-6 text-2xs"
                    >
                      {ev.label}
                    </Button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="flex gap-2 pt-1">
        <Button variant="outline" size="sm" onClick={onCancel} className="flex-1">
          {t('cancel')}
        </Button>
        <Button
          size="sm"
          onClick={() => onSubmit({ name, url, events: selectedEvents })}
          disabled={!name || !url}
          className="flex-1"
        >
          {submitLabel}
        </Button>
      </div>
    </div>
  )
}
