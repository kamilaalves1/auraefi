/**
 * Recurring Task Spawner
 *
 * Queries task templates with recurrence metadata and spawns child tasks
 * when their cron schedule is due. Uses template-clone pattern:
 * the recurring task stays as a template, child tasks get spawned with
 * date-suffixed titles.
 */

import { db_helpers, dbGetAll, dbGetOne, dbTransaction } from './db'
import { logger } from './logger'
import { isCronDue } from './schedule-parser'

export interface RecurrenceMetadata {
  cron_expr: string
  natural_text: string
  enabled: boolean
  last_spawned_at: number | null
  spawn_count: number
  parent_task_id: null
}

function formatDateSuffix(): string {
  const now = new Date()
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${months[now.getMonth()]} ${String(now.getDate()).padStart(2, '0')}`
}

export async function spawnRecurringTasks(): Promise<{ ok: boolean; message: string }> {
  try {
    const nowMs = Date.now()
    const nowSec = Math.floor(nowMs / 1000)

    // Find all template tasks with enabled recurrence
    const templates = await dbGetAll<{
      id: number
      title: string
      description: string | null
      priority: string
      project_id: number | null
      assigned_to: string | null
      created_by: string
      tags: string | null
      metadata: string | null
      workspace_id: number
    }>(`
      SELECT id, title, description, priority, project_id, assigned_to, created_by,
             tags, metadata, workspace_id
      FROM tasks
      WHERE JSON_EXTRACT(metadata, '$.recurrence.enabled') = 1
        AND JSON_EXTRACT(metadata, '$.recurrence.cron_expr') IS NOT NULL
        AND JSON_EXTRACT(metadata, '$.recurrence.parent_task_id') IS NULL
    `)

    if (templates.length === 0) {
      return { ok: true, message: 'No recurring tasks' }
    }

    let spawned = 0

    for (const template of templates) {
      const metadata = template.metadata ? JSON.parse(template.metadata) : {}
      const recurrence = metadata.recurrence as RecurrenceMetadata | undefined
      if (!recurrence?.cron_expr || !recurrence.enabled) continue

      const lastSpawnedAtMs = recurrence.last_spawned_at ? recurrence.last_spawned_at * 1000 : 0

      if (!isCronDue(recurrence.cron_expr, nowMs, lastSpawnedAtMs)) continue

      const dateSuffix = formatDateSuffix()
      const childTitle = `${template.title} - ${dateSuffix}`

      // Duplicate prevention: check if a child with this exact title already exists in the same project
      const existing = await dbGetOne<{ id: number }>(`
        SELECT id FROM tasks
        WHERE title = ? AND workspace_id = ? AND project_id = ?
        LIMIT 1
      `, [childTitle, template.workspace_id, template.project_id])
      if (existing) continue

      // Spawn child task
      const childMetadata = {
        recurrence: {
          parent_task_id: template.id,
          spawned_from_cron: recurrence.cron_expr,
        },
      }

      let childId: number | undefined

      await dbTransaction(async (conn) => {
        // Get project ticket number
        if (template.project_id) {
          await conn.execute(`
            UPDATE projects
            SET ticket_counter = ticket_counter + 1, updated_at = UNIX_TIMESTAMP()
            WHERE id = ? AND workspace_id = ?
          `, [template.project_id, template.workspace_id])
        }

        let ticketCounter: number | null = null
        if (template.project_id) {
          const [rows] = await conn.execute(
            `SELECT ticket_counter FROM projects WHERE id = ? AND workspace_id = ?`,
            [template.project_id, template.workspace_id]
          )
          const ticketRow = (rows as any[])[0] as { ticket_counter: number } | undefined
          ticketCounter = ticketRow?.ticket_counter ?? null
        }

        const [insertRes] = await conn.execute(`
          INSERT INTO tasks (
            title, description, status, priority, project_id, project_ticket_no,
            assigned_to, created_by, created_at, updated_at,
            tags, metadata, workspace_id
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
          childTitle,
          template.description,
          template.assigned_to ? 'assigned' : 'inbox',
          template.priority,
          template.project_id,
          ticketCounter,
          template.assigned_to,
          'scheduler',
          nowSec,
          nowSec,
          template.tags,
          JSON.stringify(childMetadata),
          template.workspace_id,
        ])

        childId = (insertRes as any).insertId

        // Update template: bump spawn count and last_spawned_at
        const updatedRecurrence = {
          ...recurrence,
          last_spawned_at: nowSec,
          spawn_count: (recurrence.spawn_count || 0) + 1,
        }
        const updatedMetadata = { ...metadata, recurrence: updatedRecurrence }
        await conn.execute(
          `UPDATE tasks SET metadata = ?, updated_at = ? WHERE id = ?`,
          [JSON.stringify(updatedMetadata), nowSec, template.id]
        )
      })

      if (childId !== undefined) {
        db_helpers.logActivity(
          'task_created',
          'task',
          childId,
          'scheduler',
          `Recurring task spawned: ${childTitle}`,
          { parent_task_id: template.id, cron_expr: recurrence.cron_expr },
          template.workspace_id,
        ).catch(() => {})
      }

      spawned++
    }

    return { ok: true, message: spawned > 0 ? `Spawned ${spawned} recurring task(s)` : 'No tasks due' }
  } catch (err: any) {
    logger.error({ err }, 'Recurring task spawn failed')
    return { ok: false, message: `Recurring spawn failed: ${err.message}` }
  }
}
