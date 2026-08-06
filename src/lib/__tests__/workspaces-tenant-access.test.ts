import { describe, expect, it, vi, beforeEach } from 'vitest'
import {
  ensureTenantWorkspaceAccess,
  ensureTenantProjectAccess,
  ForbiddenError,
} from '@/lib/workspaces'

const mockDbGet = vi.fn()
const mockDbRun = vi.fn().mockResolvedValue({ insertId: 0, affectedRows: 1 })
const mockDbGetAll = vi.fn().mockResolvedValue([])

vi.mock('@/lib/db-pool', () => ({
  dbGet: mockDbGet,
  dbGetAll: mockDbGetAll,
  dbRun: mockDbRun,
}))

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

describe('tenant access guards', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDbRun.mockResolvedValue({ insertId: 0, affectedRows: 1 })
  })

  it('allows workspace access for matching tenant', async () => {
    mockDbGet.mockResolvedValueOnce({ id: 1, slug: 'default', name: 'Default', tenant_id: 10, created_at: 1, updated_at: 1 })
    const workspace = await ensureTenantWorkspaceAccess(10, 1, {
      actor: 'alice',
      actorId: 1,
      route: '/api/projects',
    })
    expect(workspace.id).toBe(1)
    expect(workspace.tenant_id).toBe(10)
  })

  it('denies workspace access for foreign tenant and logs tenant_access_denied', async () => {
    mockDbGet.mockResolvedValueOnce(undefined) // workspace not found for tenant

    await expect(
      ensureTenantWorkspaceAccess(10, 2, {
        actor: 'alice',
        actorId: 1,
        route: '/api/projects',
        ipAddress: '127.0.0.1',
        userAgent: 'vitest',
      })
    ).rejects.toThrow(ForbiddenError)

    expect(mockDbRun).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO audit_log'),
      expect.arrayContaining(['tenant_access_denied'])
    )
  })

  it('allows project access for matching tenant', async () => {
    mockDbGet.mockResolvedValueOnce({ id: 101, workspace_id: 1, tenant_id: 10 })
    const project = await ensureTenantProjectAccess(10, 101, {
      actor: 'alice',
      actorId: 1,
      route: '/api/projects/101',
    })
    expect(project.id).toBe(101)
    expect(project.workspace_id).toBe(1)
    expect(project.tenant_id).toBe(10)
  })

  it('denies project access for foreign tenant and logs tenant_access_denied', async () => {
    mockDbGet.mockResolvedValueOnce({ id: 202, workspace_id: 2, tenant_id: 20 }) // different tenant

    await expect(
      ensureTenantProjectAccess(10, 202, {
        actor: 'alice',
        actorId: 1,
        route: '/api/projects/202',
      })
    ).rejects.toThrow(ForbiddenError)

    expect(mockDbRun).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO audit_log'),
      expect.arrayContaining(['tenant_access_denied'])
    )
  })
})
