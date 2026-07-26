import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { logAuditEvent, getDatabase } from '@/lib/db'
import { existsSync } from 'fs'
import os from 'os'
import { execFileSync } from 'child_process'
import { validateBody, integrationActionSchema } from '@/lib/validation'
import { mutationLimiter, extractClientIp } from '@/lib/rate-limit'
import { detectProviderSubscriptions } from '@/lib/provider-subscriptions'
import { getPluginIntegrations, getPluginCategories } from '@/lib/plugins'
import type { PluginIntegrationDef } from '@/lib/plugins'

// ---------------------------------------------------------------------------
// Integration registry
// ---------------------------------------------------------------------------

type BuiltinCategory = 'ai' | 'search' | 'social' | 'messaging' | 'devtools' | 'security' | 'infra' | 'productivity' | 'browser'

interface IntegrationDef {
  id: string
  name: string
  category: string
  envVars: string[]
  vaultItem?: string
  testable?: boolean
  recommendation?: string
}

interface IntegrationProbeSnapshot {
  opAvailable: boolean
  xint: { installed: boolean; oauthConfigured: boolean; envConfigured: boolean }
  ollamaInstalled: boolean
  ollamaReachable: boolean
  gwsInstalled: boolean
}

let integrationProbeCache: { ts: number; value: IntegrationProbeSnapshot } | null = null
const INTEGRATION_PROBE_TTL_MS = 5000

const INTEGRATIONS: IntegrationDef[] = [
  // AI Providers
  { id: 'anthropic', name: 'Anthropic', category: 'ai', envVars: ['ANTHROPIC_API_KEY'], vaultItem: 'gateway-anthropic-api-key', testable: true },
  { id: 'openai', name: 'OpenAI', category: 'ai', envVars: ['OPENAI_API_KEY'], vaultItem: 'gateway-openai-api-key', testable: true },
  { id: 'openrouter', name: 'OpenRouter', category: 'ai', envVars: ['OPENROUTER_API_KEY'], vaultItem: 'gateway-openrouter-api-key', testable: true },
  { id: 'venice', name: 'Venice AI', category: 'ai', envVars: ['VENICE_API_KEY'], vaultItem: 'gateway-venice-api-key', testable: true },
  { id: 'nvidia', name: 'NVIDIA', category: 'ai', envVars: ['NVIDIA_API_KEY'], vaultItem: 'gateway-nvidia-api-key' },
  { id: 'moonshot', name: 'Moonshot / Kimi', category: 'ai', envVars: ['MOONSHOT_API_KEY'], vaultItem: 'gateway-moonshot-api-key' },
  { id: 'gemini', name: 'Google Gemini', category: 'ai', envVars: ['GEMINI_API_KEY'], vaultItem: 'gateway-gemini-api-key', testable: true },
  { id: 'deepseek', name: 'DeepSeek', category: 'ai', envVars: ['DEEPSEEK_API_KEY'], vaultItem: 'gateway-deepseek-api-key', testable: true },
  { id: 'groq', name: 'Groq', category: 'ai', envVars: ['GROQ_API_KEY'], vaultItem: 'gateway-groq-api-key', testable: true },
  { id: 'ollama', name: 'Ollama (Local)', category: 'ai', envVars: ['OLLAMA_API_KEY'], vaultItem: 'gateway-ollama-api-key' },

  // Search
  { id: 'brave', name: 'Brave Search', category: 'search', envVars: ['BRAVE_API_KEY'], vaultItem: 'gateway-brave-api-key' },

  // Social
  {
    id: 'x_twitter',
    name: 'X / Twitter',
    category: 'social',
    envVars: ['X_COOKIES_PATH'],
    recommendation: 'Recommended: use xint CLI as default (`xint auth`) instead of manual cookies path.',
  },
  { id: 'linkedin', name: 'LinkedIn', category: 'social', envVars: ['LINKEDIN_ACCESS_TOKEN'] },

  // Messaging
  { id: 'telegram', name: 'Telegram', category: 'messaging', envVars: ['TELEGRAM_BOT_TOKEN'], vaultItem: 'gateway-telegram-bot-token', testable: true },

  // Dev Tools
  { id: 'github', name: 'GitHub', category: 'devtools', envVars: ['GITHUB_TOKEN'], vaultItem: 'gateway-github-token', testable: true },

  // Productivity
  {
    id: 'google_workspace',
    name: 'Google Workspace',
    category: 'productivity',
    envVars: ['GOOGLE_WORKSPACE_CLI_CREDENTIALS_FILE'],
    testable: true,
    recommendation: 'Install: npm i -g @googleworkspace/cli — then run `gws auth login` or set a service account credentials file.',
  },

  // Security
  { id: 'onepassword', name: '1Password', category: 'security', envVars: ['OP_SERVICE_ACCOUNT_TOKEN'] },

  // Infrastructure
  { id: 'gateway', name: 'Gateway Auth', category: 'infra', envVars: ['GATEWAY_TOKEN'], vaultItem: 'gateway-token' },

  // Browser Automation
  { id: 'hyperbrowser', name: 'Hyperbrowser', category: 'browser', envVars: ['HYPERBROWSER_API_KEY'], testable: true, recommendation: 'Cloud browser automation for AI agents. Get a key at hyperbrowser.ai' },
]

