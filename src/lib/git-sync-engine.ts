/**
 * Multi-provider Git sync engine.
 * Supports GitHub, GitLab, and Bitbucket via the git-provider abstraction.
 *
 * Replaces the GitHub-only github-sync-engine.ts for delivery-flow–driven sync.
 * The legacy GitHub project sync in github-sync-engine.ts is kept for backward compat.
 */

import { db_helpers } from '@/lib/db'
import { dbGet, dbGetAll, dbRun } from '@/lib/db-pool'
import { logger } from '@/lib/logger'
import { getGitProviderClient, type GitIssue } from '@/lib/git-provider'
import type { GitProvider } from '@/lib/delivery-flow-types'
import { ALL_MC_LABELS, ALL_STATUS_LABEL_NAMES, ALL_PRIORITY_LABEL_NAMES, statusToLabel, labelToStatus, priorityToLabel, labelToPriority, type TaskStatus, type TaskPriority } from '@/lib/github-label-map'

// ── Types ───────────────────────────────────────────────────────────────────

export interface DeliveryFlowSyncConfig {
  /** delivery_flows.id */
  flowId: number
  workspaceId: number
  provider: GitProvider
  /** e.g. "owner/repo" or "namespace/project" */
  repo: string
  branch: string
}

export interface SyncResult {
  pulled: number
  pushed: number
  errors: number
}

// ── Label init (GitHub only — GitLab/Bitbucket use plain strings) ────────────

export async function initializeLabels(repo: string, provider: GitProvider = 'github'): Promise<void> {
  if (provider !== 'github') return  // Labels as objects are GitHub-specific
  const { ensureLabels } = await import('@/lib/github')
  await ensureLabels(repo, ALL_MC_LABELS)
  logger.info({ repo, provider }, 'Git labels initialized')
}

// ── Push task → provider ────────────────────────────────────────────────────

export async function pushTaskToGit(
  task: {
    id: number
    title: string
    description?: string | null
    status: string
    priority: string
    git_issue_number?: number | null
    git_repo?: string | null
    git_provider?: GitProvider | null
  },
  flow: DeliveryFlowSyncConfig
): Promise<void> {
  const repo = task.git_repo || flow.repo
  if (!repo) return

  const provider = task.git_provider || flow.provider
  const client = getGitProviderClient(provider)
  const now = Math.floor(Date.now() / 1000)

  // Only push labels for GitHub — label-based status is a GitHub convention
  const state: 'open' | 'closed' = task.status === 'done' ? 'closed' : 'open'

  if (task.git_issue_number) {
    const updates: Parameters<typeof client.updateIssue>[2] = {
      title: task.title,
      body: task.description || '',
      state,
    }
    if (provider === 'github') {
      const statusLabel = statusToLabel(task.status as TaskStatus)
      const priorityLabel = priorityToLabel(task.priority as TaskPriority)
      let existing: GitIssue | undefined
      try { existing = await client.fetchIssue(repo, task.git_issue_number) } catch { /* ignore */ }
      const nonMcLabels = (existing?.labels ?? []).filter(
        n => !ALL_STATUS_LABEL_NAMES.includes(n) && !ALL_PRIORITY_LABEL_NAMES.includes(n)
      )
      updates.labels = [...nonMcLabels, statusLabel.name, priorityLabel.name]
    }

    await client.updateIssue(repo, task.git_issue_number, updates)

    await dbRun('UPDATE tasks SET git_synced_at = ? WHERE id = ?', [now, task.id])
    logger.info({ repo, provider, issue: task.git_issue_number }, 'Pushed task update to git provider')
  } else {
    // Create new issue
    const labels = provider === 'github'
      ? [statusToLabel(task.status as TaskStatus).name, priorityToLabel(task.priority as TaskPriority).name]
      : undefined

    const created = await client.createIssue(repo, {
      title: task.title,
      body: task.description || undefined,
      labels,
    })

    await dbRun(`
      UPDATE tasks
      SET git_issue_number = ?, git_repo = ?, git_provider = ?, git_synced_at = ?
      WHERE id = ?
    `, [created.number, repo, provider, now, task.id])

    logger.info({ repo, provider, issue: created.number, taskId: task.id }, 'Created issue on git provider')
  }
}

// ── Pull from provider → MC tasks ───────────────────────────────────────────

