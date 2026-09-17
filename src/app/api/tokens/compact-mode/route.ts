import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { dbGetAll } from '@/lib/db-pool'
import { calculateTokenCost } from '@/lib/token-pricing'
import { getProviderSubscriptionFlags } from '@/lib/provider-subscriptions'
import { logger } from '@/lib/logger'

const COMPACT_MARKER = '## Modo de Saída Compacto'

interface AgentRow {
  name: string
  soul_content: string | null
}

interface UsageRow {
  agent_name: string
  total_input_tokens: number
  total_output_tokens: number
  total_cost_stored: number
  request_count: number
}

export async function GET(request: NextRequest) {
  const auth = await requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const { searchParams } = new URL(request.url)
    const days = Math.max(1, Math.min(365, Number(searchParams.get('days') || 30)))
    const workspaceId = auth.user.workspace_id ?? 1
    const cutoff = Math.floor(Date.now() / 1000) - days * 86400
    const providerSubscriptions = getProviderSubscriptionFlags()

    const agentExpr = `COALESCE(
      NULLIF(agent_name, ''),
      CASE
        WHEN INSTR(session_id, ':') > 0 THEN SUBSTR(session_id, 1, INSTR(session_id, ':') - 1)
        ELSE session_id
      END
    )`

    const [agentRows, usageRows] = await Promise.all([
      dbGetAll(
        `SELECT name, soul_content FROM agents WHERE workspace_id = ?`,
        [workspaceId]
      ) as Promise<AgentRow[]>,
      dbGetAll(
        `SELECT
          ${agentExpr} AS agent_name,
          SUM(input_tokens)              AS total_input_tokens,
          SUM(output_tokens)             AS total_output_tokens,
          SUM(COALESCE(cost_usd, 0))     AS total_cost_stored,
          COUNT(*)                       AS request_count
        FROM token_usage
        WHERE workspace_id = ? AND created_at >= ?
        GROUP BY ${agentExpr}`,
        [workspaceId, cutoff]
      ) as Promise<UsageRow[]>,
    ])

    // Build compact-mode flag map by agent name (case-insensitive)
    const compactSet = new Set<string>()
    for (const a of agentRows) {
      if (a.soul_content?.includes(COMPACT_MARKER)) {
        compactSet.add(a.name.toLowerCase())
      }
    }

    type GroupStats = {
      agents: string[]
      total_input_tokens: number
      total_output_tokens: number
      total_cost: number
      request_count: number
    }

    const groups: Record<'compact' | 'standard', GroupStats> = {
      compact:  { agents: [], total_input_tokens: 0, total_output_tokens: 0, total_cost: 0, request_count: 0 },
      standard: { agents: [], total_input_tokens: 0, total_output_tokens: 0, total_cost: 0, request_count: 0 },
    }

    const perAgent: Array<{
      name: string
      compact: boolean
      request_count: number
      total_input_tokens: number
      total_output_tokens: number
      avg_output_per_req: number
      cost: number
    }> = []

    for (const row of usageRows) {
      const isCompact = compactSet.has(row.agent_name.toLowerCase())
      const fallback = calculateTokenCost('', row.total_input_tokens, row.total_output_tokens, { providerSubscriptions })
      const cost = row.total_cost_stored > 0 ? row.total_cost_stored : fallback
      const g = isCompact ? groups.compact : groups.standard
      g.agents.push(row.agent_name)
      g.total_input_tokens += row.total_input_tokens
      g.total_output_tokens += row.total_output_tokens
      g.total_cost += cost
      g.request_count += row.request_count
      perAgent.push({
        name: row.agent_name,
        compact: isCompact,
        request_count: row.request_count,
        total_input_tokens: row.total_input_tokens,
        total_output_tokens: row.total_output_tokens,
        avg_output_per_req: row.request_count > 0 ? Math.round(row.total_output_tokens / row.request_count) : 0,
        cost,
      })
    }

    perAgent.sort((a, b) => b.total_output_tokens - a.total_output_tokens)

    const avgCompact  = groups.compact.request_count > 0
      ? groups.compact.total_output_tokens / groups.compact.request_count : null
    const avgStandard = groups.standard.request_count > 0
      ? groups.standard.total_output_tokens / groups.standard.request_count : null

    // Só calcula comparação quando ambos os grupos têm dados e padrão tem média > 0
    const canCompare = avgCompact !== null && avgStandard !== null && avgStandard > 0

    // Limita a [-100, 100] para evitar overflow ao exibir (compacto pode ser maior que padrão)
    const rawPct     = canCompare ? ((avgStandard! - avgCompact!) / avgStandard!) * 100 : null
    const savingsPct = rawPct !== null ? Math.min(100, Math.max(-100, rawPct)) : null

    // Tokens poupados: positivo = economizou, negativo = gastou mais — exibe só se economizou
    const rawTokensSaved = canCompare && groups.compact.request_count > 0
      ? (avgStandard! - avgCompact!) * groups.compact.request_count : null
    const tokensSaved = rawTokensSaved !== null && rawTokensSaved > 0
      ? Math.round(rawTokensSaved) : null

    // Custo poupado: proporcional à fração de tokens economizados sobre o total padrão
    const costSaved = tokensSaved !== null && avgStandard && avgStandard > 0 && groups.standard.request_count > 0
      ? (tokensSaved / (avgStandard * groups.standard.request_count)) * groups.standard.total_cost
      : null

    return NextResponse.json({
      days,
      compact:  { ...groups.compact,  avg_output_per_req: avgCompact  !== null ? Math.round(avgCompact)  : null },
      standard: { ...groups.standard, avg_output_per_req: avgStandard !== null ? Math.round(avgStandard) : null },
      savings: {
        output_tokens_pct:   savingsPct !== null ? Math.round(savingsPct * 10) / 10 : null,
        output_tokens_saved: tokensSaved,
        cost_saved:          costSaved,
      },
      per_agent: perAgent,
    })
  } catch (error) {
    logger.error({ err: error }, 'GET /api/tokens/compact-mode error')
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
