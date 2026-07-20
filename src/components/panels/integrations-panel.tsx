'use client'

import { useState, useEffect, useCallback } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'

interface EnvVarInfo {
  redacted: string
  set: boolean
}

interface Integration {
  id: string
  name: string
  category: string
  categoryLabel: string
  envVars: Record<string, EnvVarInfo>
  status: 'connected' | 'partial' | 'not_configured'
  vaultItem: string | null
  testable: boolean
  recommendation?: string | null
}

interface Category {
  id: string
  label: string
}

const LLM_PRESETS = [
  { id: 'gemini',   name: 'Google Gemini', envKey: 'GOOGLE_API_KEY',   icon: '🔵' },
  { id: 'deepseek', name: 'DeepSeek',      envKey: 'DEEPSEEK_API_KEY', icon: '🐳' },
  { id: 'groq',     name: 'Groq',          envKey: 'GROQ_API_KEY',     icon: '⚡' },
  { id: 'mistral',  name: 'Mistral',       envKey: 'MISTRAL_API_KEY',  icon: '🌊' },
  { id: 'openai',   name: 'OpenAI',        envKey: 'OPENAI_API_KEY',   icon: '🤖' },
  { id: 'ollama',   name: 'Ollama (local)',envKey: 'OLLAMA_BASE_URL',  icon: '🦙' },
  { id: 'xai',      name: 'xAI Grok',      envKey: 'XAI_API_KEY',      icon: '𝕏'  },
  { id: 'custom',   name: '',              envKey: '',                  icon: '✨' },
] as const

