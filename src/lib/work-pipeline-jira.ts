import type { NormalizedBacklogItem, WorkPipelineConfigJson, WorkPipelineSecrets } from '@/lib/work-pipeline-types'

function stripTrailingSlash(u: string): string {
  return u.replace(/\/+$/, '')
}

function extractAdfText(node: unknown): string {
  if (node == null) return ''
  if (typeof node === 'string') return node
  if (typeof node !== 'object') return ''
  const o = node as Record<string, unknown>

  // Plain text node
  if (typeof o.text === 'string') return o.text

  // Mention node: { type: "mention", attrs: { text: "@vertex", id: "..." } }
  if (o.type === 'mention') {
    const attrs = o.attrs as Record<string, unknown> | undefined
    if (typeof attrs?.text === 'string') return attrs.text
    return ''
  }

  // Hard line break
  if (o.type === 'hardBreak') return '\n'

  // Block-level nodes: separate with newlines
  const blockTypes = new Set(['paragraph', 'heading', 'bulletList', 'orderedList', 'listItem', 'blockquote', 'codeBlock', 'rule'])
  const content = o.content
  if (Array.isArray(content)) {
    const sep = blockTypes.has(o.type as string) ? '\n' : ''
    return content.map(extractAdfText).filter(Boolean).join('') + sep
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
  const url = new URL('/rest/api/3/search/jql', `${host}/`)
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

function buildJiraAuth(cfg: WorkPipelineConfigJson, secrets: WorkPipelineSecrets): { auth: string; host: string } {
  const host = stripTrailingSlash((cfg.jiraHost || '').trim())
  const email = (cfg.jiraAccountEmail || secrets.jiraEmail || '').trim()
  const token = (secrets.jiraApiToken || '').trim()
  if (!host || !email || !token) throw new Error('JIRA: set host, account email, and API token')
  return { auth: Buffer.from(`${email}:${token}`).toString('base64'), host }
}

/** Resolve a status name to its numeric ID (needed for JIRA Cloud API v3 JQL). */
async function resolveJiraStatusId(auth: string, host: string, projectKey: string, statusName: string): Promise<string | null> {
  try {
    const res = await fetch(`${host}/rest/api/3/project/${encodeURIComponent(projectKey)}/statuses`, {
      headers: { Authorization: `Basic ${auth}`, Accept: 'application/json' },
    })
    if (!res.ok) return null
    const data = await res.json() as Array<{ statuses?: Array<{ id: string; name: string }> }>
    for (const type of data) {
      for (const s of type.statuses ?? []) {
        if (s.name.toLowerCase() === statusName.toLowerCase()) return s.id
      }
    }
  } catch { /* ignore */ }
  return null
}

/** Fetch cards that are currently in a specific status column. */
export async function fetchJiraIssuesByStatus(
  cfg: WorkPipelineConfigJson,
  secrets: WorkPipelineSecrets,
  statusName: string,
  maxResults = 50
): Promise<NormalizedBacklogItem[]> {
  const { auth, host } = buildJiraAuth(cfg, secrets)
  const projectKey = (cfg.jiraProjectKey || '').trim().replace(/[^A-Za-z0-9_]/g, '')
  if (!projectKey) throw new Error('JIRA: missing project key')

  // JIRA Cloud /rest/api/3/search/jql does not match localized status names — use ID instead
  const statusId = await resolveJiraStatusId(auth, host, projectKey, statusName)
  const statusFilter = statusId
    ? `status in (${statusId})`
    : `status = "${statusName.replace(/"/g, '\\"')}"`
  const jql = `project = ${projectKey} AND ${statusFilter} ORDER BY updated DESC`
  const url = new URL('/rest/api/3/search/jql', `${host}/`)
  url.searchParams.set('jql', jql)
  url.searchParams.set('maxResults', String(maxResults))
  url.searchParams.set('fields', 'summary,description,status,issuetype')

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Basic ${auth}`, Accept: 'application/json' },
  })
  if (!res.ok) throw new Error(`JIRA API ${res.status}: ${(await res.text().catch(() => '')).slice(0, 400)}`)

  const data = (await res.json()) as { issues?: Array<Record<string, unknown>> }
  return (data.issues || []).map((issue) => {
    const key = String(issue.key ?? '')
    const fields = (issue.fields || {}) as Record<string, unknown>
    return {
      externalId: key,
      title: String(fields.summary ?? ''),
      description: jiraDescriptionToText(fields.description),
      state: (fields.status as { name?: string } | undefined)?.name || '',
      type: (fields.issuetype as { name?: string } | undefined)?.name || 'Issue',
      url: `${host}/browse/${key}`,
      raw: issue as unknown as Record<string, unknown>,
    }
  })
}

/** Post a comment to a JIRA issue (plain text, ADF doc format). */
export async function postJiraComment(
  cfg: WorkPipelineConfigJson,
  secrets: WorkPipelineSecrets,
  issueKey: string,
  body: string
): Promise<{ commentId: string }> {
  const { auth, host } = buildJiraAuth(cfg, secrets)
  const url = `${host}/rest/api/3/issue/${encodeURIComponent(issueKey)}/comment`

  const adfBody = {
    version: 1,
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [{ type: 'text', text: body }],
      },
    ],
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({ body: adfBody }),
  })
  if (!res.ok) throw new Error(`JIRA comment ${res.status}: ${(await res.text().catch(() => '')).slice(0, 400)}`)
  const data = (await res.json()) as { id: string }
  return { commentId: String(data.id) }
}

export interface JiraComment {
  id: string
  authorDisplayName: string
  authorEmail: string
  body: string
  createdMs: number
}

/** Fetch comments on an issue created after a given epoch-ms timestamp. */
export async function getJiraCommentsSince(
  cfg: WorkPipelineConfigJson,
  secrets: WorkPipelineSecrets,
  issueKey: string,
  afterMs: number
): Promise<JiraComment[]> {
  const { auth, host } = buildJiraAuth(cfg, secrets)
  const url = `${host}/rest/api/3/issue/${encodeURIComponent(issueKey)}/comment?orderBy=created&maxResults=50`

  const res = await fetch(url, {
    headers: { Authorization: `Basic ${auth}`, Accept: 'application/json' },
  })
  if (!res.ok) throw new Error(`JIRA comments ${res.status}`)

  const data = (await res.json()) as { comments?: Array<Record<string, unknown>> }
  const comments: JiraComment[] = []

  for (const c of data.comments || []) {
    const created = new Date(String(c.created ?? '')).getTime()
    if (Number.isNaN(created) || created <= afterMs) continue
    const author = (c.author as { displayName?: string; emailAddress?: string } | undefined) ?? {}
    comments.push({
      id: String(c.id ?? ''),
      authorDisplayName: author.displayName || 'Unknown',
      authorEmail: author.emailAddress || '',
      body: jiraDescriptionToText(c.body),
      createdMs: created,
    })
  }
  return comments
}

export interface JiraTransition {
  id: string
  name: string
}

/** List available transitions for an issue. */
export async function getJiraTransitions(
  cfg: WorkPipelineConfigJson,
  secrets: WorkPipelineSecrets,
  issueKey: string
): Promise<JiraTransition[]> {
  const { auth, host } = buildJiraAuth(cfg, secrets)
  const url = `${host}/rest/api/3/issue/${encodeURIComponent(issueKey)}/transitions`

  const res = await fetch(url, {
    headers: { Authorization: `Basic ${auth}`, Accept: 'application/json' },
  })
  if (!res.ok) throw new Error(`JIRA transitions ${res.status}`)

  const data = (await res.json()) as { transitions?: Array<{ id: string; name: string }> }
  return (data.transitions || []).map((t) => ({ id: t.id, name: t.name }))
}

/** Transition an issue to a new status by matching transition name (case-insensitive). */
export async function transitionJiraIssue(
  cfg: WorkPipelineConfigJson,
  secrets: WorkPipelineSecrets,
  issueKey: string,
  targetStatusName: string
): Promise<void> {
  const { auth, host } = buildJiraAuth(cfg, secrets)
  const transitions = await getJiraTransitions(cfg, secrets, issueKey)
  const match = transitions.find(
    (t) => t.name.toLowerCase() === targetStatusName.toLowerCase()
  )
  if (!match) {
    // Not found by name — list what's available and skip gracefully
    return
  }

  const url = `${host}/rest/api/3/issue/${encodeURIComponent(issueKey)}/transitions`
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({ transition: { id: match.id } }),
  })
  if (!res.ok) throw new Error(`JIRA transition ${res.status}: ${(await res.text().catch(() => '')).slice(0, 400)}`)
}
