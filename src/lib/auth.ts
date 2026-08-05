import { createHash, randomBytes, timingSafeEqual } from 'crypto'
import { dbGetOne, dbGetAll, dbRun } from './db'
import { hashPassword, verifyPassword, verifyPasswordWithRehashCheck } from './password'
import { logSecurityEvent } from './security-events'
import { parseMcSessionCookieHeader } from './session-cookie'

// Trusted IPs for proxy auth header (comma-separated)
const PROXY_AUTH_TRUSTED_IPS = new Set(
  (process.env.MC_PROXY_AUTH_TRUSTED_IPS || '').split(',').map(s => s.trim()).filter(Boolean)
)

// Plugin hook: extensions can register a custom API key resolver without modifying this file.
type AuthResolverHook = (apiKey: string, agentName: string | null) => User | null
let _authResolverHook: AuthResolverHook | null = null
export function registerAuthResolver(hook: AuthResolverHook): void {
  _authResolverHook = hook
}

/**
 * Constant-time string comparison to prevent timing attacks.
 */
export function safeCompare(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false
  const bufA = Buffer.from(a)
  const bufB = Buffer.from(b)
  if (bufA.length !== bufB.length) {
    // Compare against dummy buffer to avoid timing leak on length mismatch
    const dummy = Buffer.alloc(bufA.length)
    timingSafeEqual(bufA, dummy)
    return false
  }
  return timingSafeEqual(bufA, bufB)
}

export interface User {
  id: number
  username: string
  display_name: string
  role: 'admin' | 'operator' | 'viewer'
  workspace_id: number
  tenant_id: number
  provider?: 'local' | 'google' | 'proxy'
  email?: string | null
  avatar_url?: string | null
  is_approved?: number
  created_at: number
  updated_at: number
  last_login_at: number | null
  /** Agent name when request is made on behalf of a specific agent (via X-Agent-Name header) */
  agent_name?: string | null
}

export interface UserSession {
  id: number
  token: string
  user_id: number
  workspace_id: number
  tenant_id: number
  expires_at: number
  created_at: number
  ip_address: string | null
  user_agent: string | null
}

interface SessionQueryRow {
  id: number
  username: string
  display_name: string
  role: 'admin' | 'operator' | 'viewer'
  provider: 'local' | 'google' | null
  email: string | null
  avatar_url: string | null
  is_approved: number
  workspace_id: number
  tenant_id: number
  created_at: number
  updated_at: number
  last_login_at: number | null
  session_id: number
}

interface UserQueryRow {
  id: number
  username: string
  display_name: string
  role: 'admin' | 'operator' | 'viewer'
  provider: 'local' | 'google' | null
  email: string | null
  avatar_url: string | null
  is_approved: number
  workspace_id: number
  tenant_id?: number
  created_at: number
  updated_at: number
  last_login_at: number | null
  password_hash: string
}

// Session management
const SESSION_DURATION = 7 * 24 * 60 * 60 // 7 days in seconds

async function getDefaultWorkspaceContext(): Promise<{ workspaceId: number; tenantId: number }> {
  try {
    const row = await dbGetOne<{ id: number; tenant_id: number }>(`
      SELECT id, tenant_id
      FROM workspaces
      ORDER BY CASE WHEN slug = 'default' THEN 0 ELSE 1 END, id ASC
      LIMIT 1
    `)
    return {
      workspaceId: row?.id || 1,
      tenantId: row?.tenant_id || 1,
    }
  } catch {
    return { workspaceId: 1, tenantId: 1 }
  }
}

export async function getWorkspaceIdFromRequest(request: Request): Promise<number> {
  const user = await getUserFromRequest(request)
  return user?.workspace_id || (await getDefaultWorkspaceContext()).workspaceId
}

export async function getTenantIdFromRequest(request: Request): Promise<number> {
  const user = await getUserFromRequest(request)
  return user?.tenant_id || (await getDefaultWorkspaceContext()).tenantId
}

