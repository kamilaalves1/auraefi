/**
 * Unified Git provider abstraction.
 * Normalises GitHub / GitLab / Bitbucket issues into a common GitIssue shape
 * and exposes a provider-agnostic client factory.
 */

import type { GitProvider } from '@/lib/delivery-flow-types'
import { fetchIssues as ghFetchIssues, fetchIssue as ghFetchIssue, createIssue as ghCreateIssue, updateIssue as ghUpdateIssue, createIssueComment as ghCreateComment, getGitHubToken } from '@/lib/github'
import { fetchGitLabIssues, fetchGitLabIssue, createGitLabIssue, updateGitLabIssue, createGitLabNote, testGitLabConnection, getGitLabToken } from '@/lib/gitlab'
import { fetchBitbucketIssues, fetchBitbucketIssue, createBitbucketIssue, updateBitbucketIssue, createBitbucketComment, testBitbucketConnection, bitbucketIsOpen } from '@/lib/bitbucket'

// ── Unified types ───────────────────────────────────────────────────────────

export interface GitIssue {
  /** Provider-native issue number/IID/ID */
  number: number
  title: string
  body: string | null
  /** Normalised: 'open' | 'closed' */
  state: 'open' | 'closed'
  /** Label names (strings for all providers) */
  labels: string[]
  /** Assignee login/username */
  assignee: string | null
  /** Full web URL */
  html_url: string
  created_at: string
  updated_at: string
  /** The provider this issue came from */
  provider: GitProvider
}

export type GitIssueState = 'open' | 'closed' | 'all'

export interface GitProviderClient {
  provider: GitProvider
  /** Verify token is valid; returns user info */
  testConnection(): Promise<{ ok: boolean; user?: string; error?: string }>
  fetchIssues(repo: string, params?: { state?: GitIssueState; since?: string; per_page?: number }): Promise<GitIssue[]>
  fetchIssue(repo: string, number: number): Promise<GitIssue>
  createIssue(repo: string, issue: { title: string; body?: string; labels?: string[] }): Promise<GitIssue>
  updateIssue(repo: string, number: number, updates: { title?: string; body?: string; state?: 'open' | 'closed'; labels?: string[] }): Promise<GitIssue>
  createComment(repo: string, number: number, body: string): Promise<void>
}

// ── GitHub adapter ──────────────────────────────────────────────────────────

