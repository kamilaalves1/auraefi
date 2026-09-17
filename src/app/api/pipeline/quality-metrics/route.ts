import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { dbGetAll } from '@/lib/db-pool'
import { logger } from '@/lib/logger'

/**
 * GET /api/pipeline/quality-metrics
 *
 * Retorna métricas de qualidade do pipeline por agente/etapa.
 * Query params:
 *   days=30         — janela de tempo (padrão 30, máx 365)
 *   stage=<nome>    — filtrar por etapa (opcional)
 *   agent=<nome>    — filtrar por agente (opcional)
 */
export async function GET(request: NextRequest) {
  const auth = await requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const workspaceId = auth.user.workspace_id ?? 1
    const { searchParams } = new URL(request.url)
    const days = Math.max(1, Math.min(365, Number(searchParams.get('days') || 30)))
    const stageFilter = searchParams.get('stage') || null
    const agentFilter = searchParams.get('agent') || null
    const cutoff = Math.floor(Date.now() / 1000) - days * 86400

    // Verifica se a tabela existe (pode não existir em instâncias antigas)
    interface TableCheck { ok?: number }
    const tableExists = (await dbGetAll<TableCheck>(
      `SELECT 1 as ok FROM sqlite_master WHERE type='table' AND name='pipeline_quality_metrics'`, []
    ))[0]?.ok
    if (!tableExists) {
      return NextResponse.json({ days, gates: [], stages: [], rework: [], estimates: [], summary: {} })
    }

    interface MetricRow {
      metric_type: string
      stage_name: string | null
      agent_name: string | null
      value_num: number | null
      value_text: string | null
      created_at: number
    }

    const baseWhere = [
      'workspace_id = ?',
      'created_at >= ?',
      stageFilter ? 'stage_name = ?' : null,
      agentFilter ? 'agent_name = ?' : null,
    ].filter(Boolean).join(' AND ')

    const baseParams: (string | number)[] = [workspaceId, cutoff]
    if (stageFilter) baseParams.push(stageFilter)
    if (agentFilter) baseParams.push(agentFilter)

    const rows = await dbGetAll<MetricRow>(
      `SELECT metric_type, stage_name, agent_name, value_num, value_text, created_at
       FROM pipeline_quality_metrics
       WHERE ${baseWhere}
       ORDER BY created_at DESC`,
      baseParams
    )

    // ── Gates por etapa ──────────────────────────────────────────────────────
    interface GateEntry { stage: string; agent: string; passed: number; rejected: number; approval_rate: number }
    const gateMap = new Map<string, { passed: number; rejected: number; agent: string }>()
    for (const r of rows) {
      if (r.metric_type !== 'gate_passed' && r.metric_type !== 'gate_rejected') continue
      const key = `${r.stage_name ?? ''}::${r.agent_name ?? ''}`
      const cur = gateMap.get(key) ?? { passed: 0, rejected: 0, agent: r.agent_name ?? '' }
      if (r.metric_type === 'gate_passed') cur.passed++
      else cur.rejected++
      gateMap.set(key, cur)
    }
    const gates: GateEntry[] = Array.from(gateMap.entries()).map(([key, v]) => {
      const stage = key.split('::')[0]
      const total = v.passed + v.rejected
      return { stage, agent: v.agent, passed: v.passed, rejected: v.rejected, approval_rate: total > 0 ? Math.round((v.passed / total) * 100) : 0 }
    }).sort((a, b) => a.approval_rate - b.approval_rate) // piores primeiro

    // ── Duração média por etapa ──────────────────────────────────────────────
    interface StageEntry { stage: string; avg_duration_sec: number; count: number }
    const durationMap = new Map<string, number[]>()
    for (const r of rows) {
      if (r.metric_type !== 'stage_duration_sec' || r.value_num == null) continue
      const stage = r.stage_name ?? 'desconhecido'
      if (!durationMap.has(stage)) durationMap.set(stage, [])
      durationMap.get(stage)!.push(r.value_num)
    }
    const stages: StageEntry[] = Array.from(durationMap.entries()).map(([stage, vals]) => ({
      stage,
      avg_duration_sec: Math.round(vals.reduce((s, v) => s + v, 0) / vals.length),
      count: vals.length,
    })).sort((a, b) => b.avg_duration_sec - a.avg_duration_sec)

    // ── Rework ───────────────────────────────────────────────────────────────
    interface ReworkEntry { from_stage: string; to_stage: string; count: number }
    const reworkMap = new Map<string, number>()
    for (const r of rows) {
      if (r.metric_type !== 'rework_triggered') continue
      const from = r.stage_name ?? '?'
      const to = r.value_text ?? '?'
      const key = `${from} → ${to}`
      reworkMap.set(key, (reworkMap.get(key) ?? 0) + 1)
    }
    const rework: ReworkEntry[] = Array.from(reworkMap.entries()).map(k => ({
      from_stage: k[0].split(' → ')[0],
      to_stage: k[0].split(' → ')[1],
      count: k[1],
    })).sort((a, b) => b.count - a.count)

    // ── Estimativas de story points ──────────────────────────────────────────
    interface EstimateEntry { card_key: string; points: number | null; created_at: number }
    const estimates: EstimateEntry[] = rows
      .filter(r => r.metric_type === 'story_points_estimate')
      .slice(0, 50)
      .map(r => ({ card_key: r.value_text?.match(/card[:\s]+([A-Z]+-\d+)/i)?.[1] ?? '', points: r.value_num, created_at: r.created_at }))

    // ── Sumário ──────────────────────────────────────────────────────────────
    const totalGates = rows.filter(r => r.metric_type === 'gate_passed' || r.metric_type === 'gate_rejected').length
    const passedGates = rows.filter(r => r.metric_type === 'gate_passed').length
    const totalRework = rows.filter(r => r.metric_type === 'rework_triggered').length
    const prApproved = rows.filter(r => r.metric_type === 'pr_approved').length
    const prRejected = rows.filter(r => r.metric_type === 'pr_rejected').length
    const qaApproved = rows.filter(r => r.metric_type === 'qa_approved').length
    const qaRejected = rows.filter(r => r.metric_type === 'qa_rejected').length

    const summary = {
      days,
      total_gate_evaluations: totalGates,
      overall_gate_approval_rate: totalGates > 0 ? Math.round((passedGates / totalGates) * 100) : null,
      total_rework_events: totalRework,
      pr_approval_rate: (prApproved + prRejected) > 0 ? Math.round((prApproved / (prApproved + prRejected)) * 100) : null,
      qa_approval_rate: (qaApproved + qaRejected) > 0 ? Math.round((qaApproved / (qaApproved + qaRejected)) * 100) : null,
      avg_stage_duration_sec: stages.length > 0 ? Math.round(stages.reduce((s, v) => s + v.avg_duration_sec, 0) / stages.length) : null,
    }

    return NextResponse.json({ days, summary, gates, stages, rework, estimates })
  } catch (err) {
    logger.error({ err }, 'GET /api/pipeline/quality-metrics error')
    return NextResponse.json({ error: 'Failed to load quality metrics' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