async function resolveTenantForWorkspace(workspaceId: number): Promise<number> {
  const row = await dbGetOne<{ tenant_id: number }>(
    'SELECT tenant_id FROM workspaces WHERE id = ? LIMIT 1',
    [workspaceId]
  )
  return row?.tenant_id || (await getDefaultWorkspaceContext()).tenantId
}

export async function createSession(
  userId: number,
  ipAddress?: string,
  userAgent?: string,
  workspaceId?: number
): Promise<{ token: string; expiresAt: number }> {
  const token = randomBytes(32).toString('hex')
  const now = Math.floor(Date.now() / 1000)
  const expiresAt = now + SESSION_DURATION

  let resolvedWorkspaceId = workspaceId
  if (!resolvedWorkspaceId) {
    const userRow = await dbGetOne<{ workspace_id: number }>(
      'SELECT workspace_id FROM users WHERE id = ?',
      [userId]
    )
    resolvedWorkspaceId = userRow?.workspace_id || (await getDefaultWorkspaceContext()).workspaceId
  }
  const resolvedTenantId = await resolveTenantForWorkspace(resolvedWorkspaceId)

  const tokenHash = hashSessionToken(token)
  await dbRun(
    `INSERT INTO user_sessions (token, user_id, expires_at, ip_address, user_agent, workspace_id, tenant_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [tokenHash, userId, expiresAt, ipAddress || null, userAgent || null, resolvedWorkspaceId, resolvedTenantId]
  )

  // Update user's last login
  await dbRun('UPDATE users SET last_login_at = ?, updated_at = ? WHERE id = ?', [now, now, userId])

  // Clean up expired sessions
  await dbRun('DELETE FROM user_sessions WHERE expires_at < ?', [now])

  return { token, expiresAt }
}

export async function validateSession(token: string): Promise<(User & { sessionId: number }) | null> {
  if (!token) return null
  const now = Math.floor(Date.now() / 1000)
  const tokenHash = hashSessionToken(token)

  const row = await dbGetOne<SessionQueryRow>(`
    SELECT u.id, u.username, u.display_name, u.role, u.provider, u.email, u.avatar_url, u.is_approved,
           COALESCE(s.workspace_id, u.workspace_id, 1) as workspace_id,
           COALESCE(s.tenant_id, w.tenant_id, 1) as tenant_id,
           u.created_at, u.updated_at, u.last_login_at,
           s.id as session_id
    FROM user_sessions s
    JOIN users u ON u.id = s.user_id
    LEFT JOIN workspaces w ON w.id = COALESCE(s.workspace_id, u.workspace_id, 1)
    WHERE s.token = ? AND s.expires_at > ?
  `, [tokenHash, now])

  if (!row) return null
  const defaultCtx = await getDefaultWorkspaceContext()

  return {
    id: row.id,
    username: row.username,
    display_name: row.display_name,
    role: row.role,
    workspace_id: row.workspace_id || defaultCtx.workspaceId,
    tenant_id: row.tenant_id || defaultCtx.tenantId,
    provider: row.provider || 'local',
    email: row.email ?? null,
    avatar_url: row.avatar_url ?? null,
    is_approved: typeof row.is_approved === 'number' ? row.is_approved : 1,
    created_at: row.created_at,
    updated_at: row.updated_at,
    last_login_at: row.last_login_at,
    sessionId: row.session_id,
  }
}

export async function destroySession(token: string): Promise<void> {
  const tokenHash = hashSessionToken(token)
  await dbRun('DELETE FROM user_sessions WHERE token = ?', [tokenHash])
}

export async function destroyAllUserSessions(userId: number): Promise<void> {
  await dbRun('DELETE FROM user_sessions WHERE user_id = ?', [userId])
}

// Dummy hash used for constant-time rejection when user doesn't exist.
// This ensures authenticateUser takes the same time whether or not the username is valid,
// preventing timing-based username enumeration.
const DUMMY_HASH = '0000000000000000000000000000000000000000000000000000000000000000:0000000000000000000000000000000000000000000000000000000000000000'

// User management
export async function authenticateUser(username: string, password: string): Promise<User | null> {
  const row = await dbGetOne<UserQueryRow>('SELECT * FROM users WHERE username = ?', [username])
  if (!row) {
    // Always run verifyPassword to prevent timing-based username enumeration
    verifyPassword(password, DUMMY_HASH)
    logSecurityEvent({ event_type: 'auth_failure', severity: 'warning', source: 'auth', detail: JSON.stringify({ username, reason: 'user_not_found' }), workspace_id: 1, tenant_id: 1 }).catch(() => {})
    return null
  }
  if ((row.provider || 'local') !== 'local') {
    verifyPassword(password, DUMMY_HASH)
    logSecurityEvent({ event_type: 'auth_failure', severity: 'warning', source: 'auth', detail: JSON.stringify({ username, reason: 'wrong_provider' }), workspace_id: 1, tenant_id: 1 }).catch(() => {})
    return null
  }
  if ((row.is_approved ?? 1) !== 1) {
    verifyPassword(password, DUMMY_HASH)
    logSecurityEvent({ event_type: 'auth_failure', severity: 'warning', source: 'auth', detail: JSON.stringify({ username, reason: 'not_approved' }), workspace_id: 1, tenant_id: 1 }).catch(() => {})
    return null
  }
  const { valid, needsRehash } = verifyPasswordWithRehashCheck(password, row.password_hash)
  if (!valid) {
    logSecurityEvent({ event_type: 'auth_failure', severity: 'warning', source: 'auth', detail: JSON.stringify({ username, reason: 'invalid_password' }), workspace_id: 1, tenant_id: 1 }).catch(() => {})
    return null
  }
  // Progressive rehash: upgrade hash to current scrypt cost on successful login
  if (needsRehash) {
    try {
      await dbRun('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?',
        [hashPassword(password), Math.floor(Date.now() / 1000), row.id])
    } catch { /* non-fatal — will rehash on next login */ }
  }
  const defaultCtx = await getDefaultWorkspaceContext()
  const workspaceId = row.workspace_id || defaultCtx.workspaceId
  return {
    id: row.id,
    username: row.username,
    display_name: row.display_name,
    role: row.role,
    workspace_id: workspaceId,
    tenant_id: await resolveTenantForWorkspace(workspaceId),
    provider: row.provider || 'local',
    email: row.email ?? null,
    avatar_url: row.avatar_url ?? null,
    is_approved: row.is_approved ?? 1,
    created_at: row.created_at,
    updated_at: row.updated_at,
    last_login_at: row.last_login_at,
  }
}

export async function getUserById(id: number): Promise<User | null> {
  const row = await dbGetOne<User>(`
    SELECT u.id, u.username, u.display_name, u.role, u.workspace_id, COALESCE(w.tenant_id, 1) as tenant_id,
           u.provider, u.email, u.avatar_url, u.is_approved, u.created_at, u.updated_at, u.last_login_at
    FROM users u
    LEFT JOIN workspaces w ON w.id = u.workspace_id
    WHERE u.id = ?
  `, [id])
  if (!row) return null
  const defaultCtx = await getDefaultWorkspaceContext()
  return { ...row, tenant_id: row.tenant_id || defaultCtx.tenantId }
}

export async function getAllUsers(): Promise<User[]> {
  return dbGetAll<User>(`
    SELECT u.id, u.username, u.display_name, u.role, u.workspace_id, COALESCE(w.tenant_id, 1) as tenant_id,
           u.provider, u.email, u.avatar_url, u.is_approved, u.created_at, u.updated_at, u.last_login_at
    FROM users u
    LEFT JOIN workspaces w ON w.id = u.workspace_id
    ORDER BY u.created_at
  `)
}

export async function createUser(
  username: string,
  password: string,
  displayName: string,
  role: User['role'] = 'operator',
  options?: { provider?: 'local' | 'google'; provider_user_id?: string | null; email?: string | null; avatar_url?: string | null; is_approved?: 0 | 1; approved_by?: string | null; approved_at?: number | null; workspace_id?: number }
): Promise<User> {
  if (password.length < 12) throw new Error('Password must be at least 12 characters')
  const passwordHash = hashPassword(password)
  const provider = options?.provider || 'local'
  const workspaceId = options?.workspace_id || (await getDefaultWorkspaceContext()).workspaceId
  const result = await dbRun(
    `INSERT INTO users (username, display_name, password_hash, role, provider, provider_user_id, email, avatar_url, is_approved, approved_by, approved_at, workspace_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      username,
      displayName,
      passwordHash,
      role,
      provider,
      options?.provider_user_id || null,
      options?.email || null,
      options?.avatar_url || null,
      typeof options?.is_approved === 'number' ? options.is_approved : 1,
      options?.approved_by || null,
      options?.approved_at || null,
      workspaceId,
    ]
  )

  return (await getUserById(result.insertId))!
}

