import { getDatabase } from '@/lib/db'
import { parseDeliveryFlowJson } from '@/lib/delivery-flow-types'
import { parseStringRecordJson } from '@/lib/parameter-substitution'

type McDb = ReturnType<typeof getDatabase>

/** Defaults from delivery flow parameterDefinitions + values from workspace_parameters table */
export function loadParameterResolutionBase(
  db: McDb,
  workspaceId: number
): { defDefaults: Record<string, string>; workspaceValues: Record<string, string> } {
  const flowRow = db
    .prepare('SELECT definition_json FROM workspace_delivery_flows WHERE workspace_id = ?')
    .get(workspaceId) as { definition_json: string } | undefined
  const def = parseDeliveryFlowJson(flowRow?.definition_json)
  const defDefaults: Record<string, string> = {}
  for (const p of def.parameterDefinitions ?? []) {
    if (p.defaultValue !== undefined && p.defaultValue !== '') defDefaults[p.key] = p.defaultValue
  }
  const paramRow = db
    .prepare('SELECT values_json FROM workspace_parameters WHERE workspace_id = ?')
    .get(workspaceId) as { values_json: string } | undefined
  const workspaceValues = parseStringRecordJson(paramRow?.values_json)
  return { defDefaults, workspaceValues }
}
