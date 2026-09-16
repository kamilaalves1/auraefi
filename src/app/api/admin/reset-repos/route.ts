/**
 * GET /api/admin/reset-repos
 * Shows current state of git_repositories and pipeline_card_runs
 *
 * POST /api/admin/reset-repos
 * Clears ALL git_repositories and resets stuck pipeline_card_runs to 'failed'
 * Also clears linkedRepoIds from all pipeline configs
 *
 * Requires admin role.
 */
import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { dbGetAll, dbRun } from '@/lib/db-pool'
import { logger } from '@/lib/logger'

export async function GET(request: NextRequest) {
  const auth = await requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const repos = await dbGetAll(
      `SELECT id, workspace_id, name, provider, repo_url, branch, is_active,
              CASE WHEN access_token IS NOT NULL AND TRIM(access_token) != '' THEN 'yes' ELSE 'NO - MISSING' END as has_token,
              created_at
       FROM git_repositories ORDER BY id`,
      []
    )

    const runs = await dbGetAll(
      `SELECT id, workspace_id, card_key, status, current_stage_id, updated_at,
              datetime(updated_at, 'unixepoch') as updated_at_readable
       FROM pipeline_card_runs
       WHERE status NOT IN ('done', 'cancelled')
       ORDER BY id`,
      []
    )

    const pipelines = await dbGetAll(
      `SELECT id, workspace_id, name, config_json FROM work_pipelines ORDER BY id`,
      []
    ) as Array<{ id: number; workspace_id: number; name: string; config_json: string }>

    const pipelinesWithLinked = pipelines.map(p => {
      try {
        const cfg = JSON.parse(p.config_json ?? '{}')
        return { ...p, linkedRepoIds: cfg.linkedRepoIds ?? [] }
      } catch { return { ...p, linkedRepoIds: [] } }
    })

    return NextResponse.json({
      message: 'Use POST to reset. Review this data first.',
      repos,
      stuck_runs: runs,
      pipelines: pipelinesWithLinked,
    })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    // 1. Count what will be deleted
    const repos = await dbGetAll('SELECT id FROM git_repositories', []) as Array<{ id: number }>
    const stuckRuns = await dbGetAll(
      `SELECT id FROM pipeline_card_runs WHERE status NOT IN ('done', 'cancelled', 'failed')`,
      []
    ) as Array<{ id: number }>

    // 2. Cancel all non-terminal pipeline runs
    await dbRun(
      `UPDATE pipeline_card_runs SET status = 'cancelled', updated_at = UNIX_TIMESTAMP()
       WHERE status NOT IN ('done', 'cancelled', 'failed')`,
      []
    )

    // 3. Clear linkedRepoIds from all pipeline configs
    const pipelines = await dbGetAll(
      'SELECT id, config_json FROM work_pipelines',
      []
    ) as Array<{ id: number; config_json: string }>

    let pipelinesUpdated = 0
    for (const p of pipelines) {
      try {
        const cfg = JSON.parse(p.config_json ?? '{}')
        if (Array.isArray(cfg.linkedRepoIds) && cfg.linkedRepoIds.length > 0) {
          cfg.linkedRepoIds = []
          await dbRun('UPDATE work_pipelines SET config_json = ? WHERE id = ?', [JSON.stringify(cfg), p.id])
          pipelinesUpdated++
        }
      } catch { /* skip */ }
    }

    // 4. Delete all git repositories
    await dbRun('DELETE FROM git_repositories', [])

    logger.info({ repos_deleted: repos.length, runs_cancelled: stuckRuns.length, pipelines_updated: pipelinesUpdated }, 'admin/reset-repos: reset complete')

    return NextResponse.json({
      ok: true,
      repos_deleted: repos.length,
      runs_cancelled: stuckRuns.length,
      pipelines_updated: pipelinesUpdated,
      message: 'Done. Now go to Repositórios Git and add your repositories again with tokens.',
    })
  } catch (err: any) {
    logger.error({ err }, 'admin/reset-repos error')
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
