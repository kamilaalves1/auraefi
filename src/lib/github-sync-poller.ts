/**
 * Background poller for multi-provider Git ↔ MC task sync.
 * Handles GitHub, GitLab, and Bitbucket via delivery_flows configuration.
 * Also preserves legacy GitHub project sync for backward compat.
 * Lazy singleton — call startSyncPoller() to begin.
 */

import { getDatabase } from '@/lib/db'
import { logger } from '@/lib/logger'
import { pullFromGitHub } from '@/lib/github-sync-engine'
import { pullFromGitProvider, type DeliveryFlowSyncConfig } from '@/lib/git-sync-engine'
import type { GitProvider } from '@/lib/delivery-flow-types'

const INTERVAL_MS = parseInt(process.env.GITHUB_SYNC_INTERVAL_MS || '60000', 10)

let intervalHandle: ReturnType<typeof setInterval> | null = null
let lastRun: number | undefined

export function startSyncPoller(): void {
  if (intervalHandle) return

  logger.info({ intervalMs: INTERVAL_MS }, 'Starting multi-provider git sync poller')

  intervalHandle = setInterval(async () => {
    await runSyncTick()
  }, INTERVAL_MS)

  // Run immediately on start
  runSyncTick().catch(() => {})
}

export function stopSyncPoller(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle)
    intervalHandle = null
    logger.info('Git sync poller stopped')
  }
}

export function getSyncPollerStatus(): { running: boolean; interval: number; lastRun?: number } {
  return {
    running: intervalHandle !== null,
    interval: INTERVAL_MS,
    lastRun,
  }
}

async function runSyncTick(): Promise<void> {
  try {
    const db = getDatabase()

    // ── 1. Sync delivery flows (multi-provider) ──────────────────────
    const flows = db.prepare(`
      SELECT df.id, df.workspace_id,
             gr.provider AS git_provider, gr.repo_url AS git_repo_url, gr.branch AS git_branch
      FROM delivery_flows df
      JOIN git_repositories gr ON gr.id = df.git_repository_id
      WHERE df.is_active = 1
        AND gr.is_active = 1
        AND gr.repo_url IS NOT NULL
        AND gr.repo_url != ''
    `).all() as Array<{
      id: number
      workspace_id: number
      git_provider: GitProvider
      git_repo_url: string
      git_branch: string
    }>

    for (const flow of flows) {
      try {
        const cfg: DeliveryFlowSyncConfig = {
          flowId: flow.id,
          workspaceId: flow.workspace_id,
          provider: flow.git_provider,
          repo: flow.git_repo_url,
          branch: flow.git_branch ?? 'main',
        }
        await pullFromGitProvider(cfg)
      } catch (err) {
        logger.error({ err, flowId: flow.id, provider: flow.git_provider, repo: flow.git_repo_url }, 'Sync poller: delivery flow sync failed')
      }
    }

    // ── 2. Legacy: sync GitHub-enabled projects ───────────────────────
    const projects = db.prepare(`
      SELECT id, github_repo, github_sync_enabled, github_default_branch, workspace_id
      FROM projects
      WHERE github_sync_enabled = 1 AND github_repo IS NOT NULL AND status = 'active'
    `).all() as Array<{
      id: number
      github_repo: string
      github_sync_enabled: number
      github_default_branch: string | null
      workspace_id: number
    }>

    for (const project of projects) {
      try {
        await pullFromGitHub(project, project.workspace_id)
      } catch (err) {
        logger.error({ err, projectId: project.id, repo: project.github_repo }, 'Sync poller: legacy project sync failed')
      }
    }

    lastRun = Math.floor(Date.now() / 1000)
  } catch (err) {
    logger.error({ err }, 'Sync poller tick failed')
  }
}