const CATEGORIES: Record<string, { label: string; order: number }> = {
  ai: { label: 'AI Providers', order: 0 },
  search: { label: 'Search', order: 1 },
  social: { label: 'Social', order: 2 },
  messaging: { label: 'Messaging', order: 3 },
  devtools: { label: 'Dev Tools', order: 4 },
  security: { label: 'Security', order: 5 },
  infra: { label: 'Infrastructure', order: 6 },
  productivity: { label: 'Productivity', order: 7 },
  browser: { label: 'Browser Automation', order: 8 },
}

const BLOCKED_VARS = new Set([
  'PATH', 'HOME', 'USER', 'SHELL', 'LANG', 'TERM', 'PWD', 'LOGNAME', 'HOSTNAME',
  // Security-critical application vars that must not be overridden via integrations
  'AUTH_SECRET', 'API_KEY', 'AUTH_PASS', 'AUTH_PASS_B64', 'NODE_ENV',
  'MISSION_CONTROL_DB_PATH', 'MISSION_CONTROL_DATA_DIR', 'MC_SESSION_SECRET',
])
const BLOCKED_PREFIXES = ['LD_', 'DYLD_', 'AUTH_', 'MC_SESSION']

// ---------------------------------------------------------------------------
// DB-backed integration settings
// ---------------------------------------------------------------------------

const DB_KEY_PREFIX = 'integration.'

function readIntegrationSettings(): Map<string, string> {
  try {
    const db = getDatabase()
    const rows = db.prepare('SELECT key, value FROM settings WHERE key LIKE ?').all(DB_KEY_PREFIX + '%') as { key: string; value: string }[]
    const map = new Map<string, string>()
    for (const row of rows) {
      const envVar = row.key.slice(DB_KEY_PREFIX.length)
      if (row.value?.trim()) map.set(envVar, row.value.trim())
    }
    return map
  } catch {
    return new Map()
  }
}

function writeIntegrationSetting(envVar: string, value: string): void {
  const db = getDatabase()
  const trimmed = value.trim()
  if (trimmed) {
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .run(DB_KEY_PREFIX + envVar, trimmed)
  } else {
    db.prepare('DELETE FROM settings WHERE key = ?').run(DB_KEY_PREFIX + envVar)
  }
}

