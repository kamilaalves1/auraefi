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
