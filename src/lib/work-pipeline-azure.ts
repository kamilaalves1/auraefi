import type { NormalizedBacklogItem, WorkPipelineConfigJson, WorkPipelineSecrets } from '@/lib/work-pipeline-types'

function stripTrailingSlash(u: string): string {
  return u.replace(/\/+$/, '')
}

/** Resolve Azure DevOps API base URL and organization name. */
export function parseAzureOrgUrl(input: string): { apiBase: string; org: string } {
  const raw = stripTrailingSlash(input.trim())
  const u = new URL(raw)
  const host = u.hostname.toLowerCase()

  if (host === 'dev.azure.com') {
    const parts = u.pathname.split('/').filter(Boolean)
    const org = parts[0] || ''
    if (!org) throw new Error('URL must include the organization, e.g. https://dev.azure.com/myorg')
    return { apiBase: `https://dev.azure.com/${org}`, org }
  }

  if (host.endsWith('.visualstudio.com')) {
    const org = host.replace('.visualstudio.com', '')
    if (!org) throw new Error('Invalid visualstudio.com URL')
    return { apiBase: `https://${host}`, org }
  }

  throw new Error('Use https://dev.azure.com/yourorg or https://yourorg.visualstudio.com')
}

function azureAuthHeader(pat: string): string {
  const token = pat.trim()
  const b64 = Buffer.from(`:${token}`).toString('base64')
  return `Basic ${b64}`
}

export async function fetchAzureBacklog(
  cfg: WorkPipelineConfigJson,
  secrets: WorkPipelineSecrets,
  top = 50
): Promise<NormalizedBacklogItem[]> {
  const project = (cfg.azureProject || '').trim()
  const pat = (secrets.azurePat || '').trim()
  const orgUrl = (cfg.azureOrganizationUrl || '').trim()
  if (!project || !pat || !orgUrl) {
    throw new Error('Azure DevOps: set organization URL, project name, and PAT')
  }

  const { apiBase } = parseAzureOrgUrl(orgUrl)
  const auth = azureAuthHeader(pat)
  const wiqlUrl = `${apiBase}/${encodeURIComponent(project)}/_apis/wit/wiql?api-version=7.1`

  const wiqlBody = {
    query: `SELECT [System.Id], [System.Title], [System.State], [System.WorkItemType] FROM WorkItems WHERE [System.TeamProject] = @project AND [System.State] <> 'Closed' AND [System.State] <> 'Done' AND [System.State] <> 'Removed' ORDER BY [System.ChangedDate] DESC`.replace(
      '@project',
      `'${project.replace(/'/g, "''")}'`
    ),
  }

  const wiqlRes = await fetch(wiqlUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: auth,
    },
    body: JSON.stringify(wiqlBody),
  })

  if (!wiqlRes.ok) {
    const t = await wiqlRes.text().catch(() => '')
    throw new Error(`Azure WIQL ${wiqlRes.status}: ${t.slice(0, 400)}`)
  }

  const wiqlJson = (await wiqlRes.json()) as {
    workItems?: Array<{ id: number; url: string }>
  }
  const ids = (wiqlJson.workItems || []).slice(0, top).map((w) => w.id)
  if (ids.length === 0) return []

  const idsParam = ids.join(',')
  const detailUrl = `${apiBase}/${encodeURIComponent(project)}/_apis/wit/workitems?ids=${idsParam}&api-version=7.1&$expand=all`

  const detailRes = await fetch(detailUrl, { headers: { Authorization: auth } })
  if (!detailRes.ok) {
    const t = await detailRes.text().catch(() => '')
    throw new Error(`Azure work items ${detailRes.status}: ${t.slice(0, 400)}`)
  }

  const detailJson = (await detailRes.json()) as {
    value?: Array<Record<string, unknown>>
  }
  const value = detailJson.value || []

  return value.map((wi) => {
    const fields = (wi.fields || {}) as Record<string, unknown>
    const id = wi.id != null ? String(wi.id) : ''
    const title = String(fields['System.Title'] ?? '')
    const state = String(fields['System.State'] ?? '')
    const wit = String(fields['System.WorkItemType'] ?? 'Work Item')
    const desc = String(fields['System.Description'] ?? '')
    const htmlUrl =
      (wi._links as { html?: { href?: string } } | undefined)?.html?.href ||
      `${apiBase}/${encodeURIComponent(project)}/_workitems/edit/${id}`

    return {
      externalId: id,
      title,
      description: desc,
      state,
      type: wit,
      url: htmlUrl,
      raw: wi as Record<string, unknown>,
    }
  })
}

export async function testAzureConnection(
  cfg: WorkPipelineConfigJson,
  secrets: WorkPipelineSecrets
): Promise<{ ok: true; issueCount: number }> {
  const items = await fetchAzureBacklog(cfg, secrets, 5)
  return { ok: true, issueCount: items.length }
}

function buildAzureCtx(
  cfg: WorkPipelineConfigJson,
  secrets: WorkPipelineSecrets
): { apiBase: string; project: string; auth: string } {
  const orgUrl = (cfg.azureOrganizationUrl || '').trim()
  const project = (cfg.azureProject || '').trim()
  const pat = (secrets.azurePat || '').trim()
  if (!orgUrl || !project || !pat) throw new Error('Azure DevOps: set organization URL, project name, and PAT')
  const { apiBase } = parseAzureOrgUrl(orgUrl)
  return { apiBase, project, auth: azureAuthHeader(pat) }
}

