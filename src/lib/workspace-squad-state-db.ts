import { dbGet, dbRun } from '@/lib/db-pool'

/** Persists whether operators may configure delivery flow, pipelines, and client-facing parameters. */
export async function setWorkspaceSquadActive(
  workspaceId: number,
  active: boolean,
  updatedBy: string | null
): Promise<void> {
  const now = Math.floor(Date.now() / 1000)
  await dbRun(`
    INSERT INTO workspace_squad_state (workspace_id, squad_active, updated_at, updated_by)
    VALUES (?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      squad_active = VALUES(squad_active),
      updated_at = VALUES(updated_at),
      updated_by = VALUES(updated_by)
  `, [workspaceId, active ? 1 : 0, now, updatedBy])
}

export async function getWorkspaceSquadActive(workspaceId: number): Promise<boolean> {
  const row = await dbGet<{ squad_active: number }>(
    'SELECT squad_active FROM workspace_squad_state WHERE workspace_id = ?',
    [workspaceId]
  )
  return row ? row.squad_active === 1 : false
}
