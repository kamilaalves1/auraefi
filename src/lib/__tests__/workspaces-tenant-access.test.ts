import { describe, expect, it, vi, beforeEach } from 'vitest'

const workspaces = [
  { id: 1, slug: 'default', name: 'Default', tenant_id: 10, brand: null, isolation: 'shared', created_at: 1, updated_at: 1 },
  { id: 2, slug: 'other', name: 'Other', tenant_id: 20, brand: null, isolation: 'shared', created_at: 1, updated_at: 1 },
]

const projects = [
  { id: 101, workspace_id: 1 },
  { id: 202, workspace_id: 2 },
]

const { mockDbGetOne, mockDbRun } = vi.hoisted(() => {
  const mockDbGetOne = vi.fn()
  const mockDbRun = vi.fn(() => Promise.resolve({ insertId: 1, affectedRows: 1 }))
  return { mockDbGetOne, mockDbRun }
})

vi.mock('@/lib/db-pool', () => ({
  getPool: vi.fn(),
  dbGetOne: mockDbGetOne,
  dbGetAll: vi.fn(() => Promise.resolve([])),
  dbRun: mockDbRun,
  dbTransaction: vi.fn(),
  closePool: vi.fn(),
}))

import {
  ensureTenantWorkspaceAccess,
  ensureTenantProjectAccess,
  ForbiddenError,
} from '@/lib/workspaces'

describe('tenant access guards', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDbRun.mockResolvedValue({ insertId: 1, affectedRows: 1 })
  })

  it('allows workspace access for matching tenant', async () => {
    mockDbGetOne.mockResolvedValueOnce(workspaces[0])

    const workspace = await ensureTenantWorkspaceAccess(10, 1, {
      actor: 'alice',
      actorId: 1,
      route: '/api/projects',
    })
    expect(workspace.id).toBe(1)
    expect(workspace.tenant_id).toBe(10)
  })

  it('denies workspace access for foreign tenant and logs tenant_access_denied', async () => {
    mockDbGetOne.mockResolvedValueOnce(undefined)

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
      expect.arrayContaining(['tenant_access_denied', 'alice']),
    )
  })

  it('allows project access for matching tenant', async () => {
    const project = projects[0]
    const workspace = workspaces[0]
    mockDbGetOne.mockResolvedValueOnce({
      id: project.id,
      workspace_id: project.workspace_id,
      tenant_id: workspace.tenant_id,
    })

    const result = await ensureTenantProjectAccess(10, 101, {
      actor: 'alice',
      actorId: 1,
      route: '/api/projects/101',
    })
    expect(result.id).toBe(101)
    expect(result.workspace_id).toBe(1)
    expect(result.tenant_id).toBe(10)
  })

  it('denies project access for foreign tenant and logs tenant_access_denied', async () => {
    mockDbGetOne.mockResolvedValueOnce({
      id: 202,
      workspace_id: 2,
      tenant_id: 20,
    })

    await expect(
      ensureTenantProjectAccess(10, 202, {
        actor: 'alice',
        actorId: 1,
        route: '/api/projects/202',
      })
    ).rejects.toThrow(ForbiddenError)

    expect(mockDbRun).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO audit_log'),
      expect.arrayContaining(['tenant_access_denied']),
    )
  })
})
