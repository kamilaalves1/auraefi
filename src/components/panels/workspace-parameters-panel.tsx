'use client'

import { useCallback, useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { useNavigateToPanel } from '@/lib/navigation'
import { useWorkspaceSquadActive } from '@/lib/use-workspace-squad-active'
import { SquadSetupGate } from '@/components/workspace/squad-setup-gate'
import { Button } from '@/components/ui/button'

type Row = { key: string; value: string }

export function WorkspaceParametersPanel() {
  const t = useTranslations('workspaceParameters')
  const navigate = useNavigateToPanel()
  const { squadActive, squadActiveLoading } = useWorkspaceSquadActive()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [rows, setRows] = useState<Row[]>([])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/workspace/parameters')
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'load failed')
      const v = (data.values || {}) as Record<string, string>
      const next = Object.entries(v).map(([key, value]) => ({ key, value }))
      setRows(next.length > 0 ? next : [{ key: '', value: '' }])
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Error')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      const values: Record<string, string> = {}
      for (const r of rows) {
        const k = r.key.trim()
        if (!k) continue
        values[k] = r.value
      }
      const res = await fetch('/api/workspace/parameters', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ values }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || data.details?.join?.(', ') || 'save failed')
      const v = (data.values || {}) as Record<string, string>
      const next = Object.entries(v).map(([key, value]) => ({ key, value }))
      setRows(next.length > 0 ? next : [{ key: '', value: '' }])
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Error')
    } finally {
      setSaving(false)
    }
  }

  if (loading || squadActiveLoading) {
    return <div className="p-6 text-sm text-muted-foreground">{t('loading')}</div>
  }

  if (squadActive === false) {
    return (
      <div className="p-4 max-w-3xl mx-auto">
        <h2 className="text-lg font-semibold text-foreground mb-2">{t('title')}</h2>
        <SquadSetupGate reasonKey="parametersLocked" />
      </div>
    )
  }

  return (
    <div className="p-4 max-w-3xl mx-auto space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-foreground">{t('title')}</h2>
        <p className="text-sm text-muted-foreground mt-1">{t('subtitle')}</p>
        <p className="text-xs text-muted-foreground mt-2">{t('syntaxHint')}</p>
        <div className="mt-2 flex flex-wrap gap-2">
          <Button type="button" size="sm" variant="secondary" onClick={() => navigate('delivery-flow')}>
            {t('goDeliveryFlow')}
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={() => navigate('agents')}>
            {t('goPipelines')}
          </Button>
        </div>
      </div>

      {error && <div className="text-sm text-red-500 border border-red-500/30 rounded-md p-2">{error}</div>}

      <div className="rounded-lg border border-border bg-card p-3 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-muted-foreground">{t('rows')}</span>
          <Button type="button" size="xs" variant="secondary" onClick={() => setRows((r) => [...r, { key: '', value: '' }])}>
            {t('addRow')}
          </Button>
        </div>
        {rows.map((row, i) => (
          <div key={i} className="flex flex-col sm:flex-row gap-2">
            <input
              value={row.key}
              onChange={(e) => setRows((r) => r.map((x, j) => (j === i ? { ...x, key: e.target.value } : x)))}
              placeholder={t('keyPlaceholder')}
              className="flex-1 h-9 px-2 rounded-md bg-secondary border border-border text-sm font-mono"
            />
            <input
              value={row.value}
              onChange={(e) => setRows((r) => r.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))}
              placeholder={t('valuePlaceholder')}
              className="flex-[2] h-9 px-2 rounded-md bg-secondary border border-border text-sm"
            />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="shrink-0"
              onClick={() => setRows((r) => (r.length <= 1 ? r : r.filter((_, j) => j !== i)))}
            >
              {t('remove')}
            </Button>
          </div>
        ))}
      </div>

      <div className="flex gap-2">
        <Button type="button" onClick={() => void save()} disabled={saving}>
          {saving ? t('saving') : t('save')}
        </Button>
        <Button type="button" variant="secondary" onClick={() => void load()}>
          {t('reload')}
        </Button>
      </div>
    </div>
  )
}
