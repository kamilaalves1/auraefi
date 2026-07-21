/**
 * GitLab API client for Mission Control issue sync.
 * Resolves GITLAB_TOKEN from the integration env file, then process.env.
 * Supports both gitlab.com and self-hosted instances via GITLAB_BASE_URL.
 */
import { getEffectiveEnvValue } from '@/lib/runtime-env'

export interface GitLabLabel {
  name: string
  color?: string
}

export interface GitLabUser {
  username: string
  name: string
  avatar_url?: string
}

export interface GitLabIssue {
  /** Internal project issue ID (used in API calls) */
  iid: number
  /** Global issue ID */
  id: number
  title: string
  description: string | null
  /** 'opened' | 'closed' */
  state: 'opened' | 'closed'
  labels: string[]
  assignees: GitLabUser[]
  web_url: string
  created_at: string
  updated_at: string
}

export async function getGitLabToken(): Promise<string | null> {
  return await getEffectiveEnvValue('GITLAB_TOKEN') || null
}

export async function getGitLabBaseUrl(): Promise<string> {
  const custom = await getEffectiveEnvValue('GITLAB_BASE_URL')
  return (custom || 'https://gitlab.com').replace(/\/$/, '')
}

/**
 * Authenticated fetch wrapper for GitLab API.
 * repo format: "namespace/project" or "namespace/subgroup/project"
 */
export async function gitlabFetch(
  path: string,
  options: RequestInit = {}
): Promise<Response> {
  const token = await getGitLabToken()
  if (!token) {
    throw new Error('GITLAB_TOKEN not configured')
  }

  const base = await getGitLabBaseUrl()
  const url = path.startsWith('https://')
    ? path
    : `${base}/api/v4${path.startsWith('/') ? '' : '/'}${path}`

  const headers: Record<string, string> = {
    'PRIVATE-TOKEN': token,
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

/** Encode "namespace/project" → "namespace%2Fproject" for GitLab project IDs */
function encodeProjectId(repo: string): string {
  return encodeURIComponent(repo)
}

/**
 * Fetch issues from a GitLab project.
 * repo: "namespace/project"
 */
export async function fetchGitLabIssues(
  repo: string,
  params?: {
    state?: 'opened' | 'closed' | 'all'
    labels?: string
    updated_after?: string
    per_page?: number
    page?: number
  }
): Promise<GitLabIssue[]> {
  const qs = new URLSearchParams()
  qs.set('scope', 'all')
  if (params?.state && params.state !== 'all') qs.set('state', params.state)
  if (params?.labels) qs.set('labels', params.labels)
  if (params?.updated_after) qs.set('updated_after', params.updated_after)
  qs.set('per_page', String(params?.per_page ?? 100))
  qs.set('page', String(params?.page ?? 1))

  const res = await gitlabFetch(`/projects/${encodeProjectId(repo)}/issues?${qs}`)
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`GitLab API error ${res.status}: ${text}`)
  }
  return res.json()
}

/** Fetch a single GitLab issue by its internal IID. */
export async function fetchGitLabIssue(repo: string, iid: number): Promise<GitLabIssue> {
  const res = await gitlabFetch(`/projects/${encodeProjectId(repo)}/issues/${iid}`)
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`GitLab API error ${res.status}: ${text}`)
  }
  return res.json()
}

/** Create a new GitLab issue. */
export async function createGitLabIssue(
  repo: string,
  issue: { title: string; description?: string; labels?: string[] }
): Promise<GitLabIssue> {
  const body: Record<string, unknown> = { title: issue.title }
  if (issue.description) body.description = issue.description
  if (issue.labels?.length) body.labels = issue.labels.join(',')

  const res = await gitlabFetch(`/projects/${encodeProjectId(repo)}/issues`, {
    method: 'POST',
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`GitLab API error ${res.status}: ${text}`)
  }
  return res.json()
}

/** Update a GitLab issue (title, description, state, labels). */
export async function updateGitLabIssue(
  repo: string,
  iid: number,
  updates: { title?: string; description?: string; state_event?: 'close' | 'reopen'; labels?: string[] }
): Promise<GitLabIssue> {
  const body: Record<string, unknown> = {}
  if (updates.title !== undefined) body.title = updates.title
  if (updates.description !== undefined) body.description = updates.description
  if (updates.state_event) body.state_event = updates.state_event
  if (updates.labels) body.labels = updates.labels.join(',')

  const res = await gitlabFetch(`/projects/${encodeProjectId(repo)}/issues/${iid}`, {
    method: 'PUT',
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`GitLab API error ${res.status}: ${text}`)
  }
  return res.json()
}

/** Post a note (comment) on a GitLab issue. */
export async function createGitLabNote(
  repo: string,
  iid: number,
  body: string
): Promise<void> {
  const res = await gitlabFetch(`/projects/${encodeProjectId(repo)}/issues/${iid}/notes`, {
    method: 'POST',
    body: JSON.stringify({ body }),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`GitLab API error ${res.status}: ${text}`)
  }
}

/** Test connection — returns the authenticated user's username. Accepts optional overrides. */
export async function testGitLabConnection(
  tokenOverride?: string,
  baseUrlOverride?: string
): Promise<{ ok: boolean; user?: string; error?: string }> {
  try {
    const base = baseUrlOverride || await getGitLabBaseUrl()
    const token = tokenOverride || await getGitLabToken()
    if (!token) return { ok: false, error: 'GITLAB_TOKEN not configured' }

    const res = await fetch(`${base}/api/v4/user`, {
      headers: { 'PRIVATE-TOKEN': token, 'User-Agent': 'MissionControl/1.0' },
    })
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` }
    const data = await res.json() as { username: string }
    return { ok: true, user: `${data.username} @ ${base}` }
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  }
}