export async function updateUser(id: number, updates: { display_name?: string; role?: User['role']; password?: string; email?: string | null; avatar_url?: string | null; is_approved?: 0 | 1 }): Promise<User | null> {
  const fields: string[] = []
  const params: any[] = []

  if (updates.display_name !== undefined) { fields.push('display_name = ?'); params.push(updates.display_name) }
  if (updates.role !== undefined) { fields.push('role = ?'); params.push(updates.role) }
  if (updates.password !== undefined) { fields.push('password_hash = ?'); params.push(hashPassword(updates.password)) }
  if (updates.email !== undefined) { fields.push('email = ?'); params.push(updates.email) }
  if (updates.avatar_url !== undefined) { fields.push('avatar_url = ?'); params.push(updates.avatar_url) }
  if (updates.is_approved !== undefined) { fields.push('is_approved = ?'); params.push(updates.is_approved) }

  if (fields.length === 0) return getUserById(id)

  fields.push('updated_at = ?')
  params.push(Math.floor(Date.now() / 1000))
  params.push(id)

  await dbRun(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`, params)
  return getUserById(id)
}

export async function deleteUser(id: number): Promise<boolean> {
  await destroyAllUserSessions(id)
  const result = await dbRun('DELETE FROM users WHERE id = ?', [id])
  return result.affectedRows > 0
}

/**
 * Seed admin user from environment variables on first run.
 * If no users exist, creates an admin from AUTH_USER/AUTH_PASS env vars.
 */
/**
 * Get user from request - checks session cookie or API key.
 * For API key auth, returns a synthetic "api" user.
 */
/**
 * Resolve a user by username for proxy auth.
 * If the user does not exist and MC_PROXY_AUTH_DEFAULT_ROLE is set, auto-provisions them.
 * Auto-provisioned users receive a random unusable password — they cannot log in locally.
 */
async function resolveOrProvisionProxyUser(username: string): Promise<User | null> {
  try {
    const defaultCtx = await getDefaultWorkspaceContext()
    const { workspaceId } = defaultCtx

    const row = await dbGetOne<UserQueryRow>(`
      SELECT u.id, u.username, u.display_name, u.role, u.workspace_id,
             COALESCE(w.tenant_id, 1) as tenant_id,
             u.provider, u.email, u.avatar_url, u.is_approved,
             u.created_at, u.updated_at, u.last_login_at
      FROM users u
      LEFT JOIN workspaces w ON w.id = u.workspace_id
      WHERE u.username = ?
    `, [username])

    if (row) {
      if ((row.is_approved ?? 1) !== 1) return null
      const resolvedWorkspaceId = row.workspace_id || workspaceId
      return {
        id: row.id,
        username: row.username,
        display_name: row.display_name,
        role: row.role,
        workspace_id: resolvedWorkspaceId,
        tenant_id: await resolveTenantForWorkspace(resolvedWorkspaceId),
        provider: row.provider || 'local',
        email: row.email ?? null,
        avatar_url: row.avatar_url ?? null,
        is_approved: row.is_approved ?? 1,
        created_at: row.created_at,
        updated_at: row.updated_at,
        last_login_at: row.last_login_at,
      }
    }

    // Auto-provision if MC_PROXY_AUTH_DEFAULT_ROLE is configured
    const defaultRole = (process.env.MC_PROXY_AUTH_DEFAULT_ROLE || '').trim()
    if (!defaultRole || !(['viewer', 'operator', 'admin'] as const).includes(defaultRole as User['role'])) {
      return null
    }

    // Random password — proxy users cannot log in via the local login form
    return createUser(username, randomBytes(32).toString('hex'), username, defaultRole as User['role'])
  } catch {
    return null
  }
}

export async function getUserFromRequest(request: Request): Promise<User | null> {
  // Extract agent identity header (optional, for attribution)
  const rawAgentName = (request.headers.get('x-agent-name') || '').trim()
  const agentName = rawAgentName ? rawAgentName.replace(/[^a-zA-Z0-9._\-\s]/g, '').slice(0, 100) || null : null

  // Proxy / trusted-header auth (MC_PROXY_AUTH_HEADER)
  // When the gateway has already authenticated the user and injects their username
  // as a trusted header (e.g. X-Auth-Username from Envoy OIDC claimToHeaders),
  // skip the local login form entirely.
  // SECURITY: MC_PROXY_AUTH_TRUSTED_IPS must be set to restrict which IPs can send
  // the proxy auth header. Without it, any client reaching MC directly could spoof
  // the header and impersonate any user.
  const proxyAuthHeader = (process.env.MC_PROXY_AUTH_HEADER || '').trim()
  if (proxyAuthHeader) {
    const trustedIps = PROXY_AUTH_TRUSTED_IPS
    if (trustedIps.size > 0) {
      const clientIp = request.headers.get('x-real-ip')?.trim()
        || request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
        || ''
      if (trustedIps.has(clientIp)) {
        const proxyUsername = (request.headers.get(proxyAuthHeader) || '').trim()
        if (proxyUsername) {
          const user = await resolveOrProvisionProxyUser(proxyUsername)
          if (user) return { ...user, agent_name: agentName }
        }
      }
    } else {
      // MC_PROXY_AUTH_HEADER is set but MC_PROXY_AUTH_TRUSTED_IPS is empty.
      // Allowing any client to send this header would let anyone impersonate any user —
      // so we reject proxy auth entirely and force normal credential-based login.
      // Set MC_PROXY_AUTH_TRUSTED_IPS to the IP(s) of your reverse proxy to enable this feature.
      console.error(
        '[security] MC_PROXY_AUTH_HEADER is configured but MC_PROXY_AUTH_TRUSTED_IPS is empty. ' +
        'Proxy auth DISABLED — set MC_PROXY_AUTH_TRUSTED_IPS to your reverse proxy IP(s) to enable it.'
      )
    }
  }

  // Check session cookie
  const cookieHeader = request.headers.get('cookie') || ''
  const sessionToken = parseMcSessionCookieHeader(cookieHeader)
  if (sessionToken) {
    const user = await validateSession(sessionToken)
    if (user) return { ...user, agent_name: agentName }
  }

  // Check API key - DB override first, then env var
  const apiKey = extractApiKeyFromHeaders(request.headers)
  const configuredApiKey = await resolveActiveApiKey()

  if (configuredApiKey && apiKey && safeCompare(apiKey, configuredApiKey)) {
    // FR-D2: Log warning when global admin API key is used.
    // Prefer agent-scoped keys (POST /api/agents/{id}/keys) for least-privilege access.
    const defaultCtx = await getDefaultWorkspaceContext()
    logSecurityEvent({
      event_type: 'global_api_key_used',
      severity: 'info',
      source: 'auth',
      agent_name: agentName || undefined,
      detail: JSON.stringify({ hint: 'Consider using agent-scoped API keys for least-privilege access' }),
      ip_address: request.headers.get('x-real-ip') || 'unknown',
      workspace_id: defaultCtx.workspaceId,
      tenant_id: defaultCtx.tenantId,
    }).catch(() => {})
    return {
      id: 0,
      username: 'api',
      display_name: 'API Access',
      role: 'admin',
      workspace_id: defaultCtx.workspaceId,
      tenant_id: defaultCtx.tenantId,
      created_at: 0,
      updated_at: 0,
      last_login_at: null,
      agent_name: agentName,
    }
  }

  // Agent-scoped API keys
  if (apiKey) {
    try {
      const keyHash = hashApiKey(apiKey)
      const now = Math.floor(Date.now() / 1000)
      const row = await dbGetOne<{
        id: number
        agent_id: number
        workspace_id: number
        scopes: string
        expires_at: number | null
        revoked_at: number | null
      }>(`
        SELECT id, agent_id, workspace_id, scopes, expires_at, revoked_at
        FROM agent_api_keys
        WHERE key_hash = ?
        LIMIT 1
      `, [keyHash])

      if (row && !row.revoked_at && (!row.expires_at || row.expires_at > now)) {
        const scopes = parseAgentScopes(row.scopes)
        const agent = await dbGetOne<{ id: number; name: string }>(
          'SELECT id, name FROM agents WHERE id = ? AND workspace_id = ?',
          [row.agent_id, row.workspace_id]
        )

        if (agent) {
          if (agentName && agentName !== agent.name && !scopes.has('admin')) {
            return null
          }

          await dbRun(
            'UPDATE agent_api_keys SET last_used_at = ?, updated_at = ? WHERE id = ?',
            [now, now, row.id]
          )

          const defaultCtx = await getDefaultWorkspaceContext()
          return {
            id: -row.id,
            username: `agent:${agent.name}`,
            display_name: agent.name,
            role: deriveRoleFromScopes(scopes),
            workspace_id: row.workspace_id,
            tenant_id: defaultCtx.tenantId,
            created_at: 0,
            updated_at: now,
            last_login_at: now,
            agent_name: agent.name,
          }
        }
      }
    } catch {
      // ignore missing table / startup race
    }
  }

  // Plugin hook: allow Pro (or other extensions) to resolve custom API keys
  if (apiKey && _authResolverHook) {
    const resolved = _authResolverHook(apiKey, agentName)
    if (resolved) return resolved
  }

  return null
}

/**
 * Resolve the active API key: check DB settings override first, then env var.
 */
async function resolveActiveApiKey(): Promise<string> {
  try {
    const row = await dbGetOne<{ value: string }>(
      "SELECT value FROM settings WHERE key = 'security.api_key'",
      []
    )
    if (row?.value) return row.value
  } catch {
    // DB not ready yet — fall back to env
  }
  return (process.env.API_KEY || '').trim()
}

function extractApiKeyFromHeaders(headers: Headers): string | null {
  const direct = (headers.get('x-api-key') || '').trim()
  if (direct) return direct

  const authorization = (headers.get('authorization') || '').trim()
  if (!authorization) return null

  const [scheme, ...rest] = authorization.split(/\s+/)
  if (!scheme || rest.length === 0) return null

  const normalized = scheme.toLowerCase()
  if (normalized === 'bearer' || normalized === 'apikey' || normalized === 'token') {
    return rest.join(' ').trim() || null
  }

  return null
}

function hashApiKey(rawKey: string): string {
  return createHash('sha256').update(rawKey).digest('hex')
}

function hashSessionToken(rawToken: string): string {
  return createHash('sha256').update(rawToken).digest('hex')
}

function parseAgentScopes(raw: string): Set<string> {
  try {
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) return new Set(parsed.map((scope) => String(scope)))
  } catch {
    // ignore parse errors
  }
  return new Set()
}

function deriveRoleFromScopes(scopes: Set<string>): User['role'] {
  if (scopes.has('admin')) return 'admin'
  if (scopes.has('operator')) return 'operator'
  return 'viewer'
}

/**
 * Role hierarchy levels for access control.
 * viewer < operator < admin
 */
const ROLE_LEVELS: Record<string, number> = { viewer: 0, operator: 1, admin: 2 }

/**
 * Check if a user meets the minimum role requirement.
 * Returns { user } on success, or { error, status } on failure (401 or 403).
 */
export async function requireRole(
  request: Request,
  minRole: User['role']
): Promise<{ user: User; error?: never; status?: never } | { user?: never; error: string; status: 401 | 403 }> {
  const user = await getUserFromRequest(request)
  if (!user) {
    return { error: 'Authentication required', status: 401 }
  }
  if ((ROLE_LEVELS[user.role] ?? -1) < ROLE_LEVELS[minRole]) {
    return { error: `Requires ${minRole} role or higher`, status: 403 }
  }
  return { user }
}
