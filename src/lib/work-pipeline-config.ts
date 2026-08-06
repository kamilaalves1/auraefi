import { dbGet, dbRun } from '@/lib/db-pool'
import { decryptWorkPipelineBlob, encryptWorkPipelineBlob } from '@/lib/work-pipeline-crypto'
import type {
  WorkPipelineConfigJson,
  WorkPipelineProvider,
  WorkPipelineSecrets,
} from '@/lib/work-pipeline-types'
import { fetchAzureBacklog } from '@/lib/work-pipeline-azure'
import { fetchJiraBacklog } from '@/lib/work-pipeline-jira'
import type { NormalizedBacklogItem } from '@/lib/work-pipeline-types'

function safeParseConfig(raw: string | null | undefined): WorkPipelineConfigJson {
  if (!raw) return {}
  try {
    const o = JSON.parse(raw) as WorkPipelineConfigJson
    return o && typeof o === 'object' ? o : {}
  } catch {
    return {}
  }
}

function parseSecretsJson(raw: string): WorkPipelineSecrets {
  try {
    const o = JSON.parse(raw) as WorkPipelineSecrets
    return o && typeof o === 'object' ? o : {}
  } catch {
    return {}
  }
}

export function decryptPipelineSecrets(blob: string | null | undefined): WorkPipelineSecrets {
  if (!blob) return {}
  try {
    return parseSecretsJson(decryptWorkPipelineBlob(blob))
  } catch {
    return {}
  }
}

function mergeSecrets(
  provider: WorkPipelineProvider,
  prev: WorkPipelineSecrets,
  input: Partial<WorkPipelineSecrets> | undefined
): WorkPipelineSecrets {
  if (provider === 'jira') {
    return {
      jiraApiToken: (input?.jiraApiToken ?? prev.jiraApiToken ?? '').trim(),
    }
  }
  if (provider === 'azure_devops') {
    return {
      azurePat: (input?.azurePat ?? prev.azurePat ?? '').trim(),
    }
  }
  return {}
}

function secretsNonEmpty(
  provider: WorkPipelineProvider,
  s: WorkPipelineSecrets,
  cfg: WorkPipelineConfigJson
): boolean {
  if (provider === 'jira') {
    const email = (cfg.jiraAccountEmail || s.jiraEmail || '').trim()
    return Boolean(email && s.jiraApiToken)
  }
  if (provider === 'azure_devops') {
    return Boolean(s.azurePat)
  }
  return false
}

export interface WorkPipelineRow {
  provider: WorkPipelineProvider
  enabled: number
  config: WorkPipelineConfigJson
  secret_blob: string | null
}

export async function getWorkPipelineRow(
  workspaceId: number
): Promise<WorkPipelineRow | null> {
  const row = await dbGet<{
    provider: string
    enabled: number
    config_json: string
    secret_blob: string | null
  }>(`SELECT provider, enabled, config_json, secret_blob FROM work_pipeline_configs WHERE workspace_id = ?`, [workspaceId])

  if (!row) return null

  const provider = (['none', 'jira', 'azure_devops'].includes(row.provider)
    ? row.provider
    : 'none') as WorkPipelineProvider

  return {
    provider,
    enabled: row.enabled ? 1 : 0,
    config: safeParseConfig(row.config_json),
    secret_blob: row.secret_blob,
  }
}

export async function upsertWorkPipeline(
  workspaceId: number,
  params: {
    provider: WorkPipelineProvider
    enabled: boolean
    config: WorkPipelineConfigJson
    secretsPatch?: Partial<WorkPipelineSecrets>
  }
): Promise<void> {
  const prevRow = await getWorkPipelineRow(workspaceId)
  const prevSecrets = prevRow?.secret_blob ? decryptPipelineSecrets(prevRow.secret_blob) : {}
  const merged = mergeSecrets(params.provider, prevSecrets, params.secretsPatch)

  let secretBlob: string | null = null
  if (params.provider === 'none') {
    secretBlob = null
  } else if (secretsNonEmpty(params.provider, merged, params.config)) {
    secretBlob = encryptWorkPipelineBlob(JSON.stringify(merged))
  } else {
    secretBlob = null
  }

  const configJson = JSON.stringify(params.config ?? {})

  await dbRun(`
    INSERT INTO work_pipeline_configs (workspace_id, provider, enabled, config_json, secret_blob, updated_at)
    VALUES (?, ?, ?, ?, ?, UNIX_TIMESTAMP())
    ON DUPLICATE KEY UPDATE
      provider = VALUES(provider),
      enabled = VALUES(enabled),
      config_json = VALUES(config_json),
      secret_blob = VALUES(secret_blob),
      updated_at = UNIX_TIMESTAMP()
  `, [workspaceId, params.provider, params.enabled ? 1 : 0, configJson, secretBlob])
}

/** Public view for admin UI — never includes raw secrets. */
export function toPublicPipelineDto(row: WorkPipelineRow | null): {
  provider: WorkPipelineProvider
  enabled: boolean
  config: WorkPipelineConfigJson
  hasCredentials: boolean
} {
  if (!row) {
    return { provider: 'none', enabled: false, config: {}, hasCredentials: false }
  }
  const hasCredentials = Boolean(row.secret_blob && row.provider !== 'none')
  return {
    provider: row.provider,
    enabled: row.enabled === 1,
    config: row.config,
    hasCredentials,
  }
}

export async function loadBacklogForWorkspace(
  workspaceId: number,
  limit = 50
): Promise<{ provider: WorkPipelineProvider; items: NormalizedBacklogItem[] }> {
  const row = await getWorkPipelineRow(workspaceId)
  if (!row || !row.enabled || row.provider === 'none') {
    return { provider: row?.provider ?? 'none', items: [] }
  }

  const secrets = decryptPipelineSecrets(row.secret_blob)
  if (!secretsNonEmpty(row.provider, secrets, row.config)) {
    return { provider: row.provider, items: [] }
  }

  if (row.provider === 'jira') {
    const items = await fetchJiraBacklog(row.config, secrets, limit)
    return { provider: 'jira', items }
  }

  const items = await fetchAzureBacklog(row.config, secrets, limit)
  return { provider: 'azure_devops', items }
}
