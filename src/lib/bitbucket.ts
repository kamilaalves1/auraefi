/**
 * Bitbucket Cloud API client for Mission Control issue sync.
 * Auth: BITBUCKET_TOKEN as "username:app_password" (base64 → Basic auth)
 * or a bare Bearer token (OAuth2).
 * Resolves BITBUCKET_TOKEN / BITBUCKET_USERNAME from integration env first.
 */
import { getEffectiveEnvValue } from '@/lib/runtime-env'

export interface BitbucketUser {
  display_name: string
  nickname: string
  account_id?: string
}

/** Normalised Bitbucket issue shape */
export interface BitbucketIssue {
  id: number
  title: string
  /** raw text content */
  content: string | null
  /**
   * new | open | resolved | on hold | invalid | duplicate | wontfix | closed
   * We treat new/open → open; resolved/closed/wontfix/invalid/duplicate → closed
   */
  state: string
  priority: string
  kind: string
  assignee: BitbucketUser | null
  links: { html: { href: string } }
  created_on: string
  updated_on: string
}

// ── Auth helpers ────────────────────────────────────────────────────────────

async function buildAuthHeader(): Promise<string> {
  const token = await getEffectiveEnvValue('BITBUCKET_TOKEN')
  if (!token) throw new Error('BITBUCKET_TOKEN not configured')

  // If token already contains ":" treat it as username:app_password
  if (token.includes(':')) {
    return 'Basic ' + Buffer.from(token).toString('base64')
  }
  // Otherwise assume OAuth2 Bearer
  return `Bearer ${token}`
}

// ── Fetch wrapper ───────────────────────────────────────────────────────────

export async function bitbucketFetch(path: string, options: RequestInit = {}): Promise<Response> {
  const auth = await buildAuthHeader()

  const url = path.startsWith('https://')
    ? path
    : `https://api.bitbucket.org/2.0${path.startsWith('/') ? '' : '/'}${path}`

  const headers: Record<string, string> = {
    Authorization: auth,
    'Content-Type': 'application/json',
    'User-Agent': 'MissionControl/1.0',
    ...(options.headers as Record<string, string> || {}),
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 15000)

  try {
    return await fetch(url, { ...options, headers, signal: controller.signal })
  } finally {
    clearTimeout(timeout)
  }
}

// ── Issue API ───────────────────────────────────────────────────────────────

/**
 * Parse repo string into [workspace, repo_slug].
 * Expected format: "workspace/repo_slug"
 */
function parseRepo(repo: string): [string, string] {
  const parts = repo.split('/')
  if (parts.length < 2) throw new Error(`Invalid Bitbucket repo format: ${repo}`)
  return [parts[0], parts.slice(1).join('/')]
}

function rawToIssue(raw: any): BitbucketIssue {
  return {
    id: raw.id,
    title: raw.title,
    content: raw.content?.raw ?? null,
    state: raw.state,
    priority: raw.priority ?? 'major',
    kind: raw.kind ?? 'bug',
    assignee: raw.assignee
      ? { display_name: raw.assignee.display_name, nickname: raw.assignee.nickname, account_id: raw.assignee.account_id }
      : null,
    links: { html: { href: raw.links?.html?.href ?? '' } },
    created_on: raw.created_on,
    updated_on: raw.updated_on,
  }
}

/** Bitbucket "open" states (map to our 'open') */
export function bitbucketIsOpen(state: string): boolean {
  return state === 'new' || state === 'open'
}

/**
 * Fetch issues from a Bitbucket repo.
 * repo: "workspace/repo_slug"
 */
