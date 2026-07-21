import type { DeliveryFlowDefinition, DeliveryFlowStage, DeliveryFlowTransition } from '@/lib/delivery-flow-types'
import { DELIVERY_FLOW_VERSION } from '@/lib/delivery-flow-types'

/** One edge per consecutive pair (visual flow arrows). */
export function buildLinearTransitions(stages: DeliveryFlowStage[]): DeliveryFlowTransition[] {
  const out: DeliveryFlowTransition[] = []
  for (let i = 0; i < stages.length - 1; i++) {
    out.push({ from: stages[i].id, to: stages[i + 1].id })
  }
  return out
}

export type DefaultDeliveryFlowCopy = {
  flowName: string
  flowDescription: string
  /** When backlog state matches this stage's JIRA/Azure column, the delivery journey is considered to start */
  triggerStageId?: string
  stages: Array<{
    id: string
    label: string
    jiraStatus: string
    actorRole: string
    handoff: 'push' | 'pull'
    notes?: string
  }>
}

/** Typical JIRA-style linear board — copy must already be translated. */
export function createDefaultDeliveryFlowDefinition(copy: DefaultDeliveryFlowCopy): DeliveryFlowDefinition {
  const stages: DeliveryFlowStage[] = copy.stages.map((s) => ({
    id: s.id,
    label: s.label,
    jiraStatus: s.jiraStatus,
    actorRole: s.actorRole,
    handoff: s.handoff,
    notes: s.notes,
    linkedAgentId: undefined,
  }))
  const tid = copy.triggerStageId
  const triggerStageId = tid && stages.some((st) => st.id === tid) ? tid : undefined
  return {
    version: DELIVERY_FLOW_VERSION,
    name: copy.flowName,
    description: copy.flowDescription,
    parameterDefinitions: [],
    stages,
    transitions: buildLinearTransitions(stages),
    triggerStageId,
  }
}
