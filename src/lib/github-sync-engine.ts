/**
 * GitHub Sync Engine — bidirectional sync between MC tasks and GitHub issues.
 * Uses proper DB columns (github_repo, github_issue_number, github_synced_at)
 * instead of metadata JSON for matching.
 */

import { dbGetOne, dbRun, db_helpers } from '@/lib/db'
import { logger } from '@/lib/logger'
import {
  fetchIssues,
  fetchIssue,
  updateIssue,
  createIssue,
  ensureLabels,
  type GitHubIssue,
} from '@/lib/github'
import {
  ALL_MC_LABELS,
  ALL_STATUS_LABEL_NAMES,
  ALL_PRIORITY_LABEL_NAMES,
  statusToLabel,
  labelToStatus,
  priorityToLabel,
  labelToPriority,
  type TaskStatus,
  type TaskPriority,
} from '@/lib/github-label-map'

/**
 * Idempotently create all MC labels on a GitHub repo.
 */
export async function initializeLabels(repo: string): Promise<void> {
  await ensureLabels(repo, ALL_MC_LABELS)
  logger.info({ repo }, 'GitHub labels initialized')
}

/**
 * Push a single MC task to GitHub (create or update issue).
 */
export async function pushTaskToGitHub(
  task: {
    id: number
    title: string
    description?: string | null
    status: string
    priority: string
    github_issue_number?: number | null
    github_repo?: string | null
    workspace_id?: number
  },
  project: {
    id: number
    github_repo?: string | null
    github_sync_enabled?: number | null
  }
): Promise<void> {
  const repo = task.github_repo || project.github_repo
  if (!repo) return

  const now = Math.floor(Date.now() / 1000)

  const statusLabel = statusToLabel(task.status as TaskStatus)
  const priorityLabel = priorityToLabel(task.priority as TaskPriority)
  const state: 'open' | 'closed' = task.status === 'done' ? 'closed' : 'open'

  if (task.github_issue_number) {
    // Update existing issue
    let existingIssue: GitHubIssue
    try {
      existingIssue = await fetchIssue(repo, task.github_issue_number)
    } catch (err) {
      logger.error({ err, repo, issue: task.github_issue_number }, 'Failed to fetch issue for update')
      return
    }

    // Keep non-MC labels, replace MC labels with current values
    const nonMcLabels = existingIssue.labels
      .map(l => l.name)
      .filter(name => !ALL_STATUS_LABEL_NAMES.includes(name) && !ALL_PRIORITY_LABEL_NAMES.includes(name))

    const labels = [...nonMcLabels, statusLabel.name, priorityLabel.name]

    await updateIssue(repo, task.github_issue_number, {
      title: task.title,
      body: task.description || '',
      state,
      labels,
    })

    // Mark synced to prevent ping-pong
    await dbRun(`UPDATE tasks SET github_synced_at = ? WHERE id = ?`, [now, task.id])

    logger.info({ repo, issue: task.github_issue_number }, 'Pushed task update to GitHub')
  } else if (project.github_sync_enabled) {
    // Create new issue
    const labels = [statusLabel.name, priorityLabel.name]

    const created = await createIssue(repo, {
      title: task.title,
      body: task.description || undefined,
      labels,
    })

    // Store the issue number and repo on the task
    await dbRun(
      `UPDATE tasks SET github_issue_number = ?, github_repo = ?, github_synced_at = ? WHERE id = ?`,
      [created.number, repo, now, task.id]
    )

    logger.info({ repo, issue: created.number, taskId: task.id }, 'Created GitHub issue for task')
  }
}

/**
 * Pull issues from GitHub and sync into MC tasks for a project.
 */
