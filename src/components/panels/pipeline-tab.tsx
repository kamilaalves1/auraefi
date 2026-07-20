'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { defaultPipelineStepsFromTemplates } from '@/lib/default-pipeline-form'
import { PipelineStepsVisualCanvas, type PipelineStepsCanvasLabels } from '@/components/panels/pipeline-steps-canvas'

interface WorkflowTemplate {
  id: number
  name: string
  model: string
}

interface PipelineStep {
  template_id: number
  template_name?: string
  on_failure: 'stop' | 'continue'
  parameters?: Record<string, string>
}

interface Pipeline {
  id: number
  name: string
  description: string | null
  steps: PipelineStep[]
  use_count: number
  last_used_at: number | null
  runs: { total: number; completed: number; failed: number; running: number }
  client_metadata?: Record<string, unknown>
}

function paramsToLines(p: Record<string, string> | undefined): string {
  if (!p || Object.keys(p).length === 0) return ''
  return Object.entries(p)
    .map(([k, v]) => `${k}=${v}`)
    .join('\n')
}

function linesToParams(s: string): Record<string, string> {
  const o: Record<string, string> = {}
  for (const line of s.split('\n')) {
    const m = line.match(/^\s*([a-zA-Z][a-zA-Z0-9_.-]*)\s*=\s*(.*)$/)
    if (m) o[m[1]] = m[2].trim().slice(0, 4000)
  }
  return o
}

interface RunStepState {
  step_index: number
  template_id: number
  template_name: string
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped'
  spawn_id: string | null
  started_at: number | null
  completed_at: number | null
  error: string | null
}

interface PipelineRun {
  id: number
  pipeline_id: number
  pipeline_name?: string
  status: string
  current_step: number
  steps_snapshot: RunStepState[]
  started_at: number | null
  completed_at: number | null
  triggered_by: string
  created_at: number
}