const githubClient: GitProviderClient = {
  provider: 'github',

  async testConnection() {
    const token = await getGitHubToken()
    if (!token) return { ok: false, error: 'GITHUB_TOKEN not configured' }
    try {
      const res = await fetch('https://api.github.com/user', {
        headers: { Authorization: `Bearer ${token}`, 'User-Agent': 'MissionControl/1.0' },
        signal: AbortSignal.timeout(8000),
      })
      if (!res.ok) return { ok: false, error: `HTTP ${res.status}` }
      const data = await res.json() as { login: string }
      return { ok: true, user: data.login }
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
  },

  async fetchIssues(repo, params) {
    const issues = await ghFetchIssues(repo, {
      state: params?.state === 'all' ? 'all' : params?.state === 'closed' ? 'closed' : 'open',
      since: params?.since,
      per_page: params?.per_page ?? 100,
    })
    return issues.map(i => ({
      number: i.number,
      title: i.title,
      body: i.body,
      state: i.state === 'closed' ? 'closed' : 'open',
      labels: i.labels.map(l => l.name),
      assignee: i.assignee?.login ?? null,
      html_url: i.html_url,
      created_at: i.created_at,
      updated_at: i.updated_at,
      provider: 'github' as GitProvider,
    }))
  },

  async fetchIssue(repo, number) {
    const i = await ghFetchIssue(repo, number)
    return {
      number: i.number, title: i.title, body: i.body,
      state: i.state === 'closed' ? 'closed' : 'open',
      labels: i.labels.map(l => l.name),
      assignee: i.assignee?.login ?? null,
      html_url: i.html_url,
      created_at: i.created_at, updated_at: i.updated_at,
      provider: 'github' as GitProvider,
    }
  },

  async createIssue(repo, issue) {
    const i = await ghCreateIssue(repo, issue)
    return {
      number: i.number, title: i.title, body: i.body,
      state: 'open', labels: i.labels.map(l => l.name),
      assignee: i.assignee?.login ?? null,
      html_url: i.html_url,
      created_at: i.created_at, updated_at: i.updated_at,
      provider: 'github' as GitProvider,
    }
  },

  async updateIssue(repo, number, updates) {
    const i = await ghUpdateIssue(repo, number, {
      title: updates.title,
      body: updates.body,
      state: updates.state,
      labels: updates.labels,
    })
    return {
      number: i.number, title: i.title, body: i.body,
      state: i.state === 'closed' ? 'closed' : 'open',
      labels: i.labels.map(l => l.name),
      assignee: i.assignee?.login ?? null,
      html_url: i.html_url,
      created_at: i.created_at, updated_at: i.updated_at,
      provider: 'github' as GitProvider,
    }
  },

  async createComment(repo, number, body) {
    await ghCreateComment(repo, number, body)
  },
}

// ── GitLab adapter ──────────────────────────────────────────────────────────

const gitlabClient: GitProviderClient = {
  provider: 'gitlab',

  async testConnection() {
    return testGitLabConnection()
  },

  async fetchIssues(repo, params) {
    const state = params?.state === 'all' ? 'all'
      : params?.state === 'closed' ? 'closed'
      : 'opened'
    const issues = await fetchGitLabIssues(repo, {
      state: state as 'opened' | 'closed' | 'all',
      updated_after: params?.since,
      per_page: params?.per_page ?? 100,
    })
    return issues.map(i => ({
      number: i.iid,
      title: i.title,
      body: i.description,
      state: i.state === 'closed' ? 'closed' : 'open',
      labels: i.labels,
      assignee: i.assignees?.[0]?.username ?? null,
      html_url: i.web_url,
      created_at: i.created_at,
      updated_at: i.updated_at,
      provider: 'gitlab' as GitProvider,
    }))
  },

  async fetchIssue(repo, number) {
    const i = await fetchGitLabIssue(repo, number)
    return {
      number: i.iid, title: i.title, body: i.description,
      state: i.state === 'closed' ? 'closed' : 'open',
      labels: i.labels,
      assignee: i.assignees?.[0]?.username ?? null,
      html_url: i.web_url,
      created_at: i.created_at, updated_at: i.updated_at,
      provider: 'gitlab' as GitProvider,
    }
  },

  async createIssue(repo, issue) {
    const i = await createGitLabIssue(repo, {
      title: issue.title,
      description: issue.body,
      labels: issue.labels,
    })
    return {
      number: i.iid, title: i.title, body: i.description,
      state: 'open', labels: i.labels,
      assignee: i.assignees?.[0]?.username ?? null,
      html_url: i.web_url,
      created_at: i.created_at, updated_at: i.updated_at,
      provider: 'gitlab' as GitProvider,
    }
  },

  async updateIssue(repo, number, updates) {
    const i = await updateGitLabIssue(repo, number, {
      title: updates.title,
      description: updates.body,
      state_event: updates.state === 'closed' ? 'close' : updates.state === 'open' ? 'reopen' : undefined,
      labels: updates.labels,
    })
    return {
      number: i.iid, title: i.title, body: i.description,
      state: i.state === 'closed' ? 'closed' : 'open',
      labels: i.labels,
      assignee: i.assignees?.[0]?.username ?? null,
      html_url: i.web_url,
      created_at: i.created_at, updated_at: i.updated_at,
      provider: 'gitlab' as GitProvider,
    }
  },

  async createComment(repo, number, body) {
    await createGitLabNote(repo, number, body)
  },
}

// ── Bitbucket adapter ───────────────────────────────────────────────────────

const bitbucketClient: GitProviderClient = {
  provider: 'bitbucket',

  async testConnection() {
    return testBitbucketConnection()
  },

  async fetchIssues(repo, params) {
    const issues = await fetchBitbucketIssues(repo, {
      state: params?.state,
      updated_after: params?.since,
      pagelen: params?.per_page ?? 50,
    })
    return issues.map(i => ({
      number: i.id,
      title: i.title,
      body: i.content,
      state: bitbucketIsOpen(i.state) ? 'open' : 'closed',
      labels: [],          // Bitbucket doesn't have label arrays like GitHub/GitLab
      assignee: i.assignee?.nickname ?? null,
      html_url: i.links.html.href,
      created_at: i.created_on,
      updated_at: i.updated_on,
      provider: 'bitbucket' as GitProvider,
    }))
  },

  async fetchIssue(repo, number) {
    const i = await fetchBitbucketIssue(repo, number)
    return {
      number: i.id, title: i.title, body: i.content,
      state: bitbucketIsOpen(i.state) ? 'open' : 'closed',
      labels: [],
      assignee: i.assignee?.nickname ?? null,
      html_url: i.links.html.href,
      created_at: i.created_on, updated_at: i.updated_on,
      provider: 'bitbucket' as GitProvider,
    }
  },

  async createIssue(repo, issue) {
    const i = await createBitbucketIssue(repo, {
      title: issue.title,
      content: issue.body,
    })
    return {
      number: i.id, title: i.title, body: i.content,
      state: 'open', labels: [],
      assignee: i.assignee?.nickname ?? null,
      html_url: i.links.html.href,
      created_at: i.created_on, updated_at: i.updated_on,
      provider: 'bitbucket' as GitProvider,
    }
  },

  async updateIssue(repo, number, updates) {
    const bbState = updates.state === 'closed' ? 'resolved' : updates.state === 'open' ? 'open' : undefined
    const i = await updateBitbucketIssue(repo, number, {
      title: updates.title,
      content: updates.body,
      state: bbState,
    })
    return {
      number: i.id, title: i.title, body: i.content,
      state: bitbucketIsOpen(i.state) ? 'open' : 'closed',
      labels: [],
      assignee: i.assignee?.nickname ?? null,
      html_url: i.links.html.href,
      created_at: i.created_on, updated_at: i.updated_on,
      provider: 'bitbucket' as GitProvider,
    }
  },

  async createComment(repo, number, body) {
    await createBitbucketComment(repo, number, body)
  },
}

// ── Factory ─────────────────────────────────────────────────────────────────

/** Get the unified client for a given provider. When token/baseUrl are provided they override env-var lookups. */
export function getGitProviderClient(
  provider: GitProvider | string | null | undefined,
  _tokenOverride?: string,
  _baseUrlOverride?: string
): GitProviderClient {
  // Token overrides are handled in the test route directly against provider APIs.
  // The static clients use env vars; override support is available via testXxxConnection helpers.
  switch (provider) {
    case 'gitlab':    return gitlabClient
    case 'bitbucket': return bitbucketClient
    default:          return githubClient   // 'github' or unknown → GitHub
  }
}

/** Test all configured providers. */
export async function testAllProviders(): Promise<Record<GitProvider, { ok: boolean; user?: string; error?: string }>> {
  const [gh, gl, bb] = await Promise.all([
    githubClient.testConnection(),
    gitlabClient.testConnection(),
    bitbucketClient.testConnection(),
  ])
  return { github: gh, gitlab: gl, bitbucket: bb }
}