function deleteIntegrationSetting(envVar: string): void {
  const db = getDatabase()
  db.prepare('DELETE FROM settings WHERE key = ?').run(DB_KEY_PREFIX + envVar)
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function redactValue(value: string): string {
  if (value.length <= 4) return '****'
  return '****' + value.slice(-4)
}

function isVarBlocked(key: string): boolean {
  if (BLOCKED_VARS.has(key)) return true
  return BLOCKED_PREFIXES.some(p => key.startsWith(p))
}

function getEffectiveEnvValue(dbMap: Map<string, string>, key: string): string {
  const fromDb = dbMap.get(key) || ''
  if (fromDb) return fromDb
  return (process.env[key] || '').trim()
}

function isPathLikeEnvVar(key: string): boolean {
  return key.endsWith('_PATH') || key.endsWith('_FILE')
}

function isConfiguredValue(key: string, value: string): boolean {
  if (!value || value.length === 0) return false
  if (isPathLikeEnvVar(key)) {
    try { return existsSync(value) } catch { return false }
  }
  return true
}

function checkOpAuthenticated(opEnv?: NodeJS.ProcessEnv): boolean {
  try {
    execFileSync('op', ['whoami', '--format', 'json'], {
      stdio: 'pipe', timeout: 3000, env: opEnv || process.env,
    })
    return true
  } catch { return false }
}

function checkCommandAvailable(command: string): boolean {
  try {
    execFileSync('which', [command], { stdio: 'pipe', timeout: 3000 })
    return true
  } catch { return false }
}

function checkXintState(): { installed: boolean; oauthConfigured: boolean; envConfigured: boolean } {
  const installed = checkCommandAvailable('xint')
  const oauthPath = `${os.homedir()}/.xint/data/oauth-tokens.json`
  const envPath = `${os.homedir()}/.xint/.env`
  return { installed, oauthConfigured: existsSync(oauthPath), envConfigured: existsSync(envPath) }
}

function resolveOllamaBaseUrl(): string {
  const raw = String(process.env.OLLAMA_HOST || '').trim()
  if (!raw) return 'http://127.0.0.1:11434'
  if (raw.startsWith('http://') || raw.startsWith('https://')) return raw
  return `http://${raw}`
}

async function checkOllamaReachable(): Promise<boolean> {
  try {
    const base = resolveOllamaBaseUrl().replace(/\/+$/, '')
    const res = await fetch(`${base}/api/tags`, { signal: AbortSignal.timeout(1200) })
    return res.ok
  } catch { return false }
}

function checkOpAvailable(): boolean {
  try {
    execFileSync('which', ['op'], { stdio: 'pipe', timeout: 3000 })
    return true
  } catch { return false }
}

async function getIntegrationProbeSnapshot(): Promise<IntegrationProbeSnapshot> {
  const now = Date.now()
  if (integrationProbeCache && (now - integrationProbeCache.ts) < INTEGRATION_PROBE_TTL_MS) {
    return integrationProbeCache.value
  }
  const value: IntegrationProbeSnapshot = {
    opAvailable: checkOpAvailable(),
    xint: checkXintState(),
    ollamaInstalled: checkCommandAvailable('ollama'),
    ollamaReachable: await checkOllamaReachable(),
    gwsInstalled: checkCommandAvailable('gws'),
  }
  integrationProbeCache = { ts: now, value }
  return value
}

function getOpEnv(dbMap: Map<string, string>): NodeJS.ProcessEnv {
  const base: NodeJS.ProcessEnv = { ...process.env }
  if (base.OP_SERVICE_ACCOUNT_TOKEN) return base
  const fromDb = dbMap.get('OP_SERVICE_ACCOUNT_TOKEN')
  if (fromDb) { base.OP_SERVICE_ACCOUNT_TOKEN = fromDb; return base }
  return base
}

// ---------------------------------------------------------------------------
// GET /api/integrations
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const dbMap = readIntegrationSettings()
  const probe = await getIntegrationProbeSnapshot()
  const { opAvailable, xint, ollamaInstalled, ollamaReachable, gwsInstalled } = probe
  const providerSubscriptions = detectProviderSubscriptions()

  const pluginIntegrations = getPluginIntegrations()
  const allIntegrations: IntegrationDef[] = [...INTEGRATIONS]
  const pluginIntegrationMap = new Map<string, PluginIntegrationDef>()
  for (const pi of pluginIntegrations) {
    if (!allIntegrations.some(i => i.id === pi.id)) {
      allIntegrations.push({ id: pi.id, name: pi.name, category: pi.category, envVars: pi.envVars, vaultItem: pi.vaultItem, testable: pi.testable, recommendation: pi.recommendation })
    }
    pluginIntegrationMap.set(pi.id, pi)
  }

  const allCategories = { ...CATEGORIES }
  for (const pc of getPluginCategories()) {
    if (!(pc.id in allCategories)) allCategories[pc.id] = { label: pc.label, order: pc.order }
  }

  const integrations = allIntegrations.map(def => {
    const vars: Record<string, { redacted: string; set: boolean }> = {}
    let allSet = true
    let anySet = false

    for (const envVar of def.envVars) {
      const val = getEffectiveEnvValue(dbMap, envVar)
      if (isConfiguredValue(envVar, val)) {
        vars[envVar] = { redacted: redactValue(val), set: true }
        anySet = true
      } else {
        vars[envVar] = { redacted: '', set: false }
        allSet = false
      }
    }

    if (def.id === 'onepassword' && !anySet && opAvailable) {
      const opEnv = getOpEnv(dbMap)
      if (checkOpAuthenticated(opEnv)) {
        const token = dbMap.get('OP_SERVICE_ACCOUNT_TOKEN')
        vars.OP_SERVICE_ACCOUNT_TOKEN = { redacted: token ? redactValue(token) : 'op session', set: true }
        allSet = true; anySet = true
      }
    }

    if ((def.id === 'anthropic' || def.id === 'openai') && !anySet) {
      const sub = providerSubscriptions.active[def.id]
      if (sub) {
        const primaryVar = def.envVars[0]
        vars[primaryVar] = { redacted: `${sub.type} (${sub.source})`, set: true }
        allSet = true; anySet = true
      }
    }

    if (def.id === 'ollama' && !anySet) {
      const primaryVar = def.envVars[0]
      if (ollamaReachable) {
        vars[primaryVar] = { redacted: 'local daemon', set: true }; allSet = true; anySet = true
      } else if (ollamaInstalled) {
        vars[primaryVar] = { redacted: 'installed (daemon not reachable)', set: true }; allSet = false; anySet = true
      }
    }

    if (def.id === 'google_workspace' && !anySet) {
      const primaryVar = def.envVars[0]
      if (gwsInstalled) {
        vars[primaryVar] = { redacted: 'gws CLI installed (run `gws auth login`)', set: true }; allSet = false; anySet = true
      }
    }

    if (def.id === 'x_twitter' && !anySet) {
      const primaryVar = def.envVars[0]
      if (xint.oauthConfigured) {
        vars[primaryVar] = { redacted: 'xint oauth', set: true }; allSet = true; anySet = true
      } else if (xint.installed || xint.envConfigured) {
        vars[primaryVar] = { redacted: 'xint installed (run `xint auth`)', set: true }; allSet = false; anySet = true
      }
    }

    const status = allSet && anySet ? 'connected' : anySet ? 'partial' : 'not_configured'

    return {
      id: def.id,
      name: def.name,
      category: def.category,
      categoryLabel: allCategories[def.category]?.label ?? def.category,
      envVars: vars,
      status,
      vaultItem: def.vaultItem ?? null,
      testable: def.testable ?? false,
      recommendation: def.recommendation ?? null,
    }
  })

  return NextResponse.json({
    integrations,
    categories: Object.entries(allCategories)
      .sort(([, a], [, b]) => a.order - b.order)
      .map(([id, meta]) => ({ id, label: meta.label })),
    opAvailable,
    envPath: null,
  })
}

