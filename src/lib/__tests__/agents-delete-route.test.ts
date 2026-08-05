import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const requireRole = vi.fn()
const runGateway = vi.fn()
const removeAgentFromConfig = vi.fn()
const mockDbGetOne = vi.fn()
const mockDbRun = vi.fn(() => Promise.resolve({ insertId: 0, affectedRows: 1 }))

vi.mock('@/lib/auth', () => ({
  requireRole,
}))

vi.mock('@/lib/command', () => ({
  runGateway,
}))

vi.mock('@/lib/agent-sync', () => ({
  writeAgentToConfig: vi.fn(),
  enrichAgentConfigFromWorkspace: vi.fn((value) => value),
  removeAgentFromConfig,
}))

vi.mock('@/lib/db', () => ({
  dbGetOne: mockDbGetOne,
  dbGetAll: vi.fn(() => Promise.resolve([])),
  dbRun: mockDbRun,
  db_helpers: {
    logActivity: vi.fn(() => Promise.resolve()),
  },
  logAuditEvent: vi.fn(() => Promise.resolve()),
}))

vi.mock('@/lib/event-bus', () => ({
  eventBus: {
    broadcast: vi.fn(),
  },
}))

vi.mock('@/lib/logger', () => ({
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
  },
}))

describe('DELETE /api/agents/[id]', () => {
  beforeEach(() => {
    vi.resetModules()
    requireRole.mockReturnValue({ user: { id: 1, username: 'admin', role: 'admin', workspace_id: 1 } })
    runGateway.mockReset()
    removeAgentFromConfig.mockReset()
    mockDbGetOne.mockReset()
    mockDbRun.mockReset()
    mockDbRun.mockResolvedValue({ insertId: 0, affectedRows: 1 })
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('removes the agent from gateway config even when workspace deletion is disabled', async () => {
    const agent = { id: 7, name: 'neo', role: 'tester', config: JSON.stringify({ agentId: 'neo' }) }
    mockDbGetOne.mockResolvedValue(agent)

    const { DELETE } = await import('@/app/api/agents/[id]/route')
    const request = new NextRequest('http://localhost/api/agents/7', {
      method: 'DELETE',
      body: JSON.stringify({ remove_workspace: false }),
      headers: { 'content-type': 'application/json' },
    })

    const response = await DELETE(request, { params: Promise.resolve({ id: '7' }) })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(runGateway).not.toHaveBeenCalled()
    expect(removeAgentFromConfig).toHaveBeenCalledWith({ id: 'neo', name: 'neo' })
    expect(mockDbRun).toHaveBeenCalledWith(
      expect.stringContaining('DELETE FROM agents'),
      [7, 1]
    )
    expect(body.success).toBe(true)
  })

  it('logs a warning when remove_workspace is requested but does not call gateway CLI', async () => {
    const agent = { id: 8, name: 'adam', role: 'tester', config: JSON.stringify({ agentId: 'adam' }) }
    mockDbGetOne.mockResolvedValue(agent)

    const { DELETE } = await import('@/app/api/agents/[id]/route')
    const request = new NextRequest('http://localhost/api/agents/8', {
      method: 'DELETE',
      body: JSON.stringify({ remove_workspace: true }),
      headers: { 'content-type': 'application/json' },
    })

    const response = await DELETE(request, { params: Promise.resolve({ id: '8' }) })

    expect(response.status).toBe(200)
    expect(runGateway).not.toHaveBeenCalled()
    expect(removeAgentFromConfig).toHaveBeenCalledWith({ id: 'adam', name: 'adam' })
    expect(mockDbRun).toHaveBeenCalledWith(
      expect.stringContaining('DELETE FROM agents'),
      [8, 1]
    )
  })

  it('still deletes the Mission Control agent when config cleanup fails', async () => {
    const agent = { id: 9, name: 'trinity', role: 'tester', config: JSON.stringify({ agentId: 'trinity' }) }
    mockDbGetOne.mockResolvedValue(agent)
    removeAgentFromConfig.mockRejectedValue(new Error('GATEWAY_CONFIG_PATH not configured'))

    const { DELETE } = await import('@/app/api/agents/[id]/route')
    const request = new NextRequest('http://localhost/api/agents/9', {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
    })

    const response = await DELETE(request, { params: Promise.resolve({ id: '9' }) })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(mockDbRun).toHaveBeenCalledWith(
      expect.stringContaining('DELETE FROM agents'),
      [9, 1]
    )
    expect(body.success).toBe(true)
    expect(body.warning).toContain('Gateway config cleanup skipped')
  })
})