export async function pullFromGitProvider(
  flow: DeliveryFlowSyncConfig
): Promise<SyncResult> {
  const { flowId, workspaceId, provider, repo } = flow
  const client = getGitProviderClient(provider)
  const now = Math.floor(Date.now() / 1000)
  let pulled = 0, pushed = 0, errors = 0

  // Find last sync time for this flow
  const lastSync = await dbGet(`
    SELECT last_synced_at FROM git_syncs
    WHERE flow_id = ? AND workspace_id = ?
    ORDER BY created_at DESC LIMIT 1
  `, [flowId, workspaceId]) as { last_synced_at: number } | undefined

  const since = lastSync
    ? new Date(lastSync.last_synced_at * 1000).toISOString()
    : undefined

  let issues: GitIssue[]
  try {
    issues = await client.fetchIssues(repo, { state: 'all', since, per_page: 100 })
  } catch (err) {
    logger.error({ err, repo, provider }, 'Failed to fetch issues from git provider')
    _recordSync({ flowId, workspaceId, provider, repo, now, pulled: 0, pushed: 0, status: 'error', error: (err as Error).message })
    return { pulled: 0, pushed: 0, errors: 1 }
  }

  for (const issue of issues) {
    try {
      const existing = await dbGet(`
        SELECT * FROM tasks
        WHERE git_repo = ? AND git_issue_number = ? AND git_provider = ? AND workspace_id = ?
      `, [repo, issue.number, provider, workspaceId]) as any | undefined

      const issueUpdatedAt = Math.floor(new Date(issue.updated_at).getTime() / 1000)
      const state: 'open' | 'closed' = issue.state

      if (!existing) {
        // New issue → create MC task
        const status = state === 'closed' ? 'done' : (
          provider === 'github'
            ? labelToStatus(issue.labels.find(l => ALL_STATUS_LABEL_NAMES.includes(l)) || '') || 'inbox'
            : 'inbox'
        )
        const priority = provider === 'github' ? labelToPriority(issue.labels) : _mapBbPriority(issue.labels)
        const tags = provider === 'github'
          ? issue.labels.filter(l => !ALL_STATUS_LABEL_NAMES.includes(l) && !ALL_PRIORITY_LABEL_NAMES.includes(l))
          : issue.labels

        await dbRun(`
          INSERT INTO tasks (
            title, description, status, priority, created_by,
            created_at, updated_at, tags, metadata,
            git_issue_number, git_repo, git_provider, git_synced_at,
            workspace_id
          ) VALUES (?, ?, ?, ?, 'git-sync', ?, ?, ?, '{}', ?, ?, ?, ?, ?)
        `, [issue.title, issue.body || '', status, priority,
          now, now, JSON.stringify(tags),
          issue.number, repo, provider, now,
          workspaceId
        ])

        pulled++
        db_helpers.logActivity(
          'task_created', 'task', 0, 'git-sync',
          `Synced from ${provider}: ${repo}#${issue.number}`,
          { git_provider: provider, git_issue: issue.number, git_repo: repo },
          workspaceId
        )
      } else {
        // Existing — skip if we just pushed this, or if provider isn't newer
        if (existing.git_synced_at && Math.abs(existing.git_synced_at - issueUpdatedAt) < 10) continue
        if (issueUpdatedAt <= existing.updated_at) continue

        const status = state === 'closed' ? 'done' : (
          provider === 'github'
            ? labelToStatus(issue.labels.find(l => ALL_STATUS_LABEL_NAMES.includes(l)) || '') || existing.status
            : existing.status
        )
        const priority = provider === 'github' ? labelToPriority(issue.labels) : existing.priority

        await dbRun(`
          UPDATE tasks
          SET title = ?, description = ?, status = ?, priority = ?,
              git_synced_at = ?, updated_at = ?
          WHERE id = ? AND workspace_id = ?
        `, [issue.title, issue.body || '', status, priority, now, now, existing.id, workspaceId])

        pulled++
        db_helpers.logActivity(
          'task_updated', 'task', existing.id, 'git-sync',
          `Updated from ${provider}: ${repo}#${issue.number}`,
          { git_provider: provider, git_issue: issue.number, git_repo: repo },
          workspaceId
        )
      }
    } catch (err) {
      logger.error({ err, issue: issue.number, repo, provider }, 'Failed to sync git issue')
      errors++
    }
  }

  _recordSync({ flowId, workspaceId, provider, repo, now, pulled, pushed, status: errors > 0 ? 'partial' : 'success' })
  logger.info({ repo, provider, pulled, pushed, errors, flowId }, 'Git sync completed')

  return { pulled, pushed, errors }
}

// ── Helpers ─────────────────────────────────────────────────────────────────

async function _recordSync(opts: {
  flowId: number; workspaceId: number; provider: string; repo: string; now: number
  pulled: number; pushed: number; status: string; error?: string
}): Promise<void> {
  try {
    await dbRun(`
      INSERT INTO git_syncs
        (flow_id, workspace_id, provider, repo, last_synced_at, changes_pulled, changes_pushed, status, error, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [opts.flowId, opts.workspaceId, opts.provider, opts.repo, opts.now,
      opts.pulled, opts.pushed, opts.status, opts.error ?? null, opts.now])
  } catch (err) {
    logger.warn({ err }, 'Failed to record git sync')
  }
}

function _mapBbPriority(labels: string[]): TaskPriority {
  // Bitbucket uses priority field, not labels — labels array is empty for BB
  // This function is a fallback for any label-carrying provider
  for (const l of labels) {
    const lower = l.toLowerCase()
    if (lower.includes('critical') || lower.includes('blocker')) return 'critical'
    if (lower.includes('high') || lower.includes('major')) return 'high'
    if (lower.includes('low') || lower.includes('minor') || lower.includes('trivial')) return 'low'
  }
  return 'medium'
}
