'use client'

import { useState, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'

interface AlertRule {
  id: number
  name: string
  enabled: number
  entity_type: string
  condition_field: string
  condition_operator: string
  condition_value: string
  action_type: string
  action_config: string
  cooldown_minutes: number
  last_triggered_at: number | null
  trigger_count: number
}

interface AuditEntry {
  id: number
  action: string
  actor: string
  detail: string | null
  created_at: number
}

interface RetentionSettings {
  activities: string
  audit: string
  logs: string
  notifications: string
  pipeline_runs: string
  token_usage: string
}

function Section({ title, description, children, action }: {
  title: string
  description?: string
  children: React.ReactNode
  action?: React.ReactNode
}) {
  return (
    <div>
      <div className="flex items-start justify-between mb-3">
        <div>
          <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">{title}</h2>
          {description && <p className="text-xs text-muted-foreground/60 mt-0.5">{description}</p>}
        </div>
        {action}
      </div>
      {children}
    </div>
  )
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="text-sm text-muted-foreground py-6 border border-dashed border-border/40 rounded-lg text-center">
      {text}
    </div>
  )
}

const fieldLabel: Record<string, string> = {
  daily_cost_usd: 'Custo diário (USD)',
  monthly_cost_usd: 'Custo mensal (USD)',
  daily_tokens: 'Tokens diários',
  total_cost_usd: 'Custo total (USD)',
}

const actionTypeLabel: Record<string, string> = {
  notification: 'Notificação interna',
  email: 'E-mail',
  webhook: 'Webhook',
  block: 'Bloquear',
}

const actionTypeColors: Record<string, string> = {
  notification: 'bg-blue-500/15 text-blue-400',
  email: 'bg-green-500/15 text-green-400',
  webhook: 'bg-purple-500/15 text-purple-400',
  block: 'bg-red-500/15 text-red-400',
}

const actionLabel: Record<string, string> = {
  user_created: 'Usuário criado',
  user_updated: 'Usuário atualizado',
  user_deleted: 'Usuário excluído',
  login: 'Login',
  login_failed: 'Login falhou',
  alert_rule_created: 'Alerta criado',
  alert_rule_deleted: 'Alerta excluído',
  setting_updated: 'Configuração alterada',
  webhook_created: 'Webhook criado',
}