// ---------------------------------------------------------------------------
// PUT /api/integrations — save env vars to DB
// ---------------------------------------------------------------------------

export async function PUT(request: NextRequest) {
  const auth = requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const body = await request.json().catch(() => null)
  if (!body?.vars || typeof body.vars !== 'object') {
    return NextResponse.json({ error: 'vars object required' }, { status: 400 })
  }

  for (const key of Object.keys(body.vars)) {
    if (isVarBlocked(key)) return NextResponse.json({ error: `Cannot set protected variable: ${key}` }, { status: 403 })
    if (!/^[A-Z_][A-Z0-9_]*$/i.test(key)) return NextResponse.json({ error: `Invalid variable name: ${key}` }, { status: 400 })
  }

  const updatedKeys: string[] = []
  for (const [key, value] of Object.entries(body.vars)) {
    writeIntegrationSetting(key, String(value))
    updatedKeys.push(key)
  }

  const ipAddress = extractClientIp(request)
  logAuditEvent({
    action: 'integrations_update',
    actor: auth.user.username,
    actor_id: auth.user.id,
    detail: { updated_keys: updatedKeys },
    ip_address: ipAddress,
  })

  return NextResponse.json({ updated: updatedKeys, count: updatedKeys.length })
}

// ---------------------------------------------------------------------------
// DELETE /api/integrations — remove env vars from DB
// ---------------------------------------------------------------------------

