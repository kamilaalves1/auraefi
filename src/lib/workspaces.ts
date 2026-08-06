import { dbGet, dbGetAll, dbRun } from '@/lib/db-pool'

// Allowed workspace isolation policies (issue #677 slice 1):
// - 'shared': cross-workspace memory access from agents is allowed (default)
// - 'strict': cross-workspace memory access from agents is not allowed
export const WORKSPACE_ISOLATION_VALUES = ['shared', 'strict'] as const
export type WorkspaceIsolation = (typeof WORKSPACE_ISOLATION_VALUES)[number]

export interface WorkspaceRecord {
  id: number
  slug: string
  name: string
  tenant_id: number
  brand: string | null
  isolation: WorkspaceIsolation
  created_at: number
  updated_at: number
}

export interface ProjectTenantRecord {
  id: number
  workspace_id: number
  tenant_id: number
}

export class ForbiddenError extends Error {
  readonly status = 403 as const
  constructor(message: string) {
    super(message)
    this.name = 'ForbiddenError'
  }
}

interface AccessAuditContext {
  actor?: string
  actorId?: number
  route?: string
  ipAddress?: string | null
  userAgent?: string | null
}

async function logTenantAccessDenied(
  targetType: 'workspace' | 'project',
  targetId: number,
  tenantId: number,
  context: AccessAuditContext
) {
  await dbRun(`
    INSERT INTO audit_log (action, actor, actor_id, target_type, target_id, detail, ip_address, user_agent)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    'tenant_access_denied',
    context.actor || 'unknown',
    context.actorId ?? null,
    targetType,
    targetId,
    JSON.stringify({
      tenant_id: tenantId,
      route: context.route || null,
    }),
    context.ipAddress ?? null,
    context.userAgent ?? null,
  ])
}

export async function getWorkspaceForTenant(
  workspaceId: number,
  tenantId: number
): Promise<WorkspaceRecord | null> {
  const row = await dbGet<WorkspaceRecord>(`
    SELECT id, slug, name, tenant_id, brand, isolation, created_at, updated_at
    FROM workspaces
    WHERE id = ? AND tenant_id = ?
    LIMIT 1
  `, [workspaceId, tenantId])
  return row || null
}

export async function listWorkspacesForTenant(
  tenantId: number
): Promise<WorkspaceRecord[]> {
  return dbGetAll<WorkspaceRecord>(`
    SELECT id, slug, name, tenant_id, brand, isolation, created_at, updated_at
    FROM workspaces
    WHERE tenant_id = ?
    ORDER BY CASE WHEN slug = 'default' THEN 0 ELSE 1 END, name ASC
  `, [tenantId])
}

export async function assertWorkspaceTenant(
  workspaceId: number,
  tenantId: number
): Promise<WorkspaceRecord> {
  const workspace = await getWorkspaceForTenant(workspaceId, tenantId)
  if (!workspace) {
    throw new Error('Workspace not found for tenant')
  }
  return workspace
}

export async function ensureTenantWorkspaceAccess(
  tenantId: number,
  workspaceId: number,
  context: AccessAuditContext = {}
): Promise<WorkspaceRecord> {
  const workspace = await getWorkspaceForTenant(workspaceId, tenantId)
  if (!workspace) {
    await logTenantAccessDenied('workspace', workspaceId, tenantId, context)
    throw new ForbiddenError('Workspace not accessible for tenant')
  }
  return workspace
}

export async function ensureTenantProjectAccess(
  tenantId: number,
  projectId: number,
  context: AccessAuditContext = {}
): Promise<ProjectTenantRecord> {
  const project = await dbGet<ProjectTenantRecord>(`
    SELECT p.id, p.workspace_id, w.tenant_id
    FROM projects p
    JOIN workspaces w ON w.id = p.workspace_id
    WHERE p.id = ?
    LIMIT 1
  `, [projectId])

  if (!project || project.tenant_id !== tenantId) {
    await logTenantAccessDenied('project', projectId, tenantId, context)
    throw new ForbiddenError('Project not accessible for tenant')
  }

  return project
}