export function GovernancePanel() {
  const [alerts, setAlerts] = useState<AlertRule[]>([])
  const [auditLog, setAuditLog] = useState<AuditEntry[]>([])
  const [retention, setRetention] = useState<RetentionSettings>({
    activities: '90', audit: '365', logs: '30',
    notifications: '60', pipeline_runs: '90', token_usage: '90',
  })
  const [loading, setLoading] = useState(true)
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null)
  const [savingRetention, setSavingRetention] = useState(false)

  // Alert form state
  const [showAlertForm, setShowAlertForm] = useState(false)
  const [alertForm, setAlertForm] = useState({
    name: '',
    condition_field: 'daily_cost_usd',
    condition_value: '',
    cooldown_minutes: 60,
    action_type: 'notification' as 'notification' | 'email' | 'webhook' | 'block',
    webhook_url: '',
    email_to: '',
  })
  const [savingAlert, setSavingAlert] = useState(false)

  const showFeedback = (ok: boolean, text: string) => {
    setFeedback({ ok, text })
    setTimeout(() => setFeedback(null), 3500)
  }

  const fetchAll = useCallback(async () => {
    setLoading(true)
    try {
      const [aRes, auRes, sRes] = await Promise.all([
        fetch('/api/alerts', { cache: 'no-store' }),
        fetch('/api/audit?limit=12', { cache: 'no-store' }),
        fetch('/api/settings', { cache: 'no-store' }),
      ])
      const aJson = await aRes.json().catch(() => ({}))
      const auJson = await auRes.json().catch(() => ({}))
      const sJson = await sRes.json().catch(() => ({}))

      const allAlerts: AlertRule[] = Array.isArray(aJson?.rules) ? aJson.rules : []
      setAlerts(allAlerts.filter(r => r.entity_type === 'token_cost'))
      setAuditLog(Array.isArray(auJson?.entries) ? auJson.entries.slice(0, 10) : [])

      if (sJson?.settings) {
        const s = sJson.settings
        setRetention({
          activities: s['retention.activities_days'] ?? '90',
          audit: s['retention.audit_days'] ?? '365',
          logs: s['retention.logs_days'] ?? '30',
          notifications: s['retention.notifications_days'] ?? '60',
          pipeline_runs: s['retention.pipeline_runs_days'] ?? '90',
          token_usage: s['retention.token_usage_days'] ?? '90',
        })
      }
    } catch {
      // partial data ok
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchAll() }, [fetchAll])

  const handleSaveAlert = async () => {
    if (!alertForm.name || !alertForm.condition_value) return
    if (alertForm.action_type === 'webhook' && !alertForm.webhook_url) return
    if (alertForm.action_type === 'email' && !alertForm.email_to) return
    setSavingAlert(true)

    const actionConfig: Record<string, string> = {}
    if (alertForm.action_type === 'webhook') actionConfig.url = alertForm.webhook_url
    else if (alertForm.action_type === 'email') actionConfig.email_to = alertForm.email_to
    else actionConfig.recipient = 'coordinator'

    const res = await fetch('/api/alerts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: alertForm.name,
        entity_type: 'token_cost',
        condition_field: alertForm.condition_field,
        condition_operator: 'greater_than',
        condition_value: String(alertForm.condition_value),
        cooldown_minutes: alertForm.cooldown_minutes,
        action_type: alertForm.action_type,
        action_config: actionConfig,
      }),
    }).catch(() => null)
    setSavingAlert(false)
    if (res?.ok) {
      showFeedback(true, 'Alerta criado')
      setShowAlertForm(false)
      setAlertForm({ name: '', condition_field: 'daily_cost_usd', condition_value: '', cooldown_minutes: 60, action_type: 'notification', webhook_url: '', email_to: '' })
      fetchAll()
    } else {
      showFeedback(false, 'Falha ao criar alerta')
    }
  }

  const handleToggleAlert = async (a: AlertRule) => {
    await fetch('/api/alerts', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: a.id, enabled: a.enabled ? 0 : 1 }),
    }).catch(() => null)
    fetchAll()
  }

  const handleDeleteAlert = async (id: number) => {
    const res = await fetch('/api/alerts', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    }).catch(() => null)
    if (res?.ok) { showFeedback(true, 'Alerta removido'); fetchAll() }
  }

  const handleSaveRetention = async () => {
    setSavingRetention(true)
    const settings = {
      'retention.activities_days': retention.activities,
      'retention.audit_days': retention.audit,
      'retention.logs_days': retention.logs,
      'retention.notifications_days': retention.notifications,
      'retention.pipeline_runs_days': retention.pipeline_runs,
      'retention.token_usage_days': retention.token_usage,
    }
    const res = await fetch('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ settings }),
    }).catch(() => null)
    setSavingRetention(false)
    showFeedback(!!res?.ok, res?.ok ? 'Retenção salva' : 'Falha ao salvar')
  }

  const formatDate = (ts: number | null) =>
    ts ? new Date(ts * 1000).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : 'Nunca'

  const activeBlocks = alerts.filter(a => a.enabled && a.action_type === 'block')
  const triggeredBlock = activeBlocks.find(a => {
    if (!a.last_triggered_at) return false
    const now = Math.floor(Date.now() / 1000)
    return (now - a.last_triggered_at) < a.cooldown_minutes * 60
  })

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      {/* Header */}
      <div className="shrink-0 px-6 pt-6 pb-4 border-b border-border/50">
        <h1 className="text-xl font-semibold text-foreground">Governança</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Limites de custo, retenção de dados e auditoria</p>
      </div>

      {feedback && (
        <div className={`mx-6 mt-4 px-4 py-2.5 rounded-lg text-sm ${feedback.ok ? 'bg-green-500/15 text-green-400 border border-green-500/30' : 'bg-red-500/15 text-red-400 border border-red-500/30'}`}>
          {feedback.text}
        </div>
      )}

      {/* Active block banner */}
      {triggeredBlock && (
        <div className="mx-6 mt-4 px-4 py-3 rounded-lg bg-red-500/10 border border-red-500/30 text-sm text-red-400 flex items-center gap-2">
          <span className="text-base">🚫</span>
          <div>
            <span className="font-medium">Bloqueio ativo:</span> {triggeredBlock.name} — novos envios LLM estão bloqueados até o cooldown expirar.
          </div>
        </div>
      )}

      <div className="flex-1 px-6 py-5 space-y-8">

        {/* 1. Alertas de custo */}
        <Section
          title="Alertas de custo"
          description="Notifique ou bloqueie quando o consumo ultrapassar um limite. Use ação 'Webhook' para integrar com Slack, Teams ou qualquer serviço externo."
          action={
            <Button onClick={() => setShowAlertForm(v => !v)} variant="outline" size="xs">
              {showAlertForm ? 'Cancelar' : '+ Novo alerta'}
            </Button>
          }
        >
          {showAlertForm && (
            <div className="bg-card border border-border/50 rounded-lg p-4 mb-3 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-muted-foreground block mb-1">Nome</label>
                  <input className="w-full bg-background border border-border/50 rounded px-3 py-1.5 text-sm text-foreground focus:outline-none focus:border-primary/50"
                    placeholder="Ex: Custo diário alto" value={alertForm.name}
                    onChange={e => setAlertForm(f => ({ ...f, name: e.target.value }))} />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground block mb-1">Métrica</label>
                  <select className="w-full bg-background border border-border/50 rounded px-3 py-1.5 text-sm text-foreground focus:outline-none focus:border-primary/50"
                    value={alertForm.condition_field}
                    onChange={e => setAlertForm(f => ({ ...f, condition_field: e.target.value }))}>
                    <option value="daily_cost_usd">Custo diário (USD)</option>
                    <option value="monthly_cost_usd">Custo mensal (USD)</option>
                    <option value="daily_tokens">Tokens diários</option>
                    <option value="total_cost_usd">Custo total (USD)</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs text-muted-foreground block mb-1">Limite (maior que)</label>
                  <input className="w-full bg-background border border-border/50 rounded px-3 py-1.5 text-sm text-foreground focus:outline-none focus:border-primary/50"
                    type="number" min="0" step="0.01" placeholder="Ex: 10.00"
                    value={alertForm.condition_value}
                    onChange={e => setAlertForm(f => ({ ...f, condition_value: e.target.value }))} />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground block mb-1">Cooldown (min)</label>
                  <input className="w-full bg-background border border-border/50 rounded px-3 py-1.5 text-sm text-foreground focus:outline-none focus:border-primary/50"
                    type="number" min="1" value={alertForm.cooldown_minutes}
                    onChange={e => setAlertForm(f => ({ ...f, cooldown_minutes: Number(e.target.value) }))} />
                </div>
              </div>

              {/* Action type */}
              <div>
                <label className="text-xs text-muted-foreground block mb-1.5">Ação quando o limite for atingido</label>
                <div className="flex gap-2">
                  {(['notification', 'email', 'webhook', 'block'] as const).map(type => (
                    <button
                      key={type}
                      onClick={() => setAlertForm(f => ({ ...f, action_type: type }))}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                        alertForm.action_type === type
                          ? actionTypeColors[type] + ' border-current/30'
                          : 'border-border/50 text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      {type === 'notification' && '🔔 Notificar'}
                      {type === 'email' && '✉ E-mail'}
                      {type === 'webhook' && '🔗 Webhook'}
                      {type === 'block' && '🚫 Bloquear'}
                    </button>
                  ))}
                </div>
                {alertForm.action_type === 'notification' && (
                  <p className="text-xs text-muted-foreground/60 mt-1.5">Cria uma notificação interna para administradores.</p>
                )}
                {alertForm.action_type === 'block' && (
                  <p className="text-xs text-amber-400/80 mt-1.5">⚠ Quando acionado, novos envios LLM serão bloqueados até o cooldown expirar.</p>
                )}
              </div>

              {alertForm.action_type === 'email' && (
                <div>
                  <label className="text-xs text-muted-foreground block mb-1">Destinatário (e-mail)</label>
                  <input className="w-full bg-background border border-border/50 rounded px-3 py-1.5 text-sm text-foreground focus:outline-none focus:border-primary/50"
                    type="email" placeholder="gestor@empresa.com" value={alertForm.email_to}
                    onChange={e => setAlertForm(f => ({ ...f, email_to: e.target.value }))} />
                  <p className="text-xs text-muted-foreground/60 mt-1">Requer configuração de SMTP em Configurações → Integrações. Também suporta serviços como SendGrid ou Mailgun.</p>
                </div>
              )}

              {alertForm.action_type === 'webhook' && (
                <div>
                  <label className="text-xs text-muted-foreground block mb-1">URL do Webhook</label>
                  <input className="w-full bg-background border border-border/50 rounded px-3 py-1.5 text-sm text-foreground focus:outline-none focus:border-primary/50"
                    placeholder="https://hooks.slack.com/services/..." value={alertForm.webhook_url}
                    onChange={e => setAlertForm(f => ({ ...f, webhook_url: e.target.value }))} />
                  <p className="text-xs text-muted-foreground/60 mt-1">Suporta Slack Incoming Webhooks, Discord, Teams, ou qualquer endpoint HTTP.</p>
                </div>
              )}

              <Button
                onClick={handleSaveAlert}
                disabled={savingAlert || !alertForm.name || !alertForm.condition_value || (alertForm.action_type === 'webhook' && !alertForm.webhook_url) || (alertForm.action_type === 'email' && !alertForm.email_to)}
                size="xs"
              >
                {savingAlert ? 'Salvando...' : 'Salvar alerta'}
              </Button>
            </div>
          )}

          {loading ? (
            <div className="text-sm text-muted-foreground">Carregando...</div>
          ) : alerts.length === 0 ? (
            <EmptyState text="Nenhum alerta de custo configurado. Crie um acima." />
          ) : (
            <div className="space-y-2">
              {alerts.map(a => {
                const config = (() => { try { return JSON.parse(a.action_config || '{}') } catch { return {} } })()
                return (
                  <div key={a.id} className={`flex items-center justify-between bg-card border rounded-lg px-4 py-3 ${
                    !a.enabled ? 'border-border/30 opacity-60' : 'border-border/50'
                  }`}>
                    <div className="flex items-center gap-3">
                      <div className={`w-2 h-2 rounded-full shrink-0 ${a.enabled ? 'bg-green-400' : 'bg-gray-500'}`} />
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-foreground">{a.name}</span>
                          <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${actionTypeColors[a.action_type] || 'bg-gray-500/15 text-gray-400'}`}>
                            {actionTypeLabel[a.action_type] ?? a.action_type}
                          </span>
                        </div>
                        <div className="text-xs text-muted-foreground mt-0.5">
                          {fieldLabel[a.condition_field] ?? a.condition_field} &gt; {a.condition_value}
                          {config.url && <span className="ml-2 truncate max-w-[200px] inline-block align-bottom">→ {config.url}</span>}
                          {config.email_to && <span className="ml-2">→ {config.email_to}</span>}
                          {a.trigger_count > 0 && <span className="ml-2">· acionado {a.trigger_count}×</span>}
                          {a.last_triggered_at && <span className="ml-2">· último: {formatDate(a.last_triggered_at)}</span>}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Button onClick={() => handleToggleAlert(a)} variant="outline" size="xs"
                        className="text-muted-foreground">
                        {a.enabled ? 'Pausar' : 'Ativar'}
                      </Button>
                      <Button onClick={() => handleDeleteAlert(a.id)} variant="destructive" size="xs">Remover</Button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </Section>

        {/* 2. Retenção de dados */}
        <Section
          title="Retenção de dados"
          description="Quantos dias manter cada tipo de dado antes da limpeza automática. Use 0 para nunca apagar."
          action={
            <Button onClick={handleSaveRetention} disabled={savingRetention} variant="outline" size="xs">
              {savingRetention ? 'Salvando...' : 'Salvar'}
            </Button>
          }
        >
          <div className="bg-card border border-border/50 rounded-lg overflow-hidden">
            {([
              ['activities', 'Atividades'],
              ['audit', 'Auditoria'],
              ['logs', 'Logs'],
              ['notifications', 'Notificações'],
              ['pipeline_runs', 'Execuções de pipeline'],
              ['token_usage', 'Uso de tokens'],
            ] as [keyof RetentionSettings, string][]).map(([key, label]) => (
              <div key={key} className="flex items-center justify-between px-4 py-3 border-b border-border/20 last:border-0">
                <span className="text-sm text-foreground">{label}</span>
                <div className="flex items-center gap-2">
                  <input
                    className="w-20 bg-background border border-border/50 rounded px-2 py-1 text-sm text-foreground text-right focus:outline-none focus:border-primary/50"
                    type="number" min="0"
                    value={retention[key]}
                    onChange={e => setRetention(r => ({ ...r, [key]: e.target.value }))}
                  />
                  <span className="text-xs text-muted-foreground">dias</span>
                </div>
              </div>
            ))}
          </div>
        </Section>

        {/* 3. Auditoria */}
        <Section title="Auditoria recente">
          {loading ? (
            <div className="text-sm text-muted-foreground">Carregando...</div>
          ) : auditLog.length === 0 ? (
            <EmptyState text="Sem registros de auditoria recentes" />
          ) : (
            <div className="bg-card border border-border/50 rounded-lg overflow-hidden">
              {auditLog.map(entry => (
                <div key={entry.id} className="flex items-start justify-between px-4 py-3 border-b border-border/20 last:border-0 hover:bg-muted/20 transition-colors">
                  <div className="flex items-center gap-3">
                    <div className={`w-1.5 h-1.5 rounded-full mt-1.5 shrink-0 ${
                      entry.action.includes('fail') || entry.action.includes('delet') ? 'bg-red-400' : 'bg-green-400'
                    }`} />
                    <div>
                      <div className="text-sm text-foreground">
                        <span className="font-medium">{entry.actor}</span>
                        <span className="text-muted-foreground"> · {actionLabel[entry.action] ?? entry.action}</span>
                      </div>
                      {entry.detail && <div className="text-xs text-muted-foreground mt-0.5">{entry.detail}</div>}
                    </div>
                  </div>
                  <div className="text-xs text-muted-foreground shrink-0 ml-4">{formatDate(entry.created_at)}</div>
                </div>
              ))}
            </div>
          )}
        </Section>

      </div>
    </div>
  )
}