export async function DELETE(request: NextRequest) {
  const auth = requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  // Keys can come from URL query (?keys=A,B) or request body ({ keys: [...] })
  let keysParam: string | null = request.nextUrl.searchParams.get('keys')
  if (!keysParam) {
    try {
      const body = await request.json()
      keysParam = Array.isArray(body.keys) ? body.keys.join(',') : (body.keys ?? null)
    } catch { /* body not provided */ }
  }
  if (!keysParam) return NextResponse.json({ error: 'keys parameter required' }, { status: 400 })

  const keysToRemove = new Set<string>(keysParam.split(',').map((k: string) => k.trim()).filter(Boolean))
  if (keysToRemove.size === 0) return NextResponse.json({ error: 'At least one key required' }, { status: 400 })

  for (const key of keysToRemove) {
    if (isVarBlocked(key)) return NextResponse.json({ error: `Cannot remove protected variable: ${key}` }, { status: 403 })
  }

  const removed: string[] = []
  for (const key of keysToRemove) {
    deleteIntegrationSetting(key)
    removed.push(key)
  }

  const ipAddress = extractClientIp(request)
  logAuditEvent({
    action: 'integrations_remove',
    actor: auth.user.username,
    actor_id: auth.user.id,
    detail: { removed_keys: removed },
    ip_address: ipAddress,
  })

  return NextResponse.json({ removed, count: removed.length })
}

// ---------------------------------------------------------------------------
// POST /api/integrations — action dispatcher (test, pull)
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const rateCheck = mutationLimiter(request)
  if (rateCheck) return rateCheck

  const result = await validateBody(request, integrationActionSchema)
  if ('error' in result) return result.error
  const body = result.data

  if (body.action === 'pull-all') return handlePullAll(request, auth.user, body.category)

  if (!body.integrationId) return NextResponse.json({ error: 'integrationId required' }, { status: 400 })

  let integration: IntegrationDef | undefined = INTEGRATIONS.find(i => i.id === body.integrationId)
  if (!integration) {
    const pi = getPluginIntegrations().find(i => i.id === body.integrationId)
    if (pi) integration = { id: pi.id, name: pi.name, category: pi.category, envVars: pi.envVars, vaultItem: pi.vaultItem, testable: pi.testable, recommendation: pi.recommendation }
  }
  if (!integration) return NextResponse.json({ error: `Unknown integration: ${body.integrationId}` }, { status: 404 })

  if (body.action === 'test') return handleTest(integration, request, auth.user)
  if (body.action === 'pull') return handlePull(integration, request, auth.user)

  return NextResponse.json({ error: `Unknown action: ${body.action}` }, { status: 400 })
}

// ---------------------------------------------------------------------------
// Test connection
// ---------------------------------------------------------------------------

