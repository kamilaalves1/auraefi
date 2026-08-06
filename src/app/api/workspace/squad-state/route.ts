import { NextRequest, NextResponse } from 'next/server'

import { setWorkspaceSquadActive, getWorkspaceSquadActive } from '@/lib/workspace-squad-state-db'
import { requireRole } from '@/lib/auth'
import { mutationLimiter } from '@/lib/rate-limit'
import { logger } from '@/lib/logger'
import { z } from 'zod'
import { validateBody } from '@/lib/validation'

const putSchema = z.object({
  squad_active: z.boolean(),
})

/** GET â€” whether the workspace marked the agent squad as ready (unlocks flow, pipelines, client params). */
export async function GET(request: NextRequest) {
  const auth = await requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {    const workspaceId = auth.user.workspace_id ?? 1
    return NextResponse.json({ squad_active: await getWorkspaceSquadActive(workspaceId) })
  } catch (error) {
    logger.error({ err: error }, 'GET /api/workspace/squad-state error')
    return NextResponse.json({ error: 'Failed to load squad state' }, { status: 500 })
  }
}

/** PUT â€” operator toggles squad readiness (or use preset install / confirm in UI). */
export async function PUT(request: NextRequest) {
  const auth = await requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const rateCheck = mutationLimiter(request)
  if (rateCheck) return rateCheck

  try {
    const validated = await validateBody(request, putSchema)
    if ('error' in validated) return validated.error    const workspaceId = auth.user.workspace_id ?? 1
    const user = auth.user.username
    const active = validated.data.squad_active ? 1 : 0

    await setWorkspaceSquadActive(workspaceId, active === 1, user)

    return NextResponse.json({ ok: true, squad_active: active === 1 })
  } catch (error) {
    logger.error({ err: error }, 'PUT /api/workspace/squad-state error')
    return NextResponse.json({ error: 'Failed to save squad state' }, { status: 500 })
  }
}
