import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/** Clamp a number to [min, max], falling back to `fallback` if NaN. */
function clampInt(value: number, min: number, max: number, fallback: number): number {
  if (isNaN(value)) return fallback
  return Math.max(min, Math.min(max, Math.floor(value)))
}

const isBuildPhase = process.env.NEXT_PHASE === 'phase-production-build'
const defaultDataDir = path.join(process.cwd(), '.data')
const configuredDataDir = process.env.MISSION_CONTROL_DATA_DIR || defaultDataDir
const buildScratchRoot =
  process.env.MISSION_CONTROL_BUILD_DATA_DIR ||
  path.join(os.tmpdir(), 'mission-control-build')
const resolvedDataDir = isBuildPhase
  ? path.join(buildScratchRoot, `worker-${process.pid}`)
  : configuredDataDir
const resolvedDbPath = isBuildPhase
  ? (process.env.MISSION_CONTROL_BUILD_DB_PATH ||
      path.join(resolvedDataDir, 'mission-control.db'))
  : (process.env.MISSION_CONTROL_DB_PATH ||
      path.join(resolvedDataDir, 'mission-control.db'))
const resolvedTokensPath = isBuildPhase
  ? (process.env.MISSION_CONTROL_BUILD_TOKENS_PATH ||
      path.join(resolvedDataDir, 'mission-control-tokens.json'))
  : (process.env.MISSION_CONTROL_TOKENS_PATH ||
      path.join(resolvedDataDir, 'mission-control-tokens.json'))
const defaultMemoryDir = path.join(defaultDataDir, 'memory')

const resolvedGnapRepoPath =
  process.env.GNAP_REPO_PATH || path.join(configuredDataDir, '.gnap')

export const config = {
  claudeHome:
    process.env.MC_CLAUDE_HOME ||
    path.join(os.homedir(), '.claude'),
  dataDir: resolvedDataDir,
  dbPath: resolvedDbPath,
  tokensPath: resolvedTokensPath,
  gatewayHost: process.env.GATEWAY_HOST || '127.0.0.1',
  gatewayPort: clampInt(Number(process.env.GATEWAY_PORT || '18789'), 1, 65535, 18789),
  logsDir: process.env.MC_LOG_DIR || '',
  memoryDir: defaultMemoryDir,
  memoryAllowedPrefixes: [] as string[],
  homeDir: os.homedir(),
  gnap: {
    enabled: process.env.GNAP_ENABLED === 'true',
    repoPath: resolvedGnapRepoPath,
    autoSync: process.env.GNAP_AUTO_SYNC !== 'false',
    remoteUrl: process.env.GNAP_REMOTE_URL || '',
  },
  // Data retention (days). 0 = keep forever. Negative values are clamped to 0.
  retention: {
    activities: clampInt(Number(process.env.MC_RETAIN_ACTIVITIES_DAYS || '90'), 0, 3650, 90),
    auditLog: clampInt(Number(process.env.MC_RETAIN_AUDIT_DAYS || '365'), 0, 3650, 365),
    logs: clampInt(Number(process.env.MC_RETAIN_LOGS_DAYS || '30'), 0, 3650, 30),
    notifications: clampInt(Number(process.env.MC_RETAIN_NOTIFICATIONS_DAYS || '60'), 0, 3650, 60),
    pipelineRuns: clampInt(Number(process.env.MC_RETAIN_PIPELINE_RUNS_DAYS || '90'), 0, 3650, 90),
    tokenUsage: clampInt(Number(process.env.MC_RETAIN_TOKEN_USAGE_DAYS || '90'), 0, 3650, 90),
    gatewaySessions: clampInt(Number(process.env.MC_RETAIN_GATEWAY_SESSIONS_DAYS || '90'), 0, 3650, 90),
  },
}

export function ensureDirExists(dirPath: string) {
  if (!dirPath) return
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true })
  }
}
