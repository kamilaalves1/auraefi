import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { logger } from '@/lib/logger'
import { loadBacklogForWorkspace } from '@/lib/work-pipeline-config'

/**
 * GET /api/work-pipeline/backlog — normalized work items for agents (operator+).
 * Query: limit (max 100), include_raw=1 to attach provider payloads.
 */
export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const { searchParams } = new URL(request.url)
    const limit = Math.min(Math.max(parseInt(searchParams.get('limit') || '50', 10) || 50, 1), 100)
    const includeRaw = searchParams.get('include_raw') === '1'

    const workspaceId = auth.user.workspace_id ?? 1
    const { provider, items } = await loadBacklogForWorkspace(workspaceId, limit)

    const payload = includeRaw
      ? items
      : items.map(({ raw: _r, ...rest }) => rest)

    return NextResponse.json({
      provider,
      count: payload.length,
      items: payload,
    })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to load backlog'
    logger.error({ err: error }, 'GET /api/work-pipeline/backlog')
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
