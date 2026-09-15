import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { dbGetAll, dbRun } from '@/lib/db-pool'
import { logger } from '@/lib/logger'

/** GET /api/errors — list recent error logs */
export async function GET(request: NextRequest) {
  const auth = await requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const { searchParams } = new URL(request.url)
    const workspaceId = auth.user.workspace_id ?? 1
    const limit = Math.min(parseInt(searchParams.get('limit') ?? '100'), 500)
    const offset = parseInt(searchParams.get('offset') ?? '0')
    const source = searchParams.get('source')

    let query = 'SELECT * FROM error_logs WHERE workspace_id = ?'
    const params: unknown[] = [workspaceId]

    if (source) {
      query += ' AND source LIKE ?'
      params.push(`${source}%`)
    }

    query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?'
    params.push(limit, offset)

    const rows = await dbGetAll(query, params) as any[]
    const errors = rows.map(r => ({
      ...r,
      data: r.data ? (() => { try { return JSON.parse(r.data) } catch { return r.data } })() : null,
    }))

    const total = (await dbGetAll(
      'SELECT COUNT(*) as n FROM error_logs WHERE workspace_id = ?',
      [workspaceId]
    ) as any[])[0]?.n ?? 0

    return NextResponse.json({ errors, total, limit, offset })
  } catch (err) {
    logger.error({ err }, 'GET /api/errors error')
    return NextResponse.json({ error: 'Failed to load errors' }, { status: 500 })
  }
}

/** DELETE /api/errors — clear all error logs for workspace */
export async function DELETE(request: NextRequest) {
  const auth = await requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const workspaceId = auth.user.workspace_id ?? 1
    await dbRun('DELETE FROM error_logs WHERE workspace_id = ?', [workspaceId])
    return NextResponse.json({ ok: true })
  } catch (err) {
    logger.error({ err }, 'DELETE /api/errors error')
    return NextResponse.json({ error: 'Failed to clear errors' }, { status: 500 })
  }
}