async function handleTest(
  integration: IntegrationDef,
  request: NextRequest,
  user: { username: string; id: number }
) {
  if (!integration.testable) return NextResponse.json({ error: 'This integration does not support testing' }, { status: 400 })

  const dbMap = readIntegrationSettings()

  try {
    let result: { ok: boolean; detail: string }
    const providerSubscriptions = detectProviderSubscriptions()

    switch (integration.id) {
      case 'telegram': {
        const token = getEffectiveEnvValue(dbMap, integration.envVars[0])
        if (!token) return NextResponse.json({ ok: false, detail: 'Token not set' })
        const res = await fetch(`https://api.telegram.org/bot${token}/getMe`, { signal: AbortSignal.timeout(5000) })
        const data = await res.json()
        result = data.ok ? { ok: true, detail: `Bot: @${data.result.username}` } : { ok: false, detail: data.description || 'Failed' }
        break
      }
      case 'github': {
        const token = getEffectiveEnvValue(dbMap, 'GITHUB_TOKEN')
        if (!token) return NextResponse.json({ ok: false, detail: 'Token not set' })
        const res = await fetch('https://api.github.com/user', {
          headers: { Authorization: `Bearer ${token}`, 'User-Agent': 'MissionControl/1.0' },
          signal: AbortSignal.timeout(5000),
        })
        result = res.ok ? { ok: true, detail: `User: ${(await res.json()).login}` } : { ok: false, detail: `HTTP ${res.status}` }
        break
      }
      case 'anthropic': {
        const key = getEffectiveEnvValue(dbMap, 'ANTHROPIC_API_KEY')
        if (!key) {
          const sub = providerSubscriptions.active.anthropic
          if (sub) return NextResponse.json({ ok: true, detail: `OAuth/subscription detected: ${sub.type}` })
          return NextResponse.json({ ok: false, detail: 'API key not set' })
        }
        const res = await fetch('https://api.anthropic.com/v1/models', {
          method: 'GET',
          headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
          signal: AbortSignal.timeout(5000),
        })
        result = res.ok ? { ok: true, detail: 'API key valid' } : { ok: false, detail: `HTTP ${res.status}` }
        break
      }
      case 'openai': {
        const key = getEffectiveEnvValue(dbMap, 'OPENAI_API_KEY')
        if (!key) {
          const sub = providerSubscriptions.active.openai
          if (sub) return NextResponse.json({ ok: true, detail: `OAuth/subscription detected: ${sub.type}` })
          return NextResponse.json({ ok: false, detail: 'API key not set' })
        }
        const res = await fetch('https://api.openai.com/v1/models', {
          headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(5000),
        })
        result = res.ok ? { ok: true, detail: 'API key valid' } : { ok: false, detail: `HTTP ${res.status}` }
        break
      }
      case 'openrouter': {
        const key = getEffectiveEnvValue(dbMap, 'OPENROUTER_API_KEY')
        if (!key) return NextResponse.json({ ok: false, detail: 'API key not set' })
        const res = await fetch('https://openrouter.ai/api/v1/models', {
          headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(5000),
        })
        result = res.ok ? { ok: true, detail: 'API key valid' } : { ok: false, detail: `HTTP ${res.status}` }
        break
      }
      case 'gemini': {
        const key = getEffectiveEnvValue(dbMap, 'GEMINI_API_KEY')
        if (!key) return NextResponse.json({ ok: false, detail: 'API key not set' })
        const res = await fetch('https://generativelanguage.googleapis.com/v1beta/models', {
          headers: { 'x-goog-api-key': key },
          signal: AbortSignal.timeout(5000),
        })
        result = res.ok ? { ok: true, detail: 'API key valid' } : { ok: false, detail: `HTTP ${res.status}` }
        break
      }
      case 'venice': {
        const key = getEffectiveEnvValue(dbMap, 'VENICE_API_KEY')
        if (!key) return NextResponse.json({ ok: false, detail: 'API key not set' })
        const res = await fetch('https://api.venice.ai/api/v1/models', {
          headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(5000),
        })
        result = res.ok ? { ok: true, detail: 'API key valid' } : { ok: false, detail: `HTTP ${res.status}` }
        break
      }
      case 'deepseek': {
        const key = getEffectiveEnvValue(dbMap, 'DEEPSEEK_API_KEY')
        if (!key) return NextResponse.json({ ok: false, detail: 'API key not set' })
        const res = await fetch('https://api.deepseek.com/models', {
          headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(5000),
        })
        result = res.ok ? { ok: true, detail: 'API key valid' } : { ok: false, detail: `HTTP ${res.status}` }
        break
      }
      case 'groq': {
        const key = getEffectiveEnvValue(dbMap, 'GROQ_API_KEY')
        if (!key) return NextResponse.json({ ok: false, detail: 'API key not set' })
        const res = await fetch('https://api.groq.com/openai/v1/models', {
          headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(5000),
        })
        result = res.ok ? { ok: true, detail: 'API key valid' } : { ok: false, detail: `HTTP ${res.status}` }
        break
      }
      case 'hyperbrowser': {
        const key = getEffectiveEnvValue(dbMap, 'HYPERBROWSER_API_KEY')
        if (!key) return NextResponse.json({ ok: false, detail: 'API key not set' })
        const res = await fetch('https://app.hyperbrowser.ai/api/v2/sessions', {
          headers: { 'x-api-key': key }, signal: AbortSignal.timeout(5000),
        })
        result = res.ok ? { ok: true, detail: 'API key valid' } : { ok: false, detail: `HTTP ${res.status}` }
        break
      }
      case 'google_workspace': {
        const credsFile = getEffectiveEnvValue(dbMap, 'GOOGLE_WORKSPACE_CLI_CREDENTIALS_FILE')
        const gwsAvail = checkCommandAvailable('gws')
        if (!gwsAvail) { result = { ok: false, detail: 'gws CLI not installed — run: npm i -g @googleworkspace/cli' }; break }
        try {
          const env: NodeJS.ProcessEnv = { ...process.env }
          if (credsFile) env.GOOGLE_WORKSPACE_CLI_CREDENTIALS_FILE = credsFile
          execFileSync('gws', ['auth', 'status'], { timeout: 10000, stdio: ['pipe', 'pipe', 'pipe'], env })
          result = { ok: true, detail: 'Authenticated' }
        } catch (err: any) {
          result = { ok: false, detail: (err.stderr?.toString() || '').slice(0, 120) || 'Not authenticated — run `gws auth login`' }
        }
        break
      }
      default: {
        const pluginDef = getPluginIntegrations().find(pi => pi.id === integration.id)
        if (pluginDef?.testHandler) { result = await pluginDef.testHandler(dbMap); break }
        const baseUrls: Record<string, string> = {
          nvidia: 'https://api.nvidia.com',
          moonshot: 'https://api.moonshot.cn',
          brave: 'https://api.search.brave.com',
          linkedin: 'https://api.linkedin.com',
          ollama: resolveOllamaBaseUrl(),
          gateway: String(process.env.GATEWAY_URL || '').trim() || '',
        }
        const url = baseUrls[integration.id]
        if (url) {
          const res = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(5000) })
          result = res.ok || res.status < 500
            ? { ok: true, detail: `Reachable (HTTP ${res.status})` }
            : { ok: false, detail: `Unreachable (HTTP ${res.status})` }
        } else {
          return NextResponse.json({ ok: false, detail: 'No test available' })
        }
        break
      }
    }

    const ipAddress = extractClientIp(request)
    logAuditEvent({
      action: 'integration_test',
      actor: user.username,
      actor_id: user.id,
      detail: { integration: integration.id, result: result.ok ? 'success' : 'failed' },
      ip_address: ipAddress,
    })

    return NextResponse.json(result)
  } catch (err: any) {
    return NextResponse.json({ ok: false, detail: err.message || 'Connection failed' })
  }
}

