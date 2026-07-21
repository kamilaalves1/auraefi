import Database from 'better-sqlite3'

/** Persists whether operators may configure delivery flow, pipelines, and client-facing parameters. */
export function setWorkspaceSquadActive(
  db: Database.Database,
  workspaceId: number,
  active: boolean,
  updatedBy: string | null
) {
  const now = Math.floor(Date.now() / 1000)
  db.prepare(
    `
    INSERT INTO workspace_squad_state (workspace_id, squad_active, updated_at, updated_by)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(workspace_id) DO UPDATE SET
      squad_active = excluded.squad_active,
      updated_at = excluded.updated_at,
      updated_by = excluded.updated_by
  `,
  ).run(workspaceId, active ? 1 : 0, now, updatedBy)
}

export function getWorkspaceSquadActive(db: Database.Database, workspaceId: number): boolean {
  const row = db
    .prepare('SELECT squad_active FROM workspace_squad_state WHERE workspace_id = ?')
    .get(workspaceId) as { squad_active: number } | undefined
  return row ? row.squad_active === 1 : false
}
