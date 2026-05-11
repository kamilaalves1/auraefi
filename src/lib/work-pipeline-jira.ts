import type { NormalizedBacklogItem, WorkPipelineConfigJson, WorkPipelineSecrets } from '@/lib/work-pipeline-types'

function stripTrailingSlash(u: string): string {
  return u.replace(/\/+$/, '')
}

function extractAdfText(node: unknown): string {
  if (node == null) return ''
  if (typeof node === 'string') return node
  if (typeof node !== 'object') return ''
  const o = node as Record<string, unknown>
  if (typeof o.text === 'string') return o.text
  const content = o.content
  if (Array.isArray(content)) {
    return content.map(extractAdfText).filter(Boolean).join('\n')
  }
  return ''
}

function jiraDescriptionToText(desc: unknown): string {
  if (desc == null) return ''
  if (typeof desc === 'string') return desc
  return extractAdfText(desc)
}

export async function fetchJiraBacklog(
  cfg: WorkPipelineConfigJson,
  secrets: WorkPipelineSecrets,
  maxResults = 50
): Promise<NormalizedBacklogItem[]> {
  const host = stripTrailingSlash((cfg.jiraHost || '').trim())
  const projectKey = (cfg.jiraProjectKey || '').trim()
  const email = (cfg.jiraAccountEmail || secrets.jiraEmail || '').trim()
  const token = (secrets.jiraApiToken || '').trim()
  if (!host || !projectKey || !email || !token) {
    throw new Error('JIRA: set host, project key, account email, and API token')
  }

  const safeKey = projectKey.replace(/[^A-Za-z0-9_]/g, '')
  if (!safeKey) {
    throw new Error('JIRA: invalid project key')
  }
  const jql =
    (cfg.jiraJql || '').trim() ||
    `project = ${safeKey} AND statusCategory != Done ORDER BY updated DESC`

  const auth = Buffer.from(`${email}:${token}`).toString('base64')
  const url = new URL('/rest/api/3/search', `${host}/`)
  url.searchParams.set('jql', jql)
  url.searchParams.set('maxResults', String(maxResults))
  url.searchParams.set('fields', 'summary,description,status,issuetype')

  const res = await fetch(url.toString(), {
    headers: {
      Authorization: `Basic ${auth}`,
      Accept: 'application/json',
    },
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`JIRA API ${res.status}: ${body.slice(0, 400)}`)
  }

  const data = (await res.json()) as { issues?: Array<Record<string, unknown>> }
  const issues = data.issues || []

  return issues.map((issue) => {
    const key = String(issue.key ?? '')
    const fields = (issue.fields || {}) as Record<string, unknown>
    const status = (fields.status as { name?: string } | undefined)?.name || ''
    const issuetype = (fields.issuetype as { name?: string } | undefined)?.name || 'Issue'
    const summary = String(fields.summary ?? '')
    const description = jiraDescriptionToText(fields.description)
    const browse = `${host}/browse/${key}`
    return {
      externalId: key,
      title: summary,
      description,
      state: status,
      type: issuetype,
      url: browse,
      raw: issue as unknown as Record<string, unknown>,
    }
  })
}

export async function testJiraConnection(
  cfg: WorkPipelineConfigJson,
  secrets: WorkPipelineSecrets
): Promise<{ ok: true; issueCount: number }> {
  const items = await fetchJiraBacklog(cfg, secrets, 5)
  return { ok: true, issueCount: items.length }
}