// ---------------------------------------------------------------------------
// Pull from 1Password — stores value to DB
// ---------------------------------------------------------------------------

async function handlePull(
  integration: IntegrationDef,
  request: NextRequest,
  user: { username: string; id: number }
) {
  if (!integration.vaultItem) return NextResponse.json({ error: 'No vault item configured' }, { status: 400 })
  if (!checkOpAvailable()) return NextResponse.json({ error: '1Password CLI (op) is not installed' }, { status: 400 })

  const dbMap = readIntegrationSettings()
  const opEnv = getOpEnv(dbMap)
  if (!opEnv.OP_SERVICE_ACCOUNT_TOKEN) return NextResponse.json({ error: 'OP_SERVICE_ACCOUNT_TOKEN not configured' }, { status: 400 })

  try {
    const secret = execFileSync('op', [
      'item', 'get', integration.vaultItem,
      '--vault', process.env.OP_VAULT_NAME || 'default',
      '--fields', 'password',
      '--format', 'json',
    ], { timeout: 15000, stdio: ['pipe', 'pipe', 'pipe'], env: opEnv }).toString().trim()

    let value: string
    try { const parsed = JSON.parse(secret); value = parsed.value || parsed } catch { value = secret }

    if (!value?.length) return NextResponse.json({ error: 'Empty value from 1Password' }, { status: 400 })

    const envVar = integration.envVars[0]
    writeIntegrationSetting(envVar, value)

    const ipAddress = extractClientIp(request)
    logAuditEvent({
      action: 'integration_pull_1password',
      actor: user.username, actor_id: user.id,
      detail: { integration: integration.id, env_var: envVar },
      ip_address: ipAddress,
    })

    return NextResponse.json({ ok: true, detail: `Pulled ${envVar} from 1Password`, redacted: redactValue(value) })
  } catch (err: any) {
    return NextResponse.json({ error: `1Password pull failed: ${err.message}` }, { status: 500 })
  }
}