/** Fetch work items currently in a specific state. */
export async function fetchAzureWorkItemsByState(
  cfg: WorkPipelineConfigJson,
  secrets: WorkPipelineSecrets,
  stateName: string,
  top = 50
): Promise<NormalizedBacklogItem[]> {
  const { apiBase, project, auth } = buildAzureCtx(cfg, secrets)
  const wiqlUrl = `${apiBase}/${encodeURIComponent(project)}/_apis/wit/wiql?api-version=7.1`

  const query = `SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = '${project.replace(/'/g, "''")}' AND [System.State] = '${stateName.replace(/'/g, "''")}' ORDER BY [System.ChangedDate] DESC`
  const wiqlRes = await fetch(wiqlUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: auth },
    body: JSON.stringify({ query }),
  })
  if (!wiqlRes.ok) throw new Error(`Azure WIQL ${wiqlRes.status}: ${(await wiqlRes.text().catch(() => '')).slice(0, 400)}`)

  const wiqlJson = (await wiqlRes.json()) as { workItems?: Array<{ id: number }> }
  const ids = (wiqlJson.workItems || []).slice(0, top).map((w) => w.id)
  if (ids.length === 0) return []

  const detailUrl = `${apiBase}/${encodeURIComponent(project)}/_apis/wit/workitems?ids=${ids.join(',')}&api-version=7.1&$expand=all`
  const detailRes = await fetch(detailUrl, { headers: { Authorization: auth } })
  if (!detailRes.ok) throw new Error(`Azure work items ${detailRes.status}`)

  const detailJson = (await detailRes.json()) as { value?: Array<Record<string, unknown>> }
  return (detailJson.value || []).map((wi) => {
    const fields = (wi.fields || {}) as Record<string, unknown>
    const id = wi.id != null ? String(wi.id) : ''
    return {
      externalId: id,
      title: String(fields['System.Title'] ?? ''),
      description: String(fields['System.Description'] ?? ''),
      state: String(fields['System.State'] ?? ''),
      type: String(fields['System.WorkItemType'] ?? 'Work Item'),
      url: (wi._links as { html?: { href?: string } } | undefined)?.html?.href || `${apiBase}/${encodeURIComponent(project)}/_workitems/edit/${id}`,
      raw: wi as Record<string, unknown>,
    }
  })
}

/** Post a comment to an Azure DevOps work item. */
export async function postAzureComment(
  cfg: WorkPipelineConfigJson,
  secrets: WorkPipelineSecrets,
  workItemId: string,
  body: string
): Promise<{ commentId: string }> {
  const { apiBase, project, auth } = buildAzureCtx(cfg, secrets)
  const url = `${apiBase}/${encodeURIComponent(project)}/_apis/wit/workitems/${encodeURIComponent(workItemId)}/comments?api-version=7.1-preview.3`

  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: auth, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ text: body }),
  })
  if (!res.ok) throw new Error(`Azure comment ${res.status}: ${(await res.text().catch(() => '')).slice(0, 400)}`)
  const data = (await res.json()) as { id: number }
  return { commentId: String(data.id) }
}

export interface AzureComment {
  id: string
  authorDisplayName: string
  body: string
  createdMs: number
}

/** Fetch comments created after a given epoch-ms timestamp. */
export async function getAzureCommentsSince(
  cfg: WorkPipelineConfigJson,
  secrets: WorkPipelineSecrets,
  workItemId: string,
  afterMs: number
): Promise<AzureComment[]> {
  const { apiBase, project, auth } = buildAzureCtx(cfg, secrets)
  const url = `${apiBase}/${encodeURIComponent(project)}/_apis/wit/workitems/${encodeURIComponent(workItemId)}/comments?api-version=7.1-preview.3&$top=50`

  const res = await fetch(url, { headers: { Authorization: auth, Accept: 'application/json' } })
  if (!res.ok) throw new Error(`Azure comments ${res.status}`)

  const data = (await res.json()) as { comments?: Array<{ id: number; text: string; createdDate: string; createdBy: { displayName?: string } }> }
  const comments: AzureComment[] = []
  for (const c of data.comments || []) {
    const createdMs = new Date(c.createdDate).getTime()
    if (Number.isNaN(createdMs) || createdMs <= afterMs) continue
    comments.push({
      id: String(c.id),
      authorDisplayName: c.createdBy?.displayName || 'Unknown',
      body: c.text,
      createdMs,
    })
  }
  return comments
}

/** Update the state of an Azure work item. */
export async function moveAzureWorkItem(
  cfg: WorkPipelineConfigJson,
  secrets: WorkPipelineSecrets,
  workItemId: string,
  newState: string
): Promise<void> {
  const { apiBase, auth } = buildAzureCtx(cfg, secrets)
  const url = `${apiBase}/_apis/wit/workitems/${encodeURIComponent(workItemId)}?api-version=7.1`

  const res = await fetch(url, {
    method: 'PATCH',
    headers: { Authorization: auth, 'Content-Type': 'application/json-patch+json', Accept: 'application/json' },
    body: JSON.stringify([{ op: 'replace', path: '/fields/System.State', value: newState }]),
  })
  if (!res.ok) throw new Error(`Azure move ${res.status}: ${(await res.text().catch(() => '')).slice(0, 400)}`)
}
