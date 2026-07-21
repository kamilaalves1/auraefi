import { NextRequest, NextResponse } from 'next/server'
import { getDatabase } from '@/lib/db'
import { requireRole } from '@/lib/auth'
import { mutationLimiter } from '@/lib/rate-limit'
import { validateBody, softwareEngineeringPresetSchema } from '@/lib/validation'
import { createMcAgent } from '@/lib/create-mc-agent'
import { getSoftwareEngineeringSquadMembersInOrder } from '@/lib/software-engineering-squad'
import { resolvePresetLocale } from '@/lib/software-engineering-squad-names'
import { logger } from '@/lib/logger'
import { setWorkspaceSquadActive } from '@/lib/workspace-squad-state-db'

/**
 * POST /api/agents/presets/software-engineering
 * Creates the default software-engineering squad (or skips names that already exist).
 */
export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const rateCheck = mutationLimiter(request)
  if (rateCheck) return rateCheck

  const validated = await validateBody(request, softwareEngineeringPresetSchema)
  if ('error' in validated) return validated.error

  const { skip_existing, write_to_gateway, provision_openclaw_workspace, locale: bodyLocale } = validated.data

  const acceptLang = request.headers.get('accept-language')?.split(',')[0]?.trim().split(';')[0]
  const resolvedLocale = resolvePresetLocale(bodyLocale || acceptLang || undefined)

  try {
    const db = getDatabase()
    const workspaceId = auth.user.workspace_id ?? 1
    const ipAddress = request.headers.get('x-forwarded-for') || 'unknown'
    const ctx = {
      workspaceId,
      actorUsername: auth.user.username,
      actorUserId: auth.user.id,
      ipAddress,
    }

    const members = getSoftwareEngineeringSquadMembersInOrder(resolvedLocale)
    const created: string[] = []
    const skipped: string[] = []
    const errors: { name: string; error: string }[] = []
    const warnings: string[] = []

    for (const m of members) {
      const result = await createMcAgent(db, ctx, {
        name: m.name,
        openclaw_id: (m.name || m.template || 'agent').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''),
        template: m.template,
        role: m.roleLabel,
        soul_content: m.soulContent,
        write_to_gateway,
        provision_openclaw_workspace,
        gateway_config: { identity: { emoji: m.emoji } },
      })

      if (!result.ok) {
        if (result.status === 409 && skip_existing) {
          skipped.push(m.name)
          continue
        }
        errors.push({ name: m.name, error: result.error })
        continue
      }

      created.push(m.name)
      if (result.warning) {
        warnings.push(`${m.name}: ${result.warning}`)
      }
    }

    if (errors.length === 0 && (created.length > 0 || skipped.length > 0)) {
      try {
        setWorkspaceSquadActive(db, workspaceId, true, auth.user.username)
      } catch (e) {
        logger.warn({ err: e }, 'Could not persist squad_active after preset')
      }
    }

    return NextResponse.json({
      ok: errors.length === 0,
      locale: resolvedLocale,
      created,
      skipped,
      errors,
      warnings,
    })
  } catch (error) {
    logger.error({ err: error }, 'POST /api/agents/presets/software-engineering error')
    return NextResponse.json({ error: 'Failed to apply software engineering preset' }, { status: 500 })
  }
}