// ---------------------------------------------------------------------------
// Pull ALL vault-backed integrations from 1Password
// ---------------------------------------------------------------------------

async function handlePullAll(
  request: NextRequest,
  user: { username: string; id: number },
  category?: string,
) {
  if (!checkOpAvailable()) return NextResponse.json({ error: '1Password CLI (op) is not installed' }, { status: 400 })

  const dbMap = readIntegrationSettings()
  const opEnv = getOpEnv(dbMap)
  if (!opEnv.OP_SERVICE_ACCOUNT_TOKEN) return NextResponse.json({ error: 'OP_SERVICE_ACCOUNT_TOKEN not configured' }, { status: 400 })

  const targets = INTEGRATIONS.filter(i => i.vaultItem && (!category || i.category === category))
  if (targets.length === 0) return NextResponse.json({ error: 'No vault-backed integrations found' }, { status: 400 })

  const results: { id: string; envVar: string; ok: boolean; detail: string }[] = []

  for (const integration of targets) {
    const envVar = integration.envVars[0]
    try {
      const secret = execFileSync('op', [
        'item', 'get', integration.vaultItem!,
        '--vault', process.env.OP_VAULT_NAME || 'default',
        '--fields', 'password',
        '--format', 'json',
      ], { timeout: 15000, stdio: ['pipe', 'pipe', 'pipe'], env: opEnv }).toString().trim()

      let value: string
      try { const parsed = JSON.parse(secret); value = parsed.value || parsed } catch { value = secret }

      if (!value?.length) { results.push({ id: integration.id, envVar, ok: false, detail: 'Empty value' }); continue }

      writeIntegrationSetting(envVar, value)
      results.push({ id: integration.id, envVar, ok: true, detail: `Pulled ${envVar}` })
    } catch (err: any) {
      results.push({ id: integration.id, envVar, ok: false, detail: err.message || 'Failed' })
    }
  }

  const successCount = results.filter(r => r.ok).length
  const ipAddress = extractClientIp(request)
  logAuditEvent({
    action: 'integration_pull_all_1password',
    actor: user.username, actor_id: user.id,
    detail: { category: category ?? 'all', success: successCount, failed: results.length - successCount },
    ip_address: ipAddress,
  })

  return NextResponse.json({ ok: successCount > 0, detail: `Pulled ${successCount}/${results.length} integrations`, results })
}
