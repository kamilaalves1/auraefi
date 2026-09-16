import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { dbGetAll } from '@/lib/db-pool'

/** GET /api/workspace/git-repositories/debug — show all repos for diagnostics (admin only) */
export async function GET(request: NextRequest) {
  const auth = await requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const workspaceId = auth.user.workspace_id ?? 1

  const repos = await dbGetAll(
    `SELECT id, workspace_id, name, provider, repo_url, branch, is_active,
            CASE WHEN access_token IS NULL THEN 'NULL'
                 WHEN access_token = '' THEN 'EMPTY'
                 ELSE CONCAT('SET(', LENGTH(access_token), ' chars)')
            END as token_status,
            created_at, updated_at
     FROM git_repositories
     ORDER BY id ASC`,
    []
  )

  const pipelines = await dbGetAll(
    `SELECT id, workspace_id, name, config_json FROM work_pipelines WHERE workspace_id = ?`,
    [workspaceId]
  ) as any[]

  const pipelinesWithRepos = pipelines.map(p => {
    try {
      const cfg = JSON.parse(p.config_json ?? '{}')
      return { ...p, linkedRepoIds: cfg.linkedRepoIds ?? [] }
    } catch { return { ...p, linkedRepoIds: [] } }
  })

  return NextResponse.json({ repos, pipelines: pipelinesWithRepos, workspace_id: workspaceId })
}
