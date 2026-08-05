import { NextRequest, NextResponse } from 'next/server'
import { dbGetOne, dbRun, db_helpers, logAuditEvent } from '@/lib/db'
import { requireRole } from '@/lib/auth'
import { writeAgentToConfig, enrichAgentConfigFromWorkspace, removeAgentFromConfig } from '@/lib/agent-sync'
import { eventBus } from '@/lib/event-bus'
import { logger } from '@/lib/logger'
import { extractClientIp } from '@/lib/rate-limit'

/**
 * GET /api/agents/[id] - Get a single agent by ID or name
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const { id } = await params
    const workspaceId = auth.user.workspace_id ?? 1;

    let agent
    if (isNaN(Number(id))) {
      agent = await dbGetOne('SELECT * FROM agents WHERE name = ? AND workspace_id = ?', [id, workspaceId])
    } else {
      agent = await dbGetOne('SELECT * FROM agents WHERE id = ? AND workspace_id = ?', [Number(id), workspaceId])
    }

    if (!agent) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
    }

    const parsed = {
      ...(agent as any),
      config: enrichAgentConfigFromWorkspace((agent as any).config ? JSON.parse((agent as any).config) : {}),
    }

    return NextResponse.json({ agent: parsed })
  } catch (error) {
    logger.error({ err: error }, 'GET /api/agents/[id] error')
    return NextResponse.json({ error: 'Failed to fetch agent' }, { status: 500 })
  }
}

/**
 * PUT /api/agents/[id] - Update agent config with unified MC + gateway save
 *
 * Body: {
 *   role?: string
 *   gateway_config?: object   - agent config fields to update
 *   write_to_gateway?: boolean - Defaults to true when gateway_config exists
 * }
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const { id } = await params
    const workspaceId = auth.user.workspace_id ?? 1;
    const body = await request.json()
    const { role, gateway_config, write_to_gateway, model, instructions,
            persona_name, specialty, capabilities, authority_level, constraints, collaboration_agents } = body

    let agent
    if (isNaN(Number(id))) {
      agent = await dbGetOne<any>('SELECT * FROM agents WHERE name = ? AND workspace_id = ?', [id, workspaceId])
    } else {
      agent = await dbGetOne<any>('SELECT * FROM agents WHERE id = ? AND workspace_id = ?', [Number(id), workspaceId])
    }

    if (!agent) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
    }

    const now = Math.floor(Date.now() / 1000)
    const existingConfig = agent.config ? JSON.parse(agent.config) : {}

    // Merge gateway_config into existing config
    let newConfig = existingConfig
    if (gateway_config && typeof gateway_config === 'object') {
      newConfig = { ...existingConfig, ...gateway_config }
    }

    const shouldWriteToGateway = Boolean(
      gateway_config &&
      (write_to_gateway === undefined || write_to_gateway === null || write_to_gateway === true)
    )
    const agentSlug = existingConfig.agentId || agent.name.toLowerCase().replace(/\s+/g, '-')
    const getWriteBackPayload = (source: Record<string, any>) => {
      const writeBack: any = { id: agentSlug }
      if (source.model) writeBack.model = source.model
      if (source.identity) writeBack.identity = source.identity
      if (source.sandbox) writeBack.sandbox = source.sandbox
      if (source.tools) writeBack.tools = source.tools
      if (source.subagents) writeBack.subagents = source.subagents
      if (source.memorySearch) writeBack.memorySearch = source.memorySearch
      return writeBack
    }

    // Unified save: DB first (transactional, easy to revert), then gateway file.
    // If gateway write fails after DB succeeds, revert DB to keep consistency.
    try {
      const fields: string[] = ['updated_at = ?']
      const values: any[] = [now]

      if (role !== undefined) {
        fields.push('role = ?')
        values.push(role)
      }

      if (model !== undefined) {
        fields.push('model = ?')
        values.push(String(model))
      }

      if (instructions !== undefined) {
        fields.push('instructions = ?')
        values.push(String(instructions))
      }

      if (persona_name !== undefined) {
        fields.push('persona_name = ?')
        values.push(persona_name ? String(persona_name) : null)
      }
      if (specialty !== undefined) {
        fields.push('specialty = ?')
        values.push(specialty ? String(specialty) : null)
      }
      if (capabilities !== undefined) {
        fields.push('capabilities_json = ?')
        values.push(Array.isArray(capabilities) ? JSON.stringify(capabilities) : null)
      }
      if (authority_level !== undefined) {
        fields.push('authority_level = ?')
        values.push(authority_level ? String(authority_level) : null)
      }
      if (constraints !== undefined) {
        fields.push('constraints_json = ?')
        values.push(Array.isArray(constraints) ? JSON.stringify(constraints) : null)
      }
      if (collaboration_agents !== undefined) {
        fields.push('collaboration_agents_json = ?')
        values.push(Array.isArray(collaboration_agents) ? JSON.stringify(collaboration_agents) : null)
      }

      if (gateway_config) {
        fields.push('config = ?')
        values.push(JSON.stringify(newConfig))
      }

      values.push(agent.id, workspaceId)
      await dbRun(`UPDATE agents SET ${fields.join(', ')} WHERE id = ? AND workspace_id = ?`, values)
    } catch (err: any) {
      return NextResponse.json({ error: `Save failed: ${err.message}` }, { status: 500 })
    }

    if (shouldWriteToGateway) {
      try {
        await writeAgentToConfig(getWriteBackPayload(gateway_config))
      } catch (err: any) {
        // Gateway write failed — revert DB to previous state
        try {
          const revertFields: string[] = ['updated_at = ?']
          const revertValues: any[] = [agent.updated_at]
          revertFields.push('role = ?')
          revertValues.push(agent.role)
          revertFields.push('config = ?')
          revertValues.push(agent.config || '{}')
          revertValues.push(agent.id, workspaceId)
          await dbRun(`UPDATE agents SET ${revertFields.join(', ')} WHERE id = ? AND workspace_id = ?`, revertValues)
        } catch (revertErr: any) {
          logger.error({ err: revertErr, agent: agent.name }, 'Failed to revert DB after gateway write failure')
        }
        return NextResponse.json(
          { error: `Save failed: unable to update gateway config: ${err.message}` },
          { status: 502 }
        )
      }
    }

    if (shouldWriteToGateway) {
      const ipAddress = extractClientIp(request)
      await logAuditEvent({
        action: 'agent_config_writeback',
        actor: auth.user.username,
        actor_id: auth.user.id,
        target_type: 'agent',
        target_id: agent.id,
        detail: { agent_name: agent.name, agent_id: agentSlug, fields: Object.keys(gateway_config || {}) },
        ip_address: ipAddress,
      }).catch(() => {})
    }

    // Log activity
    await db_helpers.logActivity(
      'agent_config_updated',
      'agent',
      agent.id,
      auth.user.username,
      `Config updated for agent ${agent.name}${shouldWriteToGateway ? ' (+ gateway)' : ''}`,
      { fields: Object.keys(gateway_config || {}), write_to_gateway: shouldWriteToGateway },
      workspaceId
    ).catch(() => {})

    // Broadcast update
    eventBus.broadcast('agent.updated', {
      id: agent.id,
      name: agent.name,
      config: newConfig,
      updated_at: now,
      workspace_id: workspaceId,
    })

    const enrichedConfig = enrichAgentConfigFromWorkspace(newConfig)

    return NextResponse.json({
      success: true,
      agent: { ...agent, config: enrichedConfig, role: role || agent.role, updated_at: now },
    })
  } catch (error: any) {
    logger.error({ err: error }, 'PUT /api/agents/[id] error')
    return NextResponse.json({ error: error.message || 'Failed to update agent' }, { status: 500 })
  }
}

/**
 * DELETE /api/agents/[id] - Delete an agent
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const { id } = await params
    const workspaceId = auth.user.workspace_id ?? 1;
    let removeWorkspace = false
    try {
      const body = await request.json()
      removeWorkspace = Boolean(body?.remove_workspace)
    } catch {
      // Optional body
    }

    let agent
    if (isNaN(Number(id))) {
      agent = await dbGetOne<any>('SELECT * FROM agents WHERE name = ? AND workspace_id = ?', [id, workspaceId])
    } else {
      agent = await dbGetOne<any>('SELECT * FROM agents WHERE id = ? AND workspace_id = ?', [Number(id), workspaceId])
    }

    if (!agent) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
    }

    if (removeWorkspace) {
      // Gateway CLI workspace removal is not available; log and continue with DB-only deletion
      logger.warn({ agent: agent.name }, 'remove_workspace requested but gateway CLI is not available; skipping workspace deletion')
    }

    let configCleanupWarning: string | null = null
    try {
      const agentConfig = agent.config ? JSON.parse(agent.config) : {}
      const agentId =
        String(agentConfig?.agentId || agent.name || '')
          .toLowerCase()
          .replace(/[^a-z0-9._-]+/g, '-')
          .replace(/^-+|-+$/g, '') || agent.name
      await removeAgentFromConfig({ id: agentId, name: agent.name })
    } catch (err: any) {
      configCleanupWarning = `Gateway config cleanup skipped for ${agent.name}: ${err?.message || 'unknown error'}`
      logger.warn({ err, agent: agent.name }, 'Failed to remove agent from gateway config')
    }

    await dbRun('DELETE FROM agents WHERE id = ? AND workspace_id = ?', [agent.id, workspaceId])

    await db_helpers.logActivity(
      'agent_deleted',
      'agent',
      agent.id,
      auth.user.username,
      `Deleted agent: ${agent.name}`,
      { name: agent.name, role: agent.role, remove_workspace: removeWorkspace },
      workspaceId
    ).catch(() => {})

    eventBus.broadcast('agent.deleted', { id: agent.id, name: agent.name, workspace_id: workspaceId })

    return NextResponse.json({
      success: true,
      deleted: agent.name,
      remove_workspace: removeWorkspace,
      ...(configCleanupWarning ? { warning: configCleanupWarning } : {}),
    })
  } catch (error) {
    logger.error({ err: error }, 'DELETE /api/agents/[id] error')
    return NextResponse.json({ error: 'Failed to delete agent' }, { status: 500 })
  }
}
