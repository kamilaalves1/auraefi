/**
 * GET /api/admin/reset-repos
 * Diagnostic + repair endpoint for git repository configuration.
 *
 * Returns the current state of all repos, pipeline configs, and runs,
 * and fixes linkedRepoIds in pipeline configs to only contain valid repo IDs
 * with tokens.
 *
 * Requires admin or super role.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { dbGet, dbGetAll, dbRun } from '@/lib/db-pool'
import { logger } from '@/lib/logger'

export async function GET(request: NextRequest) {
  const auth = await requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const workspaceId = auth.user.workspace_id ?? 1

    // 1. All repos in this workspace
    const repos = await dbGetAll(
      `SELECT id, name, provider, repo_url, branch, is_active,
              CASE WHEN access_token IS NOT NULL AND TRIM(access_token) != '' THEN true ELSE false END as has_token,
              created_at, updated_at
       FROM git_repositories WHERE workspace_id = ? ORDER BY created_at DESC`,
      [workspaceId]
    ) as any[]

    // 2. All repos in ANY workspace (to detect workspace mismatch)
    const allRepos = await dbGetAll(
      `SELECT id, workspace_id, name, provider, repo_url, is_active,
              CASE WHEN access_token IS NOT NULL AND TRIM(access_token) != '' THEN true ELSE false END as has_token
       FROM git_repositories ORDER BY created_at DESC`,
      []
    ) as any[]

    // 3. Pipeline configs with linkedRepoIds
    const pipelines = await dbGetAll(
      `SELECT id, workspace_id, name, config_json FROM work_pipelines WHERE workspace_id = ?`,
      [workspaceId]
    ) as any[]

    const pipelineInfo = pipelines.map((p: any) => {
      let cfg: any = {}
      try { cfg = JSON.parse(p.config_json ?? '{}') } catch {}
      return {
        id: p.id,
        name: p.name,
        workspace_id: p.workspace_id,
        linkedRepoIds: cfg.linkedRepoIds ?? [],
      }
    })

    // 4. Active/running pipeline runs
    const runs = await dbGetAll(
      `SELECT id, workspace_id, card_key, status, current_stage_id, updated_at
       FROM pipeline_card_runs
       WHERE workspace_id = ? AND status NOT IN ('done','cancelled')
       ORDER BY updated_at DESC LIMIT 20`,
      [workspaceId]
    ) as any[]

    // 5. FIX: update linkedRepoIds in all pipeline configs to remove invalid IDs
    //    and keep only repos that exist with a token in this workspace
    const validRepoIds = new Set(
      repos.filter((r: any) => r.has_token && r.is_active).map((r: any) => r.id)
    )

    let fixed = 0
    for (const p of pipelines) {
      let cfg: any = {}
      try { cfg = JSON.parse(p.config_json ?? '{}') } catch { continue }

      if (!Array.isArray(cfg.linkedRepoIds)) continue

      const originalIds = cfg.linkedRepoIds as number[]
      const cleanIds = originalIds.filter((id: number) => validRepoIds.has(id))

      if (cleanIds.length !== originalIds.length) {
        cfg.linkedRepoIds = cleanIds
        await dbRun(
          'UPDATE work_pipelines SET config_json = ? WHERE id = ?',
          [JSON.stringify(cfg), p.id]
        )
        fixed++
        logger.info({ pipeline_id: p.id, original: originalIds, cleaned: cleanIds }, 'admin/reset-repos: fixed linkedRepoIds')
      }
    }

    // 6. Cancel stuck running runs (older than 10 minutes)
    const staleThreshold = Math.floor(Date.now() / 1000) - 10 * 60
    const cancelResult = await dbRun(
      `UPDATE pipeline_card_runs SET status = 'failed', updated_at = UNIX_TIMESTAMP()
       WHERE workspace_id = ? AND status = 'running' AND updated_at < ?`,
      [workspaceId, staleThreshold]
    )

    return NextResponse.json({
      ok: true,
      workspace_id: workspaceId,
      repos_in_workspace: repos,
      all_repos_system: allRepos,
      pipelines: pipelineInfo,
      active_runs: runs,
      fix_applied: {
        pipelines_fixed: fixed,
        valid_repo_ids: [...validRepoIds],
        stale_runs_cancelled: cancelResult.affectedRows ?? 0,
      },
    })
  } catch (err: any) {
    logger.error({ err }, 'GET /api/admin/reset-repos error')
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