export async function pullFromGitHub(
  project: {
    id: number
    github_repo?: string | null
    github_sync_enabled?: number | null
    github_default_branch?: string | null
  },
  workspaceId: number
): Promise<{ pulled: number; pushed: number }> {
  const repo = project.github_repo
  if (!repo || !project.github_sync_enabled) {
    return { pulled: 0, pushed: 0 }
  }

  const now = Math.floor(Date.now() / 1000)
  let pulled = 0
  let pushed = 0

  // Find last sync time for this project
  const lastSync = await dbGetOne<{ last_synced_at: number }>(`
    SELECT last_synced_at FROM github_syncs
    WHERE project_id = ? AND workspace_id = ?
    ORDER BY created_at DESC LIMIT 1
  `, [project.id, workspaceId])

  const sinceDate = lastSync
    ? new Date(lastSync.last_synced_at * 1000).toISOString()
    : undefined

  // Fetch all issues updated since last sync
  let issues: GitHubIssue[]
  try {
    issues = await fetchIssues(repo, {
      state: 'all',
      since: sinceDate,
      per_page: 100,
    })
  } catch (err) {
    logger.error({ err, repo }, 'Failed to fetch issues from GitHub')
    // Record failed sync
    await dbRun(
      `INSERT INTO github_syncs (repo, last_synced_at, issue_count, sync_direction, status, error, project_id, changes_pushed, changes_pulled, workspace_id)
       VALUES (?, ?, 0, 'inbound', 'error', ?, ?, 0, 0, ?)`,
      [repo, now, (err as Error).message, project.id, workspaceId]
    )
    return { pulled: 0, pushed: 0 }
  }

  for (const issue of issues) {
    try {
      // Match to existing task via DB columns
      const existingTask = await dbGetOne<any>(`
        SELECT * FROM tasks
        WHERE github_repo = ? AND github_issue_number = ? AND workspace_id = ?
      `, [repo, issue.number, workspaceId])

      const issueUpdatedAt = Math.floor(new Date(issue.updated_at).getTime() / 1000)
      const labelNames = issue.labels.map(l => l.name)

      if (!existingTask) {
        // New issue — create MC task
        const status = issue.state === 'closed' ? 'done' : (labelToStatus(
          labelNames.find(l => ALL_STATUS_LABEL_NAMES.includes(l)) || ''
        ) || 'inbox')
        const priority = labelToPriority(labelNames)
        const tags = labelNames.filter(l => !ALL_STATUS_LABEL_NAMES.includes(l) && !ALL_PRIORITY_LABEL_NAMES.includes(l))

        await dbRun(
          `INSERT INTO tasks (
            title, description, status, priority, created_by,
            created_at, updated_at, tags, metadata,
            github_issue_number, github_repo, github_synced_at,
            project_id, workspace_id
          ) VALUES (?, ?, ?, ?, 'github-sync', ?, ?, ?, '{}', ?, ?, ?, ?, ?)`,
          [
            issue.title,
            issue.body || '',
            status,
            priority,
            now, now,
            JSON.stringify(tags),
            issue.number, repo, now,
            project.id, workspaceId,
          ]
        )

        pulled++
        db_helpers.logActivity(
          'task_created', 'task', 0, 'github-sync',
          `Synced from GitHub: ${repo}#${issue.number}`,
          { github_issue: issue.number, github_repo: repo },
          workspaceId
        ).catch(() => {})
      } else {
        // Existing task — anti-ping-pong: skip if task was just pushed
        if (existingTask.github_synced_at && Math.abs(existingTask.github_synced_at - issueUpdatedAt) < 10) {
          continue
        }

        // Only update if GitHub is newer
        if (issueUpdatedAt <= existingTask.updated_at) {
          continue
        }

        const status = issue.state === 'closed' ? 'done' : (labelToStatus(
          labelNames.find(l => ALL_STATUS_LABEL_NAMES.includes(l)) || ''
        ) || existingTask.status)
        const priority = labelToPriority(labelNames)

        await dbRun(
          `UPDATE tasks
           SET title = ?, description = ?, status = ?, priority = ?,
               github_synced_at = ?, updated_at = ?
           WHERE id = ? AND workspace_id = ?`,
          [issue.title, issue.body || '', status, priority, now, now, existingTask.id, workspaceId]
        )

        pulled++
        db_helpers.logActivity(
          'task_updated', 'task', existingTask.id, 'github-sync',
          `Updated from GitHub: ${repo}#${issue.number}`,
          { github_issue: issue.number, github_repo: repo },
          workspaceId
        ).catch(() => {})
      }
    } catch (err) {
      logger.error({ err, issue: issue.number, repo }, 'Failed to sync GitHub issue')
    }
  }

  // Record sync
  await dbRun(
    `INSERT INTO github_syncs (repo, last_synced_at, issue_count, sync_direction, status, project_id, changes_pushed, changes_pulled, workspace_id)
     VALUES (?, ?, ?, 'inbound', 'success', ?, ?, ?, ?)`,
    [repo, now, pulled, project.id, pushed, pulled, workspaceId]
  )

  logger.info({ repo, pulled, pushed, projectId: project.id }, 'GitHub sync completed')

  return { pulled, pushed }
}
