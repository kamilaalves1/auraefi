import { dbGetAll } from '@/lib/db'

export async function queryPendingAssignments(agentId: string): Promise<Assignment[]> {
  try {
    const rows = await dbGetAll<{ id: number; title: string; description: string | null; priority: string }>(`
      SELECT id, title, description, priority
      FROM tasks
      WHERE (assigned_to = ? OR assigned_to IS NULL)
        AND status IN ('assigned', 'inbox')
      ORDER BY
        CASE priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 ELSE 4 END ASC,
        due_date ASC,
        created_at ASC
      LIMIT 5
    `, [agentId])

    return rows.map(row => ({
      taskId: String(row.id),
      description: row.title + (row.description ? `\n${row.description}` : ''),
      priority: row.priority === 'critical' ? 0 : row.priority === 'high' ? 1 : row.priority === 'medium' ? 2 : 3,
    }))
  } catch {
    return []
  }
}

export interface AgentRegistration {
  agentId: string
  name: string
  framework: string
  metadata?: Record<string, unknown>
}

export interface HeartbeatPayload {
  agentId: string
  status: string
  metrics?: Record<string, unknown>
}

export interface TaskReport {
  taskId: string
  agentId: string
  progress: number
  status: string
  output?: unknown
}

export interface Assignment {
  taskId: string
  description: string
  priority?: number
  metadata?: Record<string, unknown>
}

export interface FrameworkAdapter {
  readonly framework: string
  register(agent: AgentRegistration): Promise<void>
  heartbeat(payload: HeartbeatPayload): Promise<void>
  reportTask(report: TaskReport): Promise<void>
  getAssignments(agentId: string): Promise<Assignment[]>
  disconnect(agentId: string): Promise<void>
}
