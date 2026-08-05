import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockDbRun, mockDbGetOne } = vi.hoisted(() => ({
  mockDbRun: vi.fn(() => Promise.resolve({ insertId: 42, affectedRows: 1 })),
  mockDbGetOne: vi.fn(),
}))

vi.mock('@/lib/db', () => ({
  dbGetOne: mockDbGetOne,
  dbGetAll: vi.fn(() => Promise.resolve([])),
  dbRun: mockDbRun,
}))

vi.mock('@/lib/event-bus', () => ({
  eventBus: { broadcast: vi.fn() },
}))

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import { logSecurityEvent, updateAgentTrustScore, getSecurityPosture } from '@/lib/security-events'

describe('logSecurityEvent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDbRun.mockResolvedValue({ insertId: 42, affectedRows: 1 })
  })

  it('inserts an event into the database', async () => {
    const id = await logSecurityEvent({
      event_type: 'auth_failure',
      severity: 'warning',
      source: 'auth',
      detail: 'test detail',
    })

    expect(mockDbRun).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO security_events'),
      expect.arrayContaining(['auth_failure', 'warning', 'auth', 'test detail'])
    )
    expect(id).toBe(42)
  })

  it('defaults severity to info when not provided', async () => {
    await logSecurityEvent({ event_type: 'test_event' })
    expect(mockDbRun).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO security_events'),
      expect.arrayContaining(['test_event', 'info'])
    )
  })

  it('uses provided workspace_id and tenant_id', async () => {
    await logSecurityEvent({
      event_type: 'test_event',
      severity: 'critical',
      workspace_id: 5,
      tenant_id: 3,
    })
    expect(mockDbRun).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO security_events'),
      expect.arrayContaining(['test_event', 'critical', 5, 3])
    )
  })

  it('broadcasts via event bus', async () => {
    const { eventBus } = await import('@/lib/event-bus')
    await logSecurityEvent({ event_type: 'injection_attempt', severity: 'critical' })
    expect(eventBus.broadcast).toHaveBeenCalledWith(
      'security.event',
      expect.objectContaining({ event_type: 'injection_attempt', severity: 'critical' })
    )
  })
})

describe('updateAgentTrustScore', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDbRun.mockResolvedValue({ insertId: 1, affectedRows: 1 })
    mockDbGetOne.mockResolvedValue({
      auth_failures: 1,
      injection_attempts: 0,
      rate_limit_hits: 0,
      secret_exposures: 0,
      successful_tasks: 5,
      failed_tasks: 0,
      trust_score: 0.95,
    })
  })

  it('inserts and updates the trust score row', async () => {
    await updateAgentTrustScore('test-agent', 'auth.failure', 1)
    expect(mockDbRun).toHaveBeenCalled()
  })

  it('recalculates trust score clamped between 0 and 1', async () => {
    mockDbGetOne.mockResolvedValue({
      auth_failures: 20,
      injection_attempts: 10,
      rate_limit_hits: 5,
      secret_exposures: 3,
      successful_tasks: 0,
      failed_tasks: 0,
      trust_score: 0,
    })

    await updateAgentTrustScore('bad-agent', 'injection.attempt', 1)
    // The score update call should pass a value between 0 and 1
    const calls = mockDbRun.mock.calls as any[][]
    const scoreUpdate = calls.find(c => Array.isArray(c[1]) && typeof c[1][0] === 'number' && c[1][0] >= 0 && c[1][0] <= 1)
    expect(scoreUpdate).toBeDefined()
  })
})

describe('getSecurityPosture', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns expected posture shape', async () => {
    mockDbGetOne
      .mockResolvedValueOnce({ total: 10, critical: 2, warning: 5 })
      .mockResolvedValueOnce({ count: 3 })
      .mockResolvedValueOnce({ avg_trust: 0.85 })

    const posture = await getSecurityPosture(1)
    expect(posture).toHaveProperty('score')
    expect(posture).toHaveProperty('totalEvents')
    expect(posture).toHaveProperty('criticalEvents')
    expect(posture).toHaveProperty('warningEvents')
    expect(posture).toHaveProperty('avgTrustScore')
    expect(posture).toHaveProperty('recentIncidents')
    expect(typeof posture.score).toBe('number')
    expect(posture.score).toBeGreaterThanOrEqual(0)
    expect(posture.score).toBeLessThanOrEqual(100)
  })

  it('deducts points for critical and warning events', async () => {
    mockDbGetOne
      .mockResolvedValueOnce({ total: 5, critical: 5, warning: 0 })
      .mockResolvedValueOnce({ count: 5 })
      .mockResolvedValueOnce({ avg_trust: 1.0 })

    const posture = await getSecurityPosture(1)
    expect(posture.score).toBeLessThan(100)
  })

  it('returns score of 100 with no events', async () => {
    mockDbGetOne
      .mockResolvedValueOnce({ total: 0, critical: 0, warning: 0 })
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ avg_trust: 1.0 })

    const posture = await getSecurityPosture(1)
    expect(posture.score).toBe(100)
  })
})

describe('injection guard new rules', () => {
  let scanForInjection: typeof import('@/lib/injection-guard').scanForInjection

  beforeEach(async () => {
    const mod = await import('@/lib/injection-guard')
    scanForInjection = mod.scanForInjection
  })

  it('detects SSRF targeting metadata endpoint', () => {
    const report = scanForInjection('curl http://169.254.169.254/latest/meta-data/', { context: 'shell' })
    expect(report.safe).toBe(false)
    expect(report.matches.some(m => m.rule === 'cmd-ssrf')).toBe(true)
  })

  it('detects SSRF targeting localhost', () => {
    const report = scanForInjection('wget http://localhost:8080/admin', { context: 'shell' })
    expect(report.safe).toBe(false)
    expect(report.matches.some(m => m.rule === 'cmd-ssrf')).toBe(true)
  })

  it('detects template injection (Jinja2)', () => {
    const report = scanForInjection('{{config.__class__.__init__.__globals__}}', { context: 'prompt' })
    expect(report.safe).toBe(false)
    expect(report.matches.some(m => m.rule === 'cmd-template-injection')).toBe(true)
  })

  it('detects SQL injection (UNION SELECT)', () => {
    const report = scanForInjection("' UNION SELECT * FROM users --", { context: 'shell' })
    expect(report.safe).toBe(false)
    expect(report.matches.some(m => m.rule === 'cmd-sql-injection')).toBe(true)
  })

  it('detects SQL injection (OR 1=1)', () => {
    const report = scanForInjection("' OR 1=1 --", { context: 'shell' })
    expect(report.safe).toBe(false)
    expect(report.matches.some(m => m.rule === 'cmd-sql-injection')).toBe(true)
  })

  it('does not false-positive on normal SQL mentions', () => {
    const report = scanForInjection('SELECT name FROM products WHERE id = 5', { context: 'shell' })
    // This should not trigger because it lacks injection markers
    expect(report.matches.filter(m => m.rule === 'cmd-sql-injection')).toHaveLength(0)
  })
})
