import { dbGetOne } from '@/lib/db'
import { parseDeliveryFlowJson } from '@/lib/delivery-flow-types'
import { parseStringRecordJson } from '@/lib/parameter-substitution'

/** Defaults from delivery flow parameterDefinitions + values from workspace_parameters table */
export async function loadParameterResolutionBase(
  workspaceId: number
): Promise<{ defDefaults: Record<string, string>; workspaceValues: Record<string, string> }> {
  const flowRow = await dbGetOne<{ definition_json: string }>(
    'SELECT definition_json FROM workspace_delivery_flows WHERE workspace_id = ?',
    [workspaceId]
  )
  const def = parseDeliveryFlowJson(flowRow?.definition_json)
  const defDefaults: Record<string, string> = {}
  for (const p of def.parameterDefinitions ?? []) {
    if (p.defaultValue !== undefined && p.defaultValue !== '') defDefaults[p.key] = p.defaultValue
  }
  const paramRow = await dbGetOne<{ values_json: string }>(
    'SELECT values_json FROM workspace_parameters WHERE workspace_id = ?',
    [workspaceId]
  )
  const workspaceValues = parseStringRecordJson(paramRow?.values_json)
  return { defDefaults, workspaceValues }
}
