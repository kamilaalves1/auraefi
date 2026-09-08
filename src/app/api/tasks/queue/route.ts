import { NextRequest, NextResponse } from 'next/server'
import { dbGet, dbGetAll, dbRun } from '@/lib/db-pool'
import { requireRole } from '@/lib/auth'
import { agentTaskLimiter } from '@/lib/rate-limit'
import { logger } from '@/lib/logger'

type QueueReason = 'continue_current' | 'assigned' | 'at_capacity' | 'no_tasks_available'

function safeParseJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

function mapTaskRow(task: any) {
  return {
    ...task,
    tags: safeParseJson(task.tags, [] as string[]),
    metadata: safeParseJson(task.metadata, {} as Record<string, unknown>),
  }
}

function priorityRankSql() {
  return `
    CASE priority
      WHEN 'critical' THEN 0
      WHEN 'high' THEN 1
      WHEN 'medium' THEN 2
      WHEN 'low' THEN 3
      ELSE 4
    END
  `
}

/**
 * GET /api/tasks/queue - Poll next task for an agent.
 *
 * Query params:
 * - agent: required agent name (or use x-agent-name header)
 * - max_capacity: optional integer 1..20 (default 1)
 */
export async function GET(request: NextRequest) {
  const auth = await requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const rateLimited = agentTaskLimiter(request)
  if (rateLimited) return rateLimited

  try {
    const workspaceId = auth.user.workspace_id
    const { searchParams } = new URL(request.url)

    const agent =
      (searchParams.get('agent') || '').trim() ||
      (request.headers.get('x-agent-name') || '').trim()

    if (!agent) {
      return NextResponse.json({ error: 'Missing agent. Provide ?agent=... or x-agent-name header.' }, { status: 400 })
    }

    const maxCapacityRaw = searchParams.get('max_capacity') || '1'
    if (!/^\d+$/.test(maxCapacityRaw)) {
      return NextResponse.json({ error: 'Invalid max_capacity. Expected integer 1..20.' }, { status: 400 })
    }
    const maxCapacity = Number(maxCapacityRaw)
    if (!Number.isInteger(maxCapacity) || maxCapacity < 1 || maxCapacity > 20) {
      return NextResponse.json({ error: 'Invalid max_capacity. Expected integer 1..20.' }, { status: 400 })
    }

    const now = Math.floor(Date.now() / 1000)

    const currentTask = await dbGet(`
      SELECT *
      FROM tasks
      WHERE workspace_id = ? AND assigned_to = ? AND status = 'in_progress'
      ORDER BY updated_at DESC
      LIMIT 1
    `, [workspaceId, agent]) as any | undefined

    if (currentTask) {
      return NextResponse.json({
        task: mapTaskRow(currentTask),
        reason: 'continue_current' as QueueReason,
        agent,
        timestamp: now,
      })
    }

    const inProgressCount = (await dbGet(`
      SELECT COUNT(*) as c
      FROM tasks
      WHERE workspace_id = ? AND assigned_to = ? AND status = 'in_progress'
    `, [workspaceId, agent]) as { c: number }).c

    if (inProgressCount >= maxCapacity) {
      return NextResponse.json({
        task: null,
        reason: 'at_capacity' as QueueReason,
        agent,
        timestamp: now,
      })
    }

    // Claim por compare-and-swap. A versao anterior era um UNICO UPDATE com
    // RETURNING, e tinha TRES defeitos, todos provados contra o banco em 2026-09-08:
    //   1. `NULLS LAST` nao existe no MySQL              -> ERROR 1064
    //   2. `RETURNING *` nao existe no MySQL             -> ERROR 1064
    //   3. subquery sobre a MESMA tabela do UPDATE       -> ERROR 1093
    //      ("You can't specify target table 'tasks' for update in FROM clause")
    // Ou seja a rota de reivindicar tarefa NUNCA funcionou neste banco.
    //
    // Aqui: escolhe o candidato, e o UPDATE com `AND status IN (...)` e o
    // compare-and-swap -- em corrida, so UM agente recebe affectedRows === 1; os
    // outros recebem 0 e tentam o proximo candidato. Sem coluna nova de claim.
    // `NULLS LAST` e emulado por `(due_date IS NULL) ASC`, que ordena 0 antes de 1.
    let claimed: any | undefined
    for (let tentativa = 0; tentativa < 3 && !claimed; tentativa++) {
      const candidato = await dbGet<{ id: number }>(`
        SELECT id FROM tasks
        WHERE workspace_id = ?
          AND status IN ('assigned', 'inbox')
          AND (assigned_to IS NULL OR assigned_to = ?)
        ORDER BY ${priorityRankSql()} ASC, (due_date IS NULL) ASC, due_date ASC, created_at ASC
        LIMIT 1
      `, [workspaceId, agent])
      if (!candidato) break

      const upd = await dbRun(`
        UPDATE tasks
        SET status = 'in_progress', assigned_to = ?, updated_at = ?
        WHERE id = ? AND status IN ('assigned', 'inbox')
      `, [agent, now, candidato.id])

      if (upd.affectedRows === 1) {
        claimed = await dbGet(`SELECT * FROM tasks WHERE id = ?`, [candidato.id]) as any | undefined
      }
    }

    if (claimed) {
      return NextResponse.json({
        task: mapTaskRow(claimed),
        reason: 'assigned' as QueueReason,
        agent,
        timestamp: now,
      })
    }

    return NextResponse.json({
      task: null,
      reason: 'no_tasks_available' as QueueReason,
      agent,
      timestamp: now,
    })
  } catch (error) {
    logger.error({ err: error }, 'GET /api/tasks/queue error')
    return NextResponse.json({ error: 'Failed to poll task queue' }, { status: 500 })
  }
}