export async function fetchBitbucketIssues(
  repo: string,
  params?: {
    state?: 'open' | 'closed' | 'all'
    /** ISO date string — only return issues updated after this */
    updated_after?: string
    page?: number
    pagelen?: number
  }
): Promise<BitbucketIssue[]> {
  const [workspace, slug] = parseRepo(repo)
  const qs = new URLSearchParams()
  qs.set('pagelen', String(params?.pagelen ?? 50))
  if (params?.page) qs.set('page', String(params.page))

  // Bitbucket doesn't have a simple state filter on the list endpoint;
  // build a query string with the q param
  const qClauses: string[] = []
  if (params?.state === 'open') {
    qClauses.push('(state = "new" OR state = "open")')
  } else if (params?.state === 'closed') {
    qClauses.push('(state = "resolved" OR state = "closed" OR state = "wontfix" OR state = "invalid" OR state = "duplicate")')
  }
  if (params?.updated_after) {
    qClauses.push(`updated_on > "${params.updated_after}"`)
  }
  if (qClauses.length) qs.set('q', qClauses.join(' AND '))

  const res = await bitbucketFetch(`/repositories/${workspace}/${slug}/issues?${qs}`)
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Bitbucket API error ${res.status}: ${text}`)
  }
  const data = await res.json() as { values: any[] }
  return (data.values || []).map(rawToIssue)
}

/** Fetch a single Bitbucket issue. */
export async function fetchBitbucketIssue(repo: string, issueId: number): Promise<BitbucketIssue> {
  const [workspace, slug] = parseRepo(repo)
  const res = await bitbucketFetch(`/repositories/${workspace}/${slug}/issues/${issueId}`)
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Bitbucket API error ${res.status}: ${text}`)
  }
  return rawToIssue(await res.json())
}

/** Create a new Bitbucket issue. */
export async function createBitbucketIssue(
  repo: string,
  issue: { title: string; content?: string; kind?: string; priority?: string }
): Promise<BitbucketIssue> {
  const [workspace, slug] = parseRepo(repo)
  const body: Record<string, unknown> = {
    title: issue.title,
    kind: issue.kind ?? 'task',
    priority: issue.priority ?? 'major',
  }
  if (issue.content) body.content = { raw: issue.content }

  const res = await bitbucketFetch(`/repositories/${workspace}/${slug}/issues`, {
    method: 'POST',
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Bitbucket API error ${res.status}: ${text}`)
  }
  return rawToIssue(await res.json())
}

/** Update a Bitbucket issue (title, content, state). */
export async function updateBitbucketIssue(
  repo: string,
  issueId: number,
  updates: { title?: string; content?: string; state?: string; priority?: string }
): Promise<BitbucketIssue> {
  const [workspace, slug] = parseRepo(repo)
  const body: Record<string, unknown> = {}
  if (updates.title !== undefined) body.title = updates.title
  if (updates.content !== undefined) body.content = { raw: updates.content }
  if (updates.state !== undefined) body.status = updates.state
  if (updates.priority !== undefined) body.priority = updates.priority

  const res = await bitbucketFetch(`/repositories/${workspace}/${slug}/issues/${issueId}`, {
    method: 'PUT',
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Bitbucket API error ${res.status}: ${text}`)
  }
  return rawToIssue(await res.json())
}

/** Post a comment on a Bitbucket issue. */
export async function createBitbucketComment(
  repo: string,
  issueId: number,
  body: string
): Promise<void> {
  const [workspace, slug] = parseRepo(repo)
  const res = await bitbucketFetch(`/repositories/${workspace}/${slug}/issues/${issueId}/comments`, {
    method: 'POST',
    body: JSON.stringify({ content: { raw: body } }),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Bitbucket API error ${res.status}: ${text}`)
  }
}

/** Test Bitbucket connection — returns the authenticated user. Accepts optional token override. */
export async function testBitbucketConnection(
  tokenOverride?: string
): Promise<{ ok: boolean; user?: string; error?: string }> {
  try {
    const token = tokenOverride || await getEffectiveEnvValue('BITBUCKET_TOKEN')
    if (!token) return { ok: false, error: 'BITBUCKET_TOKEN not configured' }

    const authHeader = token.includes(':')
      ? `Basic ${Buffer.from(token).toString('base64')}`
      : `Bearer ${token}`

    const res = await fetch('https://api.bitbucket.org/2.0/user', {
      headers: { Authorization: authHeader, 'User-Agent': 'MissionControl/1.0' },
    })
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` }
    const data = await res.json() as { display_name: string; nickname: string }
    return { ok: true, user: data.display_name || data.nickname }
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  }
}