export function IntegrationsPanel() {
  const t = useTranslations('integrations')
  const [integrations, setIntegrations] = useState<Integration[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [opAvailable, setOpAvailable] = useState(false)
  const [envPath, setEnvPath] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeCategory, setActiveCategory] = useState<string>('ai')

  // Edits: env var key -> new value
  const [edits, setEdits] = useState<Record<string, string>>({})
  const [revealed, setRevealed] = useState<Set<string>>(new Set())
  const [saving, setSaving] = useState(false)
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null)
  const [testing, setTesting] = useState<string | null>(null)
  const [pulling, setPulling] = useState<string | null>(null)
  const [pullingAll, setPullingAll] = useState(false)
  const [confirmRemove, setConfirmRemove] = useState<{ integrationId: string; keys: string[] } | null>(null)

  // Hidden integrations (persisted in localStorage)
  const [hidden, setHidden] = useState<Set<string>>(() => {
    try {
      const s = localStorage.getItem('vertex_hidden_integrations')
      return s ? new Set(JSON.parse(s)) : new Set()
    } catch { return new Set() }
  })

  const hideIntegration = (id: string) => {
    setHidden(prev => {
      const next = new Set(prev)
      next.add(id)
      try { localStorage.setItem('vertex_hidden_integrations', JSON.stringify([...next])) } catch {}
      return next
    })
  }

  const restoreAll = () => {
    setHidden(new Set())
    try { localStorage.removeItem('vertex_hidden_integrations') } catch {}
  }

  // Add integration form
  const [showAddForm, setShowAddForm] = useState(false)
  const [selectedPreset, setSelectedPreset] = useState<string | null>(null)
  const [addEnvKey, setAddEnvKey] = useState('')
  const [addEnvValue, setAddEnvValue] = useState('')
  const [addEnvName, setAddEnvName] = useState('')
  const [addRevealed, setAddRevealed] = useState(false)
  const [addSaving, setAddSaving] = useState(false)

  const applyPreset = (presetId: string) => {
    const preset = LLM_PRESETS.find(p => p.id === presetId)
    if (!preset) return
    setSelectedPreset(presetId)
    setAddEnvName(preset.name)
    setAddEnvKey(preset.envKey)
  }

  const showFeedback = (ok: boolean, text: string) => {
    setFeedback({ ok, text })
    setTimeout(() => setFeedback(null), 3000)
  }

  const fetchIntegrations = useCallback(async () => {
    try {
      const res = await fetch('/api/integrations')
      if (res.status === 401 || res.status === 403) {
        setError('Admin access required')
        return
      }
      if (!res.ok) {
        setError('Failed to load integrations')
        return
      }
      const data = await res.json()
      const allowedCategories = ['ai']
      setIntegrations((data.integrations || []).filter((i: Integration) => allowedCategories.includes(i.category)))
      setCategories((data.categories || []).filter((c: Category) => allowedCategories.includes(c.id)))
      setOpAvailable(data.opAvailable ?? false)
      setEnvPath(data.envPath ?? null)
      if (data.categories?.[0]) {
        setActiveCategory(prev => {
          // Keep current if valid, otherwise default to first
          const ids = (data.categories as Category[]).map((c: Category) => c.id)
          return ids.includes(prev) ? prev : ids[0]
        })
      }
    } catch {
      setError('Failed to load integrations')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchIntegrations() }, [fetchIntegrations])

  const handleEdit = (envKey: string, value: string) => {
    setEdits(prev => ({ ...prev, [envKey]: value }))
  }

  const cancelEdit = (envKey: string) => {
    setEdits(prev => {
      const next = { ...prev }
      delete next[envKey]
      return next
    })
  }

  const toggleReveal = (envKey: string) => {
    setRevealed(prev => {
      const next = new Set(prev)
      if (next.has(envKey)) next.delete(envKey)
      else next.add(envKey)
      return next
    })
  }

  const hasChanges = Object.keys(edits).length > 0

  const handleSave = async () => {
    if (!hasChanges) return
    setSaving(true)
    try {
      const res = await fetch('/api/integrations', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vars: edits }),
      })
      const data = await res.json()
      if (res.ok) {
        showFeedback(true, `Saved ${data.count} variable${data.count === 1 ? '' : 's'}`)
        setEdits({})
        setRevealed(new Set())
        fetchIntegrations()
      } else {
        showFeedback(false, data.error || 'Failed to save')
      }
    } catch {
      showFeedback(false, 'Network error')
    } finally {
      setSaving(false)
    }
  }

  const handleDiscard = () => {
    setEdits({})
    setRevealed(new Set())
  }

  const handleAddIntegration = async () => {
    const key = addEnvKey.trim().toUpperCase().replace(/\s+/g, '_')
    const value = addEnvValue.trim()
    if (!key || !value) return
    setAddSaving(true)
    try {
      const res = await fetch('/api/integrations', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vars: { [key]: value } }),
      })
      const data = await res.json()
      if (res.ok) {
        showFeedback(true, `Chave "${key}" salva com sucesso`)
        setShowAddForm(false)
        setAddEnvKey('')
        setAddEnvValue('')
        setAddEnvName('')
        setAddRevealed(false)
        fetchIntegrations()
      } else {
        showFeedback(false, data.error || 'Erro ao salvar')
      }
    } catch {
      showFeedback(false, 'Erro de rede')
    } finally {
      setAddSaving(false)
    }
  }

  const handleRemove = async (envKeys: string[], integrationId?: string) => {
    if (envKeys.length === 0) {
      // Not configured — just hide it, no API call needed
      if (integrationId) hideIntegration(integrationId)
      return
    }
    try {
      const res = await fetch(`/api/integrations?keys=${encodeURIComponent(envKeys.join(','))}`, {
        method: 'DELETE',
      })
      const data = await res.json()
      if (res.ok) {
        showFeedback(true, `${data.count} chave${data.count === 1 ? '' : 's'} removida${data.count === 1 ? '' : 's'}`)
        if (integrationId) hideIntegration(integrationId)
        fetchIntegrations()
      } else {
        showFeedback(false, data.error || 'Erro ao remover')
      }
    } catch {
      showFeedback(false, 'Erro de rede')
    }
  }

  const handleTest = async (integrationId: string) => {
    setTesting(integrationId)
    try {
      const res = await fetch('/api/integrations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'test', integrationId }),
      })
      const data = await res.json()
      if (data.ok) {
        showFeedback(true, data.detail || 'Connection successful')
      } else {
        showFeedback(false, data.detail || data.error || 'Test failed')
      }
    } catch {
      showFeedback(false, 'Network error')
    } finally {
      setTesting(null)
    }
  }

  const handlePull = async (integrationId: string) => {
    setPulling(integrationId)
    try {
      const res = await fetch('/api/integrations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'pull', integrationId }),
      })
      const data = await res.json()
      if (data.ok) {
        showFeedback(true, data.detail || 'Pulled from 1Password')
        fetchIntegrations()
      } else {
        showFeedback(false, data.error || 'Pull failed')
      }
    } catch {
      showFeedback(false, 'Network error')
    } finally {
      setPulling(null)
    }
  }

  const handlePullAll = async () => {
    setPullingAll(true)
    try {
      const res = await fetch('/api/integrations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'pull-all', category: activeCategory }),
      })
      const data = await res.json()
      if (data.ok) {
        showFeedback(true, data.detail || 'Pulled from 1Password')
        fetchIntegrations()
      } else {
        showFeedback(false, data.error || 'Pull failed')
      }
    } catch {
      showFeedback(false, 'Network error')
    } finally {
      setPullingAll(false)
    }
  }

  const confirmAndRemove = (integrationId: string, keys: string[]) => {
    setConfirmRemove({ integrationId, keys })
  }

  // Loading state
  if (loading) {
    return (
      <div className="p-6 flex items-center gap-2">
        <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        <span className="text-sm text-muted-foreground">{t('loading')}</span>
      </div>
    )
  }

  // Error state
  if (error) {
    return (
      <div className="p-6">
        <div className="bg-destructive/10 text-destructive rounded-lg p-4 text-sm">{error}</div>
      </div>
    )
  }

  const allFiltered = integrations.filter(i => i.category === activeCategory)
  const filteredIntegrations = allFiltered.filter(i => !hidden.has(i.id))
  const hiddenCount = allFiltered.filter(i => hidden.has(i.id)).length
  const connectedCount = integrations.filter(i => i.status === 'connected').length

  return (
    <div className="p-5 space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-foreground">{t('title')}</h2>
          <p className="text-xs text-muted-foreground mt-0.5 max-w-lg">
            Configure as chaves de API para conectar os agentes aos modelos de IA. Sem uma chave configurada, os agentes não conseguem chamar o modelo.
          </p>
          <div className="flex items-center gap-3 mt-2">
            {connectedCount > 0 ? (
              <span className="inline-flex items-center gap-1.5 text-[10px] font-medium text-green-400">
                <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
                {connectedCount} de {integrations.length} conectada{integrations.length === 1 ? '' : 's'}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 text-[10px] font-medium text-muted-foreground">
                <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/30" />
                Nenhuma integração configurada
              </span>
            )}
            {envPath && (
              <span className="text-[10px] font-mono text-muted-foreground/40" title={`Chaves salvas em ${envPath}`}>
                📄 {envPath.split(/[\\/]/).pop()}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {opAvailable && (
            <>
              <span className="text-2xs px-2 py-1 rounded bg-green-500/10 text-green-400 flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
                1P CLI
              </span>
              <Button
                onClick={handlePullAll}
                disabled={pullingAll}
                variant="outline"
                size="sm"
                className="flex items-center gap-1.5"
                title="Buscar todas as integrações do 1Password"
              >
                {pullingAll ? (
                  <div className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
                ) : (
                  <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M8 2v8M5 7l3 3 3-3" />
                    <path d="M3 12v2h10v-2" />
                  </svg>
                )}
                {t('pullAll')}
              </Button>
            </>
          )}
          {hasChanges && (
            <Button onClick={handleDiscard} variant="outline" size="sm">
              {t('discard')}
            </Button>
          )}
          <Button
            onClick={handleSave}
            disabled={!hasChanges || saving}
            variant={hasChanges ? 'default' : 'outline'}
            size="sm"
          >
            {saving ? t('saving') : t('saveChanges')}
          </Button>
          <Button
            onClick={() => setShowAddForm(v => !v)}
            size="sm"
            variant={showAddForm ? 'secondary' : 'default'}
          >
            {showAddForm ? '✕ Cancelar' : '+ Adicionar'}
          </Button>
        </div>
      </div>

      {/* Feedback */}
      {feedback && (
        <div className={`rounded-lg p-3 text-xs font-medium border ${
          feedback.ok
            ? 'bg-green-500/10 text-green-400 border-green-500/20'
            : 'bg-destructive/10 text-destructive border-destructive/20'
        }`}>
          {feedback.text}
        </div>
      )}

      {/* Add integration form */}
      {showAddForm && (
        <div className="rounded-xl border border-primary/30 bg-primary/5 p-5 space-y-4">
          <div>
            <p className="text-sm font-semibold text-foreground">Registrar provedor de IA</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Escolha um provedor conhecido ou configure um personalizado. A chave é salva no <span className="font-mono">.env</span> e fica disponível para todos os agentes.
            </p>
          </div>

          {/* Presets */}
          <div>
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium mb-2">Provedores conhecidos</p>
            <div className="flex flex-wrap gap-2">
              {LLM_PRESETS.map(preset => (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => applyPreset(preset.id)}
                  className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border transition-all font-medium ${
                    selectedPreset === preset.id
                      ? 'border-primary/60 bg-primary/10 text-primary'
                      : 'border-border/50 text-muted-foreground hover:border-border hover:text-foreground'
                  }`}
                >
                  <span>{preset.icon}</span>
                  {preset.id === 'custom' ? 'Personalizado' : preset.name}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-1.5">
                Nome do provedor
              </label>
              <input
                value={addEnvName}
                onChange={e => { setAddEnvName(e.target.value); setSelectedPreset('custom') }}
                placeholder="Ex: Llama, DeepSeek, Gemini…"
                className="w-full h-9 px-3 rounded-lg bg-background border border-border/60 text-sm text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:border-primary/50"
              />
            </div>
            <div>
              <label className="block text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-1.5">
                Variável de ambiente <span className="text-red-400">*</span>
              </label>
              <input
                value={addEnvKey}
                onChange={e => { setAddEnvKey(e.target.value.toUpperCase().replace(/\s+/g, '_')); setSelectedPreset('custom') }}
                placeholder="Ex: LLAMA_API_KEY"
                className="w-full h-9 px-3 rounded-lg bg-background border border-border/60 text-sm text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:border-primary/50 font-mono"
              />
            </div>
          </div>

          <div>
            <label className="block text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-1.5">
              Valor da chave <span className="text-red-400">*</span>
            </label>
            <div className="relative">
              <input
                type={addRevealed ? 'text' : 'password'}
                value={addEnvValue}
                onChange={e => setAddEnvValue(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleAddIntegration()}
                placeholder="Cole a chave de API aqui…"
                autoComplete="off"
                data-1p-ignore
                className="w-full h-9 px-3 pr-20 rounded-lg bg-background border border-border/60 text-sm text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:border-primary/50 font-mono"
              />
              <button
                type="button"
                onClick={() => setAddRevealed(v => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground/50 hover:text-foreground transition-colors px-1"
              >
                {addRevealed ? 'ocultar' : 'mostrar'}
              </button>
            </div>
          </div>

          <div className="flex gap-2 pt-1">
            <Button
              onClick={handleAddIntegration}
              disabled={addSaving || !addEnvKey.trim() || !addEnvValue.trim()}
              className="min-w-[130px]"
            >
              {addSaving ? 'Salvando…' : 'Salvar provedor'}
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                setShowAddForm(false)
                setAddEnvKey('')
                setAddEnvValue('')
                setAddEnvName('')
                setSelectedPreset(null)
              }}
            >
              Cancelar
            </Button>
          </div>
        </div>
      )}

      {/* Category tabs — only show when multiple categories */}
      {categories.length > 1 && (
        <div className="flex gap-1 border-b border-border pb-px overflow-x-auto">
          {categories.map(cat => {
            const catIntegrations = integrations.filter(i => i.category === cat.id)
            const catConnected = catIntegrations.filter(i => i.status === 'connected').length
            return (
              <Button
                key={cat.id}
                onClick={() => setActiveCategory(cat.id)}
                variant="ghost"
                size="sm"
                className={`rounded-t-md rounded-b-none relative whitespace-nowrap ${
                  activeCategory === cat.id
                    ? 'bg-card text-foreground border border-border border-b-card -mb-px'
                    : ''
                }`}
              >
                {cat.label}
                {catConnected > 0 && (
                  <span className="ml-1.5 inline-flex items-center justify-center min-w-[16px] h-4 text-2xs rounded-full bg-green-500/15 text-green-400 px-1">
                    {catConnected}
                  </span>
                )}
              </Button>
            )
          })}
        </div>
      )}

      {/* Integration cards */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {filteredIntegrations.map(integration => (
          <IntegrationCard
            key={integration.id}
            integration={integration}
            edits={edits}
            revealed={revealed}
            opAvailable={opAvailable}
            testing={testing === integration.id}
            pulling={pulling === integration.id}
            onEdit={handleEdit}
            onCancelEdit={cancelEdit}
            onToggleReveal={toggleReveal}
            onTest={() => handleTest(integration.id)}
            onPull={() => handlePull(integration.id)}
            onRemove={() => {
              const setKeys = Object.entries(integration.envVars)
                .filter(([, v]) => v.set)
                .map(([k]) => k)
              if (setKeys.length > 0) {
                confirmAndRemove(integration.id, setKeys)
              } else {
                hideIntegration(integration.id)
              }
            }}
          />
        ))}

        {filteredIntegrations.length === 0 && hiddenCount === 0 && (
          <div className="lg:col-span-2 rounded-xl border border-dashed border-border/50 py-12 text-center space-y-3">
            <p className="text-2xl">🤖</p>
            <p className="text-sm font-medium text-foreground">Nenhum provedor configurado</p>
            <p className="text-xs text-muted-foreground">Clique em &quot;+ Adicionar&quot; para registrar um modelo de IA.</p>
          </div>
        )}

        {hiddenCount > 0 && (
          <div className="lg:col-span-2 text-center pt-1">
            <button
              onClick={restoreAll}
              className="text-xs text-muted-foreground/50 hover:text-muted-foreground transition-colors"
            >
              {hiddenCount} provedor{hiddenCount > 1 ? 'es' : ''} oculto{hiddenCount > 1 ? 's' : ''} — restaurar todos
            </button>
          </div>
        )}
      </div>

      {/* Unsaved changes bar */}
      {hasChanges && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 bg-card border border-border rounded-lg shadow-lg px-4 py-2.5 flex items-center gap-3 z-40">
          <div className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
          <span className="text-xs text-foreground">
            {Object.keys(edits).length} alteração{Object.keys(edits).length === 1 ? '' : 'ões'} não salva{Object.keys(edits).length === 1 ? '' : 's'}
          </span>
          <Button
            onClick={handleDiscard}
            variant="ghost"
            size="xs"
          >
            {t('discard')}
          </Button>
          <Button
            onClick={handleSave}
            disabled={saving}
            size="xs"
          >
            {saving ? t('saving') : t('save')}
          </Button>
        </div>
      )}

      {/* Remove confirmation dialog */}
      {confirmRemove && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-card border border-border rounded-lg shadow-xl p-5 max-w-sm mx-4 space-y-4">
            <h3 className="text-sm font-semibold text-foreground">{t('removeTitle')}</h3>
            <p className="text-xs text-muted-foreground">
              {t('removeDescription', {
                target: confirmRemove.keys.length === 1 ? confirmRemove.keys[0] : String(confirmRemove.keys.length)
              })}
            </p>
            <div className="flex justify-end gap-2">
              <Button
                onClick={() => setConfirmRemove(null)}
                variant="outline"
                size="sm"
              >
                {t('cancel')}
              </Button>
              <Button
                onClick={() => {
                  handleRemove(confirmRemove.keys, confirmRemove.integrationId)
                  setConfirmRemove(null)
                }}
                variant="destructive"
                size="sm"
              >
                {t('remove')}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Integration card component
// ---------------------------------------------------------------------------

function IntegrationCard({
  integration,
  edits,
  revealed,
  opAvailable,
  testing,
  pulling,
  onEdit,
  onCancelEdit,
  onToggleReveal,
  onTest,
  onPull,
  onRemove,
}: {
  integration: Integration
  edits: Record<string, string>
  revealed: Set<string>
  opAvailable: boolean
  testing: boolean
  pulling: boolean
  onEdit: (key: string, value: string) => void
  onCancelEdit: (key: string) => void
  onToggleReveal: (key: string) => void
  onTest: () => void
  onPull: () => void
  onRemove: () => void
}) {
  const t = useTranslations('integrations')
  const statusColors = {
    connected: 'bg-green-500',
    partial: 'bg-amber-500',
    not_configured: 'bg-muted-foreground/30',
  }

  const statusLabels = {
    connected: 'Conectado',
    partial: 'Parcial',
    not_configured: 'Não configurado',
  }


  const hasEdits = Object.keys(integration.envVars).some(k => edits[k] !== undefined)
  const hasSetVars = Object.values(integration.envVars).some(v => v.set)

  return (
    <div className={`bg-card border rounded-lg p-4 transition-colors ${
      hasEdits ? 'border-primary/50' : 'border-border'
    }`}>
      {/* Card header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2.5">
          <span className={`w-2 h-2 rounded-full shrink-0 ${statusColors[integration.status]}`} />
          <span className="text-sm font-medium text-foreground">{integration.name}</span>
          <span className={`text-2xs px-1.5 py-0.5 rounded-full border font-medium ${
            integration.status === 'connected'
              ? 'border-green-500/30 bg-green-500/10 text-green-400'
              : integration.status === 'partial'
              ? 'border-amber-500/30 bg-amber-500/10 text-amber-400'
              : 'border-border/50 bg-muted text-muted-foreground'
          }`}>
            {statusLabels[integration.status]}
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          {/* Pull from 1Password */}
          {integration.vaultItem && opAvailable && (
            <Button
              onClick={onPull}
              disabled={pulling}
              title="Buscar credenciais do 1Password"
              variant="outline"
              size="xs"
              className="text-2xs flex items-center gap-1"
            >
              {pulling ? (
                <div className="w-3 h-3 border border-current border-t-transparent rounded-full animate-spin" />
              ) : (
                <svg className="w-3 h-3" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M8 2v8M5 7l3 3 3-3" />
                  <path d="M3 12v2h10v-2" />
                </svg>
              )}
              1Password
            </Button>
          )}

          {/* Test connection */}
          {integration.testable && hasSetVars && (
            <Button
              onClick={onTest}
              disabled={testing}
              title="Verificar se a conexão está funcionando"
              variant="outline"
              size="xs"
              className="text-2xs flex items-center gap-1"
            >
              {testing ? (
                <div className="w-3 h-3 border border-current border-t-transparent rounded-full animate-spin" />
              ) : (
                <svg className="w-3 h-3" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M13 3L6 14" />
                  <polyline points="6,3 6,8 1,8" />
                  <polyline points="10,8 15,8 15,13" />
                </svg>
              )}
              Testar conexão
            </Button>
          )}

          {/* Remove — always visible */}
          <Button
            onClick={onRemove}
            title={hasSetVars ? 'Remover chaves do arquivo .env' : 'Ocultar este provedor'}
            variant="outline"
            size="xs"
            className="text-2xs hover:text-destructive hover:border-destructive/50"
          >
            {hasSetVars ? t('remove') : 'Ocultar'}
          </Button>
        </div>
      </div>

      {/* Env var rows */}
      <div className="mt-3 space-y-2 pt-3 border-t border-border/40">
        <p className="text-[10px] text-muted-foreground/50 uppercase tracking-wider font-medium mb-2">Variáveis de ambiente</p>
        {Object.entries(integration.envVars).map(([envKey, info]) => {
          const isEditing = edits[envKey] !== undefined
          const isRevealed = revealed.has(envKey)

          return (
            <div key={envKey} className={`flex items-center gap-2 rounded-lg px-2 py-1.5 transition-colors ${isEditing ? 'bg-primary/5 border border-primary/20' : 'hover:bg-secondary/30'}`}>
              <div className="flex items-center gap-1.5 shrink-0">
                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${info.set ? 'bg-green-500' : 'bg-muted-foreground/20'}`} />
                <span className="text-2xs font-mono text-muted-foreground/60 w-36 truncate" title={envKey}>
                  {envKey}
                </span>
              </div>

              <div className="flex-1 flex items-center gap-1.5">
                {isEditing ? (
                  <input
                    type={isRevealed ? 'text' : 'password'}
                    value={edits[envKey]}
                    onChange={e => onEdit(envKey, e.target.value)}
                    placeholder="Cole o valor aqui..."
                    className="flex-1 px-2 py-1 text-xs bg-background border border-primary/40 rounded focus:border-primary focus:outline-none font-mono"
                    autoComplete="off"
                    data-1p-ignore
                  />
                ) : info.set ? (
                  <span className="text-xs font-mono text-muted-foreground">{info.redacted}</span>
                ) : (
                  <span className="text-xs text-muted-foreground/40 italic">{t('notSet')}</span>
                )}
              </div>

              <div className="flex items-center gap-1 shrink-0">
                {isEditing && (
                  <Button
                    onClick={() => onToggleReveal(envKey)}
                    title={isRevealed ? 'Ocultar valor' : 'Mostrar valor'}
                    variant="ghost"
                    size="icon-xs"
                    className="w-6 h-6"
                  >
                    {isRevealed ? <EyeOffIcon /> : <EyeIcon />}
                  </Button>
                )}
                {!isEditing && (
                  <Button
                    onClick={() => onEdit(envKey, '')}
                    title="Editar valor"
                    variant="ghost"
                    size="icon-xs"
                    className="w-6 h-6"
                  >
                    <EditIcon />
                  </Button>
                )}
                {isEditing && (
                  <Button
                    onClick={() => onCancelEdit(envKey)}
                    title="Cancelar edição"
                    variant="ghost"
                    size="icon-xs"
                    className="w-6 h-6 hover:text-destructive"
                  >
                    <XIcon />
                  </Button>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {integration.recommendation && (
        <div className="mt-3 rounded-md border border-border/60 bg-secondary/30 px-2.5 py-2">
          <p className="text-2xs text-muted-foreground">{integration.recommendation}</p>
          {integration.id === 'x_twitter' && (
            <div className="mt-1.5 flex flex-wrap items-center gap-2 text-2xs">
              <a
                href="https://github.com/0xNyk/xint"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline"
              >
                github.com/0xNyk/xint
              </a>
              <a
                href="https://github.com/0xNyk/xint-rs"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline"
              >
                github.com/0xNyk/xint-rs
              </a>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Inline SVG icons (matching nav-rail pattern: 16x16, stroke-based)
// ---------------------------------------------------------------------------

function EyeIcon() {
  return (
    <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 8s2.5-5 7-5 7 5 7 5-2.5 5-7 5-7-5-7-5z" />
      <circle cx="8" cy="8" r="2" />
    </svg>
  )
}

function EyeOffIcon() {
  return (
    <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 2l12 12" />
      <path d="M6.5 6.5a2 2 0 002.8 2.8" />
      <path d="M4.2 4.2C2.5 5.5 1 8 1 8s2.5 5 7 5c1.3 0 2.4-.4 3.4-1" />
      <path d="M11.8 11.8C13.5 10.5 15 8 15 8s-2.5-5-7-5c-.7 0-1.4.1-2 .3" />
    </svg>
  )
}

function EditIcon() {
  return (
    <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M11.5 1.5l3 3L5 14H2v-3l9.5-9.5z" />
    </svg>
  )
}

function XIcon() {
  return (
    <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 4l8 8M12 4l-8 8" />
    </svg>
  )
}
