/**
 * error-logger.ts
 * Persists application errors to the error_logs table so they can be
 * viewed in the Erros panel without needing access to server logs.
 */

import { dbRun, dbGetAll } from './db-pool'
import { logger } from './logger'

export interface ErrorLogEntry {
  id: number
  level: string
  source: string
  message: string
  data: Record<string, unknown> | null
  workspace_id: number
  created_at: number
}

/**
 * Log an error to the error_logs table.
 * Non-fatal: if the DB write fails it only logs to stdout.
 */
export async function logError(
  source: string,
  message: string,
  data?: Record<string, unknown> | null,
  workspaceId = 1,
  level: 'error' | 'warn' = 'error',
): Promise<void> {
  try {
    const dataJson = data ? JSON.stringify(data) : null
    const truncatedMsg = message.slice(0, 2000)
    await dbRun(
      `INSERT INTO error_logs (level, source, message, data, workspace_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [level, source.slice(0, 100), truncatedMsg, dataJson, workspaceId, Math.floor(Date.now() / 1000)]
    )
  } catch (err) {
    logger.warn({ err }, 'error-logger: failed to persist error to DB')
  }
}

/**
 * Fetch recent error logs for the Erros panel.
 */
export async function getErrorLogs(
  workspaceId: number,
  limit = 100,
  offset = 0,
): Promise<ErrorLogEntry[]> {
  const rows = await dbGetAll(
    `SELECT * FROM error_logs WHERE workspace_id = ?
     ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    [workspaceId, limit, offset]
  ) as any[]

  return rows.map(r => ({
    ...r,
    data: r.data ? (() => { try { return JSON.parse(r.data) } catch { return r.data } })() : null,
  }))
}
