import { NextRequest, NextResponse } from 'next/server'
import { dbGet, dbGetAll, dbRun } from '@/lib/db-pool'
import { requireRole } from '@/lib/auth'
import { mutationLimiter } from '@/lib/rate-limit'
import { logger } from '@/lib/logger'

export async function GET(request: NextRequest) {
  const auth = await requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const workspaceId = auth.user.workspace_id ?? 1
    const rows = await dbGetAll('SELECT * FROM clients WHERE workspace_id = ? ORDER BY name ASC', [workspaceId])
    return NextResponse.json({ clients: rows })
  } catch (err) {
    logger.error({ err }, 'GET /api/workspace/clients error')
    return NextResponse.json({ error: 'Failed to load clients' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const rateCheck = mutationLimiter(request)
  if (rateCheck) return rateCheck

  try {
    const workspaceId = auth.user.workspace_id ?? 1
    const body = await request.json().catch(() => ({}))

    const name = typeof body.name === 'string' && body.name.trim()
      ? body.name.trim().slice(0, 120)
      : null
    if (!name) return NextResponse.json({ error: 'name is required' }, { status: 400 })

    const description = typeof body.description === 'string' ? body.description.trim().slice(0, 500) : null

    const result = await dbRun('INSERT INTO clients (workspace_id, name, description) VALUES (?, ?, ?)', [workspaceId, name, description])

    const row = await dbGet('SELECT * FROM clients WHERE id = ?', [result.insertId])
    return NextResponse.json({ client: row }, { status: 201 })
  } catch (err) {
    logger.error({ err }, 'POST /api/workspace/clients error')
    return NextResponse.json({ error: 'Failed to create client' }, { status: 500 })
  }
}
