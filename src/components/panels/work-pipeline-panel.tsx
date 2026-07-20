'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import type { WorkPipelineConfigJson, WorkPipelineProvider } from '@/lib/work-pipeline-types'
import { useWorkspaceSquadActive } from '@/lib/use-workspace-squad-active'
import { SquadSetupGate } from '@/components/workspace/squad-setup-gate'

interface PublicDto {
  provider: WorkPipelineProvider
  enabled: boolean
  config: WorkPipelineConfigJson
  hasCredentials: boolean
}

export function WorkPipelinePanel() {
  const t = useTranslations('workPipeline')
  const { squadActive, squadActiveLoading } = useWorkspaceSquadActive()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null)

  const [provider, setProvider] = useState<WorkPipelineProvider>('none')
  const [enabled, setEnabled] = useState(false)
  const [config, setConfig] = useState<WorkPipelineConfigJson>({})
  const [hasCredentials, setHasCredentials] = useState(false)

  const [jiraApiToken, setJiraApiToken] = useState('')
  const [azurePat, setAzurePat] = useState('')

  const showFeedback = (ok: boolean, text: string) => {
    setFeedback({ ok, text })
    setTimeout(() => setFeedback(null), 5000)
  }

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/work-pipeline')
      const data = (await res.json()) as PublicDto & { error?: string }
      if (!res.ok) {
        showFeedback(false, data.error || t('loadError'))
        return
      }
      setProvider(data.provider)
      setEnabled(data.enabled)
      setConfig(data.config || {})
      setHasCredentials(data.hasCredentials)
    } catch {
      showFeedback(false, t('loadError'))
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => {
    void load()
  }, [load])

  const save = async () => {
    setSaving(true)
    try {
      const secrets: Record<string, string> = {}
      if (provider === 'jira') {
        if (jiraApiToken.trim()) secrets.jiraApiToken = jiraApiToken.trim()
      }
      if (provider === 'azure_devops') {
        if (azurePat.trim()) secrets.azurePat = azurePat.trim()
      }

      const res = await fetch('/api/work-pipeline', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider,
          enabled,
          config,
          secrets: Object.keys(secrets).length ? secrets : undefined,
        }),
      })
      const data = (await res.json()) as PublicDto & { error?: string }
      if (!res.ok) {
        showFeedback(false, data.error || t('saveError'))
        return
      }
      setHasCredentials(data.hasCredentials)
      setJiraApiToken('')
      setAzurePat('')
      showFeedback(true, t('saved'))
      void load()
    } catch {
      showFeedback(false, t('saveError'))
    } finally {
      setSaving(false)
    }
  }

  const testConnection = async () => {
    setTesting(true)
    try {
      const secrets: Record<string, string> = {}
      if (provider === 'jira') {
        if (jiraApiToken.trim()) secrets.jiraApiToken = jiraApiToken.trim()
      }
      if (provider === 'azure_devops') {
        if (azurePat.trim()) secrets.azurePat = azurePat.trim()
      }

      const res = await fetch('/api/work-pipeline/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider,
          config,
          secrets: Object.keys(secrets).length ? secrets : undefined,
        }),
      })
      const data = (await res.json()) as { ok?: boolean; issueCount?: number; error?: string }
      if (!res.ok) {
        showFeedback(false, data.error || t('testFailed'))
        return
      }
      showFeedback(true, t('testOk', { count: data.issueCount ?? 0 }))
    } catch {
      showFeedback(false, t('testFailed'))
    } finally {
      setTesting(false)
    }
  }

  if (loading || squadActiveLoading) {
    return (
      <div className="p-6 text-sm text-muted-foreground">{t('loading')}</div>
    )
  }

  if (squadActive === false) {
    return (
      <div className="p-6 max-w-3xl mx-auto">
        <h1 className="text-lg font-semibold text-foreground mb-2">{t('title')}</h1>
        <SquadSetupGate reasonKey="workPipelineLocked" />
      </div>
    )
  }

  return (
    <div className="p-6 max-w-3xl space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-foreground">{t('title')}</h1>
        <p className="text-sm text-muted-foreground mt-1">{t('subtitle')}</p>
        <div className="mt-3 rounded-lg border border-primary/25 bg-primary/5 px-3 py-2.5 text-sm text-muted-foreground leading-relaxed space-y-2">
          <p>{t('journeyBody')}</p>
          <Link href="/delivery-flow" className="font-medium text-primary hover:underline inline-block">
            {t('openDeliveryFlow')}
          </Link>
        </div>
      </div>

      {feedback && (
        <div
          className={`rounded-lg border px-4 py-3 text-sm ${
            feedback.ok
              ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200'
              : 'border-red-500/40 bg-red-500/10 text-red-200'
          }`}
        >
          {feedback.text}
        </div>
      )}

      <div className="rounded-lg border border-border bg-card p-4 space-y-4">
        <div className="flex flex-col gap-2">
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            {t('provider')}
          </label>
          <select
            className="rounded-md border border-border bg-background px-3 py-2 text-sm"
            value={provider}
            onChange={(e) => setProvider(e.target.value as WorkPipelineProvider)}
          >
            <option value="none">{t('providerNone')}</option>
            <option value="jira">JIRA</option>
            <option value="azure_devops">Azure DevOps</option>
          </select>
        </div>

        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            className="rounded border-border"
          />
          {t('enabled')}
        </label>

        {provider === 'jira' && (
          <div className="space-y-3 pt-2 border-t border-border">
            <p className="text-xs text-muted-foreground">{t('jiraHelp')}</p>
            <Field
              label={t('jiraHost')}
              value={config.jiraHost || ''}
              onChange={(v) => setConfig({ ...config, jiraHost: v })}
              placeholder="https://suaempresa.atlassian.net"
            />
            <Field
              label={t('jiraProjectKey')}
              value={config.jiraProjectKey || ''}
              onChange={(v) => setConfig({ ...config, jiraProjectKey: v })}
              placeholder="PROJ"
            />
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted-foreground">{t('jiraJql')}</label>
              <textarea
                className="rounded-md border border-border bg-background px-3 py-2 text-sm min-h-[72px] font-mono"
                value={config.jiraJql || ''}
                onChange={(e) => setConfig({ ...config, jiraJql: e.target.value })}
                placeholder={t('jiraJqlPlaceholder')}
              />
            </div>
            <Field
              label={t('jiraEmail')}
              value={config.jiraAccountEmail || ''}
              onChange={(v) => setConfig({ ...config, jiraAccountEmail: v })}
              placeholder={t('jiraEmailPlaceholder')}
              autoComplete="off"
            />
            <Field
              label={t('jiraToken')}
              value={jiraApiToken}
              onChange={setJiraApiToken}
              placeholder={hasCredentials ? t('tokenUnchanged') : t('jiraTokenPlaceholder')}
              type="password"
              autoComplete="new-password"
            />
          </div>
        )}

        {provider === 'azure_devops' && (
          <div className="space-y-3 pt-2 border-t border-border">
            <p className="text-xs text-muted-foreground">{t('azureHelp')}</p>
            <Field
              label={t('azureOrgUrl')}
              value={config.azureOrganizationUrl || ''}
              onChange={(v) => setConfig({ ...config, azureOrganizationUrl: v })}
              placeholder="https://dev.azure.com/suaorg"
            />
            <Field
              label={t('azureProject')}
              value={config.azureProject || ''}
              onChange={(v) => setConfig({ ...config, azureProject: v })}
              placeholder={t('azureProjectPlaceholder')}
            />
            <Field
              label={t('azurePat')}
              value={azurePat}
              onChange={setAzurePat}
              placeholder={hasCredentials ? t('tokenUnchanged') : t('azurePatPlaceholder')}
              type="password"
              autoComplete="new-password"
            />
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <Button onClick={() => void save()} disabled={saving}>
          {saving ? t('saving') : t('save')}
        </Button>
        {provider !== 'none' && (
          <Button variant="outline" onClick={() => void testConnection()} disabled={testing}>
            {testing ? t('testing') : t('test')}
          </Button>
        )}
      </div>

      <div className="rounded-lg border border-border/60 bg-muted/30 p-4 text-xs text-muted-foreground space-y-2">
        <p className="font-medium text-foreground">{t('agentsHeading')}</p>
        <p>{t('agentsApi')}</p>
        <code className="block font-mono text-[11px] bg-background/80 rounded px-2 py-1 border border-border">
          GET /api/work-pipeline/backlog?limit=50
        </code>
        <p>{t('agentsNote')}</p>
      </div>
    </div>
  )
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  type = 'text',
  autoComplete,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  type?: string
  autoComplete?: string
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs text-muted-foreground">{label}</label>
      <input
        type={type}
        className="rounded-md border border-border bg-background px-3 py-2 text-sm"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete={autoComplete}
      />
    </div>
  )
}
