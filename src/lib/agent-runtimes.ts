import crypto from 'node:crypto'
import { logger } from './logger'
import { config } from './config'

export type RuntimeId = 'claude'
export type DeploymentMode = 'local' | 'docker'

export interface RuntimeStatus {
  id: RuntimeId
  name: string
  description: string
  installed: boolean
  version: string | null
  running: boolean
  authRequired: boolean
  authHint: string
  authenticated: boolean
}

export interface InstallJob {
  id: string
  runtime: RuntimeId
  mode: DeploymentMode
  status: 'pending' | 'running' | 'success' | 'failed'
  output: string
  error: string | null
  startedAt: number
  finishedAt: number | null
}

export interface RuntimeMeta {
  name: string
  description: string
  authRequired: boolean
  authHint: string
}

const RUNTIME_META: Record<RuntimeId, RuntimeMeta> = {
  claude: {
    name: 'Claude API',
    description: 'Internalized Anthropic API runtime. No external binary required.',
    authRequired: true,
    authHint: 'Set ANTHROPIC_API_KEY in your environment to enable task dispatch.',
  },
}

export function getRuntimeMeta(id: RuntimeId): RuntimeMeta | undefined {
  return RUNTIME_META[id]
}

// ---------------------------------------------------------------------------
// In-memory job store — ephemeral, not persisted across restarts
// ---------------------------------------------------------------------------

const installJobs = new Map<string, InstallJob>()

function pruneJobs() {
  const cutoff = Date.now() - 3600_000
  for (const [id, job] of installJobs) {
    if (job.finishedAt && job.finishedAt < cutoff) installJobs.delete(id)
  }
}

// ---------------------------------------------------------------------------
// Detection — internalized: checks ANTHROPIC_API_KEY, no binary needed
// ---------------------------------------------------------------------------

function detectClaude(): RuntimeStatus {
  const meta = RUNTIME_META.claude
  const apiKey = (process.env.ANTHROPIC_API_KEY || '').trim()
  const authenticated = apiKey.length > 0
  return {
    id: 'claude',
    ...meta,
    installed: true, // always available — internalized API runtime
    version: null,
    running: false,
    authenticated,
  }
}

const DETECTORS: Record<RuntimeId, () => RuntimeStatus> = {
  claude: detectClaude,
}

export function detectRuntime(id: RuntimeId): RuntimeStatus {
  const detector = DETECTORS[id]
  return detector
    ? detector()
    : { id, name: id, description: '', installed: false, version: null, running: false, authRequired: false, authHint: '', authenticated: false }
}

export function detectAllRuntimes(): RuntimeStatus[] {
  return Object.values(DETECTORS).map(fn => fn())
}

// ---------------------------------------------------------------------------
// Installation — no-op for internalized runtime; docker mode returns sidecar
// ---------------------------------------------------------------------------

export function startInstall(runtime: RuntimeId, mode: DeploymentMode): InstallJob {
  pruneJobs()

  const job: InstallJob = {
    id: crypto.randomUUID(),
    runtime,
    mode,
    status: 'running',
    output: '',
    error: null,
    startedAt: Date.now(),
    finishedAt: null,
  }

  installJobs.set(job.id, job)

  if (mode === 'docker') {
    job.output = generateDockerSidecar(runtime)
    job.status = 'success'
    job.finishedAt = Date.now()
    return job
  }

  // Internalized runtime — no external install needed
  job.output = '> Claude API runtime is built-in. Set ANTHROPIC_API_KEY to authenticate.\n'
  job.output += '> No external binary installation required.\n'
  job.status = 'success'
  job.finishedAt = Date.now()

  return job
}

export function getInstallJob(id: string): InstallJob | null {
  return installJobs.get(id) ?? null
}

export function getActiveJobs(): InstallJob[] {
  pruneJobs()
  return [...installJobs.values()]
}

// ---------------------------------------------------------------------------
// Docker sidecar templates
// ---------------------------------------------------------------------------

export function generateDockerSidecar(_runtime: RuntimeId): string {
  return ''
}