export function PipelineTab() {
  const t = useTranslations('pipeline')
  const pipelineCanvasLabels = useMemo<PipelineStepsCanvasLabels>(
    () => ({
      stepBadge: (n: number) => t('canvasStepBadge', { n }),
      stopOnFail: t('stopOnFail'),
      continueOnFail: t('continueOnFail'),
      edgeThen: t('edgeThen'),
    }),
    [t],
  )
  const [templates, setTemplates] = useState<WorkflowTemplate[]>([])
  const [pipelines, setPipelines] = useState<Pipeline[]>([])
  const [runs, setRuns] = useState<PipelineRun[]>([])

  // Form state
  const [formMode, setFormMode] = useState<'hidden' | 'create' | 'edit'>('hidden')
  const [editingId, setEditingId] = useState<number | null>(null)
  const [formName, setFormName] = useState('')
  const [formDesc, setFormDesc] = useState('')
  const [formClientLabel, setFormClientLabel] = useState('')
  const [formClientNotes, setFormClientNotes] = useState('')
  const [formPipelineParamsLines, setFormPipelineParamsLines] = useState('')
  const [formSteps, setFormSteps] = useState<PipelineStep[]>([])
  const [formStepParamLines, setFormStepParamLines] = useState<string[]>([])

  // UI state
  const [expandedId, setExpandedId] = useState<number | null>(null)
  const [spawning, setSpawning] = useState<number | null>(null)
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null)

  const applyDefaultPipelineForm = useCallback(() => {
    if (templates.length < 2) {
      setFormSteps([])
      setFormStepParamLines([])
      setFormName('')
      setFormDesc('')
      return
    }
    const steps = defaultPipelineStepsFromTemplates(templates.map((x) => ({ id: x.id, name: x.name })))
    setFormSteps(steps)
    setFormStepParamLines(steps.map(() => ''))
    setFormName(t('defaultPipelineName'))
    setFormDesc(t('defaultPipelineDescription'))
  }, [templates, t])

  const fetchData = useCallback(async () => {
    const [tRes, pRes, rRes] = await Promise.all([
      fetch('/api/workflows').then(r => r.json()).catch(() => ({ templates: [] })),
      fetch('/api/pipelines').then(r => r.json()).catch(() => ({ pipelines: [] })),
      fetch('/api/pipelines/run?limit=10').then(r => r.json()).catch(() => ({ runs: [] })),
    ])
    setTemplates(tRes.templates || [])
    setPipelines(pRes.pipelines || [])
    setRuns(rRes.runs || [])
  }, [])

  useEffect(() => {
    void fetchData()
  }, [fetchData])

  /** If templates load after opening “New pipeline”, fill default steps once the list is ready. */
  useEffect(() => {
    if (formMode !== 'create') return
    if (templates.length < 2) return
    if (formSteps.length !== 0) return
    applyDefaultPipelineForm()
  }, [formMode, templates, formSteps.length, applyDefaultPipelineForm])

  // Clear result after 3s
  useEffect(() => {
    if (!result) return
    const timer = setTimeout(() => setResult(null), 3000)
    return () => clearTimeout(timer)
  }, [result])

  const closeForm = () => {
    setFormMode('hidden')
    setEditingId(null)
    setFormName('')
    setFormDesc('')
    setFormClientLabel('')
    setFormClientNotes('')
    setFormPipelineParamsLines('')
    setFormSteps([])
    setFormStepParamLines([])
  }

  const addStep = (templateId: number) => {
    const tpl = templates.find((x) => x.id === templateId)
    if (!tpl) return
    setFormSteps((s) => [...s, { template_id: templateId, template_name: tpl.name, on_failure: 'stop' }])
    setFormStepParamLines((lines) => [...lines, ''])
  }

  const removeStep = (index: number) => {
    setFormSteps(s => s.filter((_, i) => i !== index))
    setFormStepParamLines(lines => lines.filter((_, i) => i !== index))
  }

  const moveStep = (index: number, dir: -1 | 1) => {
    setFormSteps(s => {
      const arr = [...s]
      const target = index + dir
      if (target < 0 || target >= arr.length) return arr
      ;[arr[index], arr[target]] = [arr[target], arr[index]]
      return arr
    })
    setFormStepParamLines(lines => {
      const arr = [...lines]
      const target = index + dir
      if (target < 0 || target >= arr.length) return arr
      ;[arr[index], arr[target]] = [arr[target], arr[index]]
      return arr
    })
  }

  const savePipeline = async () => {
    if (!formName || formSteps.length < 2) return
    try {
      const pipelineParams = linesToParams(formPipelineParamsLines)
      const client_metadata: Record<string, unknown> = {}
      if (formClientLabel.trim()) client_metadata.clientLabel = formClientLabel.trim()
      if (formClientNotes.trim()) client_metadata.clientNotes = formClientNotes.trim()
      if (Object.keys(pipelineParams).length > 0) client_metadata.parameters = pipelineParams

      const stepsPayload = formSteps.map((s, i) => {
        const stepPm = linesToParams(formStepParamLines[i] || '')
        const base: { template_id: number; on_failure: 'stop' | 'continue'; parameters?: Record<string, string> } = {
          template_id: s.template_id,
          on_failure: s.on_failure,
        }
        if (Object.keys(stepPm).length > 0) base.parameters = stepPm
        return base
      })

      const payload = {
        ...(formMode === 'edit' ? { id: editingId } : {}),
        name: formName,
        description: formDesc || null,
        steps: stepsPayload,
        ...(formMode === 'edit'
          ? { client_metadata }
          : Object.keys(client_metadata).length > 0
            ? { client_metadata }
            : {}),
      }
      const res = await fetch('/api/pipelines', {
        method: formMode === 'edit' ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (res.ok) {
        closeForm()
        fetchData()
        setResult({ ok: true, text: formMode === 'edit' ? 'Pipeline updated' : 'Pipeline created' })
      } else {
        const data = await res.json()
        setResult({ ok: false, text: data.error || 'Failed' })
      }
    } catch {
      setResult({ ok: false, text: 'Network error' })
    }
  }

  const startEdit = (p: Pipeline) => {
    setFormMode('edit')
    setEditingId(p.id)
    setFormName(p.name)
    setFormDesc(p.description || '')
    const meta = p.client_metadata || {}
    setFormClientLabel(typeof meta.clientLabel === 'string' ? meta.clientLabel : '')
    setFormClientNotes(typeof meta.clientNotes === 'string' ? meta.clientNotes : '')
    const pp = meta.parameters
    if (pp && typeof pp === 'object' && !Array.isArray(pp)) {
      setFormPipelineParamsLines(paramsToLines(pp as Record<string, string>))
    } else {
      setFormPipelineParamsLines('')
    }
    setFormSteps(p.steps)
    setFormStepParamLines(p.steps.map(s => paramsToLines(s.parameters)))
  }

  const deletePipeline = async (id: number) => {
    await fetch(`/api/pipelines?id=${id}`, { method: 'DELETE' })
    if (expandedId === id) setExpandedId(null)
    fetchData()
  }

  const runPipeline = async (id: number) => {
    setSpawning(id)
    try {
      const res = await fetch('/api/pipelines/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'start', pipeline_id: id }),
      })
      const data = await res.json()
      if (res.ok) {
        setResult({ ok: true, text: `Pipeline started (run #${data.run?.id})` })
        fetchData()
      } else {
        setResult({ ok: false, text: data.error || 'Failed to start' })
      }
    } catch {
      setResult({ ok: false, text: 'Network error' })
    } finally {
      setSpawning(null)
    }
  }

  const advanceRun = async (runId: number, success: boolean) => {
    try {
      await fetch('/api/pipelines/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'advance', run_id: runId, success }),
      })
      fetchData()
    } catch { /* ignore */ }
  }

  const cancelRun = async (runId: number) => {
    try {
      await fetch('/api/pipelines/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'cancel', run_id: runId }),
      })
      fetchData()
    } catch { /* ignore */ }
  }

  // Active runs (running pipelines shown at top)
  const activeRuns = runs.filter(r => r.status === 'running')

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 space-y-2">
        <div className="text-sm font-semibold text-foreground">{t('whatIsTitle')}</div>
        <p className="text-xs text-muted-foreground leading-relaxed">{t('whatIsBody')}</p>
        <ol className="text-xs text-muted-foreground space-y-1.5 list-decimal list-inside max-w-xl">
          <li>{t('whatIsStep1')}</li>
          <li>{t('whatIsStep2')}</li>
          <li>{t('whatIsStep3')}</li>
        </ol>
      </div>

      {/* Result message */}
      {result && (
        <div className={`text-xs px-2 py-1 rounded ${result.ok ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'}`}>
          {result.text}
        </div>
      )}

      {/* Active runs banner */}
      {activeRuns.length > 0 && (
        <div className="space-y-2">
          {activeRuns.map(run => (
            <ActiveRunCard key={run.id} run={run} onAdvance={advanceRun} onCancel={cancelRun} />
          ))}
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">{t('pipelineCount', { count: pipelines.length })}</span>
        <Button
          onClick={() => {
            if (formMode !== 'hidden') {
              closeForm()
              return
            }
            setFormMode('create')
            setEditingId(null)
            setFormClientLabel('')
            setFormClientNotes('')
            setFormPipelineParamsLines('')
            applyDefaultPipelineForm()
          }}
          variant="link"
          size="xs"
        >
          {formMode !== 'hidden' ? t('cancel') : t('newPipeline')}
        </Button>
      </div>

      {/* Create/Edit form */}
      {formMode !== 'hidden' && (
        <div className="p-3 rounded-lg bg-secondary/50 border border-border space-y-2">
          <span className="text-xs font-medium">{formMode === 'edit' ? t('editPipeline') : t('newPipeline')}</span>
          <input
            value={formName}
            onChange={e => setFormName(e.target.value)}
            placeholder={t('pipelineNamePlaceholder')}
            className="w-full h-8 px-2 rounded-md bg-secondary border border-border text-sm text-foreground"
          />
          <input
            value={formDesc}
            onChange={e => setFormDesc(e.target.value)}
            placeholder={t('descriptionPlaceholder')}
            className="w-full h-8 px-2 rounded-md bg-secondary border border-border text-sm text-foreground"
          />
          <input
            value={formClientLabel}
            onChange={e => setFormClientLabel(e.target.value)}
            placeholder={t('clientLabelPlaceholder')}
            className="w-full h-8 px-2 rounded-md bg-secondary border border-border text-sm text-foreground"
          />
          <textarea
            value={formClientNotes}
            onChange={e => setFormClientNotes(e.target.value)}
            placeholder={t('clientNotesPlaceholder')}
            rows={2}
            className="w-full px-2 py-1 rounded-md bg-secondary border border-border text-xs text-foreground resize-none"
          />
          <div>
            <label className="text-2xs text-muted-foreground block mb-0.5">{t('pipelineParametersLabel')}</label>
            <textarea
              value={formPipelineParamsLines}
              onChange={e => setFormPipelineParamsLines(e.target.value)}
              placeholder={t('pipelineParametersPlaceholder')}
              rows={3}
              className="w-full px-2 py-1 rounded-md bg-secondary border border-border text-xs font-mono text-foreground resize-none"
            />
          </div>

          <div className="space-y-1.5 rounded-lg border border-border/80 bg-muted/10 p-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-medium text-foreground">{t('diagramTitle')}</span>
              <Button type="button" size="xs" variant="outline" onClick={applyDefaultPipelineForm} disabled={templates.length < 2}>
                {t('useDefaultPipeline')}
              </Button>
            </div>
            {templates.length < 2 ? (
              <p className="text-2xs text-amber-500/90">{t('defaultPipelineNeedsTemplates')}</p>
            ) : null}
            <p className="text-2xs text-muted-foreground">{t('defaultPipelineHelper')}</p>
            <p className="text-2xs text-muted-foreground">{t('diagramHint')}</p>
            {formSteps.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border py-10 text-center text-xs text-muted-foreground">
                {t('stepsSectionHint')}
              </div>
            ) : (
              <PipelineStepsVisualCanvas steps={formSteps} labels={pipelineCanvasLabels} />
            )}
            <p className="text-2xs text-muted-foreground px-0.5">{t('canvasControlsHint')}</p>
          </div>

          {/* Step builder */}
          <div className="space-y-1">
            <span className="text-xs font-medium text-foreground">{t('stepsSectionTitle')}</span>
            <span className="text-2xs text-muted-foreground block">{t('stepsSectionHint')}</span>
            {formSteps.map((step, i) => (
              <div key={i} className="space-y-1">
                <div className="flex items-center gap-1.5 p-1.5 rounded bg-secondary/80 text-xs">
                  <span className="w-5 h-5 rounded-full bg-primary/20 text-primary text-2xs font-bold flex items-center justify-center shrink-0">
                    {i + 1}
                  </span>
                  <span className="flex-1 truncate text-foreground">{step.template_name || `Template #${step.template_id}`}</span>
                  <select
                    value={step.on_failure}
                    onChange={e => setFormSteps(s => s.map((st, idx) => idx === i ? { ...st, on_failure: e.target.value as 'stop' | 'continue' } : st))}
                    className="h-5 px-1 text-2xs rounded bg-secondary border border-border text-foreground"
                  >
                    <option value="stop">{t('stopOnFail')}</option>
                    <option value="continue">{t('continueOnFail')}</option>
                  </select>
                  <Button onClick={() => moveStep(i, -1)} variant="ghost" size="icon-xs" className="w-5 h-5" title="Move up">
                    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" className="w-3 h-3"><path d="M8 3v10M4 7l4-4 4 4" /></svg>
                  </Button>
                  <Button onClick={() => moveStep(i, 1)} variant="ghost" size="icon-xs" className="w-5 h-5" title="Move down">
                    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" className="w-3 h-3"><path d="M8 13V3M4 9l4 4 4-4" /></svg>
                  </Button>
                  <Button onClick={() => removeStep(i)} variant="ghost" size="icon-xs" className="w-5 h-5 text-red-400 hover:text-red-300">
                    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-3 h-3"><path d="M4 4l8 8M12 4l-8 8" strokeLinecap="round" /></svg>
                  </Button>
                </div>
                <div className="pl-7 space-y-0.5">
                  <label className="text-2xs text-muted-foreground">{t('stepParametersLabel', { n: i + 1 })}</label>
                  <textarea
                    value={formStepParamLines[i] ?? ''}
                    onChange={e =>
                      setFormStepParamLines(lines => {
                        const next = [...lines]
                        while (next.length < formSteps.length) next.push('')
                        next[i] = e.target.value
                        return next
                      })
                    }
                    placeholder={t('stepParametersPlaceholder')}
                    rows={2}
                    className="w-full px-2 py-1 rounded-md bg-secondary/60 border border-border text-2xs font-mono text-foreground resize-none"
                  />
                </div>
              </div>
            ))}

            {/* Add step dropdown */}
            <select
              onChange={e => { if (e.target.value) { addStep(parseInt(e.target.value)); e.target.value = '' } }}
              className="w-full h-7 px-2 rounded-md bg-secondary border border-border text-xs text-muted-foreground"
              defaultValue=""
            >
              <option value="" disabled>{t('addStepPlaceholder')}</option>
              {templates.map(t => (
                <option key={t.id} value={t.id}>{t.name} ({t.model})</option>
              ))}
            </select>
          </div>

          <div className="flex justify-end">
            <Button
              onClick={savePipeline}
              disabled={!formName || formSteps.length < 2}
              size="xs"
            >
              {formMode === 'edit' ? t('update') : t('savePipeline')}
            </Button>
          </div>
        </div>
      )}

      {/* Pipeline list */}
      {pipelines.length === 0 && formMode === 'hidden' ? (
        <div className="text-center py-4">
          <p className="text-sm text-muted-foreground mb-2">{t('noPipelines')}</p>
          <p className="text-xs text-muted-foreground">{t('noPipelinesHint')}</p>
        </div>
      ) : (
        <div className="space-y-1.5 max-h-64 overflow-y-auto">
          {pipelines.map(p => (
            <div key={p.id} className="rounded-md bg-secondary/30 hover:bg-secondary/50 transition-smooth group">
              <div className="flex items-center gap-2 p-2">
                <Button
                  variant="ghost"
                  onClick={() => setExpandedId(expandedId === p.id ? null : p.id)}
                  className="flex-1 min-w-0 text-left h-auto p-0 rounded-none"
                >
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium text-foreground truncate">{p.name}</span>
                    {typeof p.client_metadata?.clientLabel === 'string' && p.client_metadata.clientLabel.trim() ? (
                      <span className="text-2xs px-1.5 py-0.5 rounded border border-border text-muted-foreground shrink-0">
                        {p.client_metadata.clientLabel}
                      </span>
                    ) : null}
                    <span className="text-2xs text-muted-foreground">{p.steps.length} steps</span>
                    {p.use_count > 0 && <span className="text-2xs text-muted-foreground">{p.use_count}x</span>}
                    {p.runs.running > 0 && (
                      <span className="text-2xs px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-400 animate-pulse">running</span>
                    )}
                  </div>
                  {/* Mini step visualization */}
                  <div className="flex items-center gap-0.5 mt-1">
                    {p.steps.map((s, i) => (
                      <div key={i} className="flex items-center gap-0.5">
                        <span className="text-2xs px-1 py-0.5 rounded bg-secondary text-muted-foreground truncate max-w-[80px]">
                          {s.template_name}
                        </span>
                        {i < p.steps.length - 1 && (
                          <svg viewBox="0 0 8 8" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-2.5 h-2.5 text-muted-foreground/50 shrink-0">
                            <path d="M2 4h4M5 2l2 2-2 2" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        )}
                      </div>
                    ))}
                  </div>
                </Button>
                <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-smooth shrink-0">
                  <Button
                    onClick={() => runPipeline(p.id)}
                    disabled={spawning === p.id}
                    size="xs"
                  >
                    {spawning === p.id ? '...' : 'Run'}
                  </Button>
                  <Button onClick={() => startEdit(p)} variant="secondary" size="icon-xs" title="Edit">
                    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-3.5 h-3.5">
                      <path d="M11.5 1.5l3 3-9 9H2.5v-3z" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </Button>
                  <Button onClick={() => deletePipeline(p.id)} variant="destructive" size="icon-xs" title="Delete">
                    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-3.5 h-3.5">
                      <path d="M4 4l8 8M12 4l-8 8" strokeLinecap="round" />
                    </svg>
                  </Button>
                </div>
              </div>

              {/* Expanded: pipeline visualization + recent runs */}
              {expandedId === p.id && (
                <div className="px-3 pb-3 border-t border-border/50 mt-1 pt-2 space-y-3">
                  {/* Full pipeline visualization */}
                  <PipelineViz steps={p.steps} labels={pipelineCanvasLabels} />

                  {p.description && <p className="text-xs text-muted-foreground">{p.description}</p>}

                  {/* Recent runs for this pipeline */}
                  <div>
                    <span className="text-2xs text-muted-foreground">
                      Runs: {p.runs.total} total, {p.runs.completed} completed, {p.runs.failed} failed
                    </span>
                    {runs.filter(r => r.pipeline_id === p.id).slice(0, 3).map(run => (
                      <div key={run.id} className="mt-1 p-2 rounded bg-secondary/50 text-xs">
                        <div className="flex items-center justify-between mb-1">
                          <span className="font-medium">Run #{run.id}</span>
                          <RunStatusBadge status={run.status} />
                        </div>
                        <RunStepsViz steps={run.steps_snapshot} />
                        {run.status === 'running' && (
                          <div className="flex gap-1 mt-1.5">
                            <Button onClick={() => advanceRun(run.id, true)} variant="success" size="xs" className="bg-green-500/20 text-green-400 hover:bg-green-500/30 h-6 text-2xs">
                              Mark Step Done
                            </Button>
                            <Button onClick={() => advanceRun(run.id, false)} variant="destructive" size="xs" className="bg-red-500/20 text-red-400 hover:bg-red-500/30 h-6 text-2xs">
                              Mark Step Failed
                            </Button>
                            <Button onClick={() => cancelRun(run.id)} variant="secondary" size="xs" className="h-6 text-2xs">
                              Cancel
                            </Button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/** Full step visualization — React Flow canvas */
function PipelineViz({ steps, labels }: { steps: PipelineStep[]; labels: PipelineStepsCanvasLabels }) {
  return <PipelineStepsVisualCanvas steps={steps} labels={labels} compact />
}

/** Run steps visualization with colored status dots */
function RunStepsViz({ steps }: { steps: RunStepState[] }) {
  return (
    <div className="flex items-center gap-1 overflow-x-auto">
      {steps.map((s, i) => (
        <div key={i} className="flex items-center gap-1 shrink-0">
          <div className="flex items-center gap-1">
            <span className={`w-2 h-2 rounded-full shrink-0 ${
              s.status === 'completed' ? 'bg-green-500' :
              s.status === 'running' ? 'bg-amber-500 animate-pulse' :
              s.status === 'failed' ? 'bg-red-500' :
              s.status === 'skipped' ? 'bg-gray-500' : 'bg-gray-600'
            }`} />
            <span className={`text-2xs whitespace-nowrap ${
              s.status === 'running' ? 'text-foreground font-medium' : 'text-muted-foreground'
            }`}>
              {s.template_name}
            </span>
          </div>
          {i < steps.length - 1 && (
            <svg viewBox="0 0 8 8" className="w-2 h-2 text-muted-foreground/40 shrink-0">
              <path d="M1 4h6M5 2l2 2-2 2" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
        </div>
      ))}
    </div>
  )
}

function RunStatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    running: 'bg-amber-500/20 text-amber-400',
    completed: 'bg-green-500/20 text-green-400',
    failed: 'bg-red-500/20 text-red-400',
    cancelled: 'bg-gray-500/20 text-gray-400',
    pending: 'bg-blue-500/20 text-blue-400',
  }
  return (
    <span className={`text-2xs px-1.5 py-0.5 rounded-full ${styles[status] || 'bg-secondary text-muted-foreground'}`}>
      {status}
    </span>
  )
}

/** Active run card shown at top of pipeline tab */
function ActiveRunCard({ run, onAdvance, onCancel }: {
  run: PipelineRun
  onAdvance: (id: number, success: boolean) => void
  onCancel: (id: number) => void
}) {
  return (
    <div className="p-2.5 rounded-lg border border-amber-500/30 bg-amber-500/5">
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
          <span className="text-xs font-medium text-foreground">
            {run.pipeline_name || `Pipeline #${run.pipeline_id}`} — Run #{run.id}
          </span>
        </div>
        <span className="text-2xs text-muted-foreground">
          Step {run.current_step + 1}/{run.steps_snapshot.length}
        </span>
      </div>
      <RunStepsViz steps={run.steps_snapshot} />
      <div className="flex gap-1 mt-2">
        <Button onClick={() => onAdvance(run.id, true)} variant="success" size="xs" className="bg-green-500/20 text-green-400 hover:bg-green-500/30 h-6 text-2xs">
          Step Done
        </Button>
        <Button onClick={() => onAdvance(run.id, false)} variant="destructive" size="xs" className="bg-red-500/20 text-red-400 hover:bg-red-500/30 h-6 text-2xs">
          Step Failed
        </Button>
        <Button onClick={() => onCancel(run.id)} variant="secondary" size="xs" className="h-6 text-2xs ml-auto">
          Cancel
        </Button>
      </div>
    </div>
  )
}
