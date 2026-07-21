import { NextRequest, NextResponse } from 'next/server'
import { getDatabase } from '@/lib/db'
import { requireRole } from '@/lib/auth'
import { mutationLimiter } from '@/lib/rate-limit'
import { validateBody, upsertWorkspaceParametersSchema } from '@/lib/validation'
import { parseStringRecordJson } from '@/lib/parameter-substitution'
import { logger } from '@/lib/logger'

/**
 * GET /api/workspace/parameters — string map used for {{placeholders}} in pipelines and delivery flow labels.
 * PUT — replace entire map (operator).
 */
export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const db = getDatabase()
    const workspaceId = auth.user.workspace_id ?? 1
    const row = db
      .prepare('SELECT values_json, updated_at, updated_by FROM workspace_parameters WHERE workspace_id = ?')
      .get(workspaceId) as { values_json: string; updated_at: number; updated_by: string | null } | undefined

    const values = parseStringRecordJson(row?.values_json)
    return NextResponse.json({
      values,
      updated_at: row?.updated_at ?? null,
      updated_by: row?.updated_by ?? null,
    })
  } catch (error) {
    logger.error({ err: error }, 'GET /api/workspace/parameters error')
    return NextResponse.json({ error: 'Failed to load workspace parameters' }, { status: 500 })
  }
}

export async function PUT(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const rateCheck = mutationLimiter(request)
  if (rateCheck) return rateCheck

  try {
    const validated = await validateBody(request, upsertWorkspaceParametersSchema)
    if ('error' in validated) return validated.error

    const db = getDatabase()
    const workspaceId = auth.user.workspace_id ?? 1
    const { values } = validated.data
    const json = JSON.stringify(values)
    const now = Math.floor(Date.now() / 1000)
    const user = auth.user.username

    db.prepare(
      `
      INSERT INTO workspace_parameters (workspace_id, values_json, updated_at, updated_by)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(workspace_id) DO UPDATE SET
        values_json = excluded.values_json,
        updated_at = excluded.updated_at,
        updated_by = excluded.updated_by
    `,
    ).run(workspaceId, json, now, user)

    return NextResponse.json({ ok: true, values })
  } catch (error) {
    logger.error({ err: error }, 'PUT /api/workspace/parameters error')
    return NextResponse.json({ error: 'Failed to save workspace parameters' }, { status: 500 })
  }
}
