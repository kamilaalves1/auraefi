
import BetterSqlite3 from 'better-sqlite3'
import { db_helpers, logAuditEvent, type Agent } from '@/lib/db'
import { eventBus } from '@/lib/event-bus'
import { getTemplate, buildAgentConfig } from '@/lib/agent-templates'
import { writeAgentToConfig, enrichAgentConfigFromWorkspace } from '@/lib/agent-sync'
import { logger } from '@/lib/logger'
import { config as appConfig } from '@/lib/config'


export type CreateMcAgentBody = {
  name: string
  openclaw_id?: string
  role?: string
  session_key?: string
  soul_content?: string
  status?: string
  config?: Record<string, unknown>
  template?: string
  gateway_config?: Record<string, unknown>
  write_to_gateway?: boolean
  provision_openclaw_workspace?: boolean
  openclaw_workspace_path?: string
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
type SqliteDatabase = InstanceType<typeof BetterSqlite3>

export async function createMcAgent(
  db: SqliteDatabase,
  ctx: CreateMcAgentContext,
  body: CreateMcAgentBody,
): Promise<CreateMcAgentResult> {
  const {
    name,
    openclaw_id,
    role,
    session_key,
    soul_content,
    status = 'offline',
    config = {},
    template,
    gateway_config,
    write_to_gateway,
    provision_openclaw_workspace,
    openclaw_workspace_path,
    model = 'claude-sonnet-4-6',
    instructions = '',
  } = body

  const openclawId = (openclaw_id || name || 'agent')
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
      id: openclawId,
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

  const existingAgent = db
    .prepare('SELECT id FROM agents WHERE name = ? AND workspace_id = ?')
    .get(name, ctx.workspaceId)
  if (existingAgent) {
    return { ok: false, status: 409, error: 'Agent name already exists' }
  }

  if (provision_openclaw_workspace) {
    // Gateway CLI workspace provisioning is not available in this build
    logger.warn({ openclawId, openclaw_workspace_path }, 'provision_openclaw_workspace requested but gateway CLI is not available; skipping')
  }

  const now = Math.floor(Date.now() / 1000)

  const stmt = db.prepare(`
      INSERT INTO agents (
        name, role, session_key, soul_content, status,
        created_at, updated_at, config, workspace_id, model, instructions
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)

  const dbResult = stmt.run(
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
  )

  const agentId = dbResult.lastInsertRowid as number

  db_helpers.logActivity(
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

  const createdAgent = db
    .prepare('SELECT * FROM agents WHERE id = ? AND workspace_id = ?')
    .get(agentId, ctx.workspaceId) as Agent

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
        id: openclawId,
        name,
        ...(fc.model && { model: fc.model }),
        ...(fc.identity && { identity: fc.identity }),
        ...(fc.sandbox && { sandbox: fc.sandbox }),
        ...(fc.tools && { tools: fc.tools }),
        ...(fc.subagents && { subagents: fc.subagents }),
        ...(fc.memorySearch && { memorySearch: fc.memorySearch }),
      })

      logAuditEvent({
        action: 'agent_gateway_create',
        actor: ctx.actorUsername,
        actor_id: ctx.actorUserId,
        target_type: 'agent',
        target_id: agentId,
        detail: { name, openclaw_id: openclawId, template: template || null },
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
