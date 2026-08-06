
import { dbGet, dbRun } from '@/lib/db-pool'
import { db_helpers, logAuditEvent, type Agent } from '@/lib/db'
import { eventBus } from '@/lib/event-bus'
import { getTemplate, buildAgentConfig } from '@/lib/agent-templates'
import { writeAgentToConfig, enrichAgentConfigFromWorkspace } from '@/lib/agent-sync'
import { logger } from '@/lib/logger'


export type CreateMcAgentBody = {
  name: string
  agent_id?: string
  role?: string
  session_key?: string
  soul_content?: string
  status?: string
  config?: Record<string, unknown>
  template?: string
  gateway_config?: Record<string, unknown>
  write_to_gateway?: boolean
  provision_workspace?: boolean
  workspace_path?: string
  model?: string
  instructions?: string
}

export type CreateMcAgentSuccess = {
  ok: true
  agent: Agent & {
    config: Record<string, unknown>
    taskStats: {
      total: number
      assigned: number
      in_progress: number
      quality_review: number
      done: number
      completed: number
    }
  }
  warning?: string
}

export type CreateMcAgentFailure = { ok: false; status: number; error: string }

export type CreateMcAgentResult = CreateMcAgentSuccess | CreateMcAgentFailure

export type CreateMcAgentContext = {
  workspaceId: number
  actorUsername: string
  actorUserId: number
  ipAddress: string
}

/**
 * Shared create-agent logic for POST /api/agents and bulk presets.
 */
export async function createMcAgent(
  ctx: CreateMcAgentContext,
  body: CreateMcAgentBody,
): Promise<CreateMcAgentResult> {
  const {
    name,
    agent_id,
    role,
    session_key,
    soul_content,
    status = 'offline',
    config = {},
    template,
    gateway_config,
    write_to_gateway,
    provision_workspace,
    workspace_path,
    model = 'claude-sonnet-4-6',
    instructions = '',
  } = body

  const agentSlug = (agent_id || name || 'agent')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')

  let finalRole = role
  let finalConfig: Record<string, unknown> = { ...config }

  if (template) {
    const tpl = getTemplate(template)
    if (!tpl) {
      return { ok: false, status: 400, error: `Unknown template: ${template}` }
    }
    const gwc = (gateway_config || {}) as Record<string, any>
    const builtConfig = buildAgentConfig(tpl, {
      id: agentSlug,
      name,
      theme: role || gwc.identity?.theme || tpl.config.identity.theme,
      emoji: (gwc.identity?.emoji as string | undefined) ?? tpl.emoji,
      model:
        typeof gwc.model?.primary === 'string'
          ? gwc.model.primary
          : typeof gwc.model === 'string'
            ? gwc.model
            : undefined,
      workspaceAccess: gwc.sandbox?.workspaceAccess,
      sandboxMode: gwc.sandbox?.mode,
      dockerNetwork: gwc.sandbox?.docker?.network,
      subagentAllowAgents: gwc.subagents?.allowAgents,
    })
    finalConfig = { ...builtConfig, ...finalConfig }
    if (!finalRole) finalRole = tpl.config.identity?.theme || tpl.type
  } else if (gateway_config) {
    finalConfig = { ...finalConfig, ...(gateway_config as Record<string, unknown>) }
  }

  if (!name || !finalRole) {
    return { ok: false, status: 400, error: 'Name and role are required' }
  }

  const existingAgent = await dbGet<{ id: number }>(
    'SELECT id FROM agents WHERE name = ? AND workspace_id = ?',
    [name, ctx.workspaceId]
  )
  if (existingAgent) {
    return { ok: false, status: 409, error: 'Agent name already exists' }
  }

  if (provision_workspace) {
    logger.warn({ agentSlug, workspace_path }, 'provision_workspace requested but gateway CLI is not available; skipping')
  }

  const now = Math.floor(Date.now() / 1000)

  const dbResult = await dbRun(`
    INSERT INTO agents (
      name, role, session_key, soul_content, status,
      created_at, updated_at, config, workspace_id, model, instructions
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    name,
    finalRole,
    session_key ?? null,
    soul_content ?? null,
    status,
    now,
    now,
    JSON.stringify(finalConfig),
    ctx.workspaceId,
    model,
    instructions,
  ])

  const agentId = dbResult.insertId

  await db_helpers.logActivity(
    'agent_created',
    'agent',
    agentId,
    ctx.actorUsername,
    `Created agent: ${name} (${finalRole})${template ? ` from template: ${template}` : ''}`,
    {
      name,
      role: finalRole,
      status,
      session_key,
      template: template || null,
    },
    ctx.workspaceId,
  )

  const createdAgent = await dbGet<Agent>(
    'SELECT * FROM agents WHERE id = ? AND workspace_id = ?',
    [agentId, ctx.workspaceId]
  )

  if (!createdAgent) {
    return { ok: false, status: 500, error: 'Failed to retrieve created agent' }
  }

  const parsedAgent = {
    ...createdAgent,
    config: enrichAgentConfigFromWorkspace(JSON.parse(createdAgent.config || '{}')),
    taskStats: {
      total: 0,
      assigned: 0,
      in_progress: 0,
      quality_review: 0,
      done: 0,
      completed: 0,
    },
  }

  eventBus.broadcast('agent.created', parsedAgent)

  if (write_to_gateway && finalConfig) {
    const fc = finalConfig as Record<string, any>
    try {
      await writeAgentToConfig({
        id: agentSlug,
        name,
        ...(fc.model && { model: fc.model }),
        ...(fc.identity && { identity: fc.identity }),
        ...(fc.sandbox && { sandbox: fc.sandbox }),
        ...(fc.tools && { tools: fc.tools }),
        ...(fc.subagents && { subagents: fc.subagents }),
        ...(fc.memorySearch && { memorySearch: fc.memorySearch }),
      })

      await logAuditEvent({
        action: 'agent_gateway_create',
        actor: ctx.actorUsername,
        actor_id: ctx.actorUserId,
        target_type: 'agent',
        target_id: agentId,
        detail: { name, agent_id: agentSlug, template: template || null },
        ip_address: ctx.ipAddress,
      })
    } catch (gwErr: unknown) {
      logger.error({ err: gwErr }, 'Gateway write-back failed')
      const msg = gwErr instanceof Error ? gwErr.message : 'Gateway write failed'
      return {
        ok: true,
        agent: parsedAgent,
        warning: `Agent created in MC but gateway write failed: ${msg}`,
      }
    }
  }

  return { ok: true, agent: parsedAgent }
}
