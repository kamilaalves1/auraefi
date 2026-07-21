/**
 * Client-specific delivery flow (BPMN / Bizagi-style intent): stages, actors, push vs pull handoffs,
 * optional mapping to JIRA statuses. Stored per workspace in `workspace_delivery_flows`.
 */

export const DELIVERY_FLOW_VERSION = 1 as const

export type HandoffMode = 'push' | 'pull'

/** Declared keys for {{placeholders}} in stages and in workflow template prompts */
export interface DeliveryFlowParameterDefinition {
  key: string
  label?: string
  description?: string
  /** Fills {{key}} when workspace value is empty */
  defaultValue?: string
}

export interface DeliveryFlowStage {
  id: string
  label: string
  /** Optional link to JIRA/Azure column or status name */
  jiraStatus?: string
  /** Actor: agent role, squad lane, or human team name */
  actorRole: string
  /** Optional link to an MC agent (squad member) responsible for this column */
  linkedAgentId?: number | null
  /** Optional squad: multiple agents that may own work in this column (first is also mirrored in linkedAgentId for compatibility) */
  linkedAgentIds?: number[]
  /** push = work is assigned forward (empurra); pull = next actor takes when ready (puxa) */
  handoff: HandoffMode
  notes?: string
  /** Prompt / checklist for agents when they pick up a card in this column (shown in Mission Control + future card UI) */
  agentInstructions?: string
}

export interface DeliveryFlowTransition {
  from: string
  to: string
  label?: string
}

export interface DeliveryFlowDefinition {
  version: typeof DELIVERY_FLOW_VERSION
  name: string
  description?: string
  /** Keys used as {{key}} in stage fields; defaults apply before workspace Parameters panel */
  parameterDefinitions?: DeliveryFlowParameterDefinition[]
  stages: DeliveryFlowStage[]
  transitions?: DeliveryFlowTransition[]
  /**
   * When an issue in JIRA/Azure matches this stage's `jiraStatus` column, Mission Control treats the item as
   * having entered the delivery journey (same board semantics as JIRA). Automation/webhooks can use this later.
   */
  triggerStageId?: string
}

export type GitProvider = 'github' | 'gitlab' | 'bitbucket'

/** A named, reusable git repository configuration managed in "Repositórios Git" */
export interface GitRepository {
  id: number
  workspace_id: number
  name: string
  provider: GitProvider
  repo_url: string
  branch: string
  /** Optional per-repo token — overrides the global env-var token */
  access_token?: string | null
  /** GitLab self-hosted base URL, e.g. https://gitlab.mycompany.com */
  base_url?: string | null
  is_active: boolean
  created_at: number
  updated_at: number
}

export interface DeliveryFlow {
  id: number
  workspace_id: number
  name: string
  /** FK to git_repositories.id — the linked repo for this flow */
  git_repository_id?: number | null
  /** Denormalised from git_repositories for convenience */
  git_repository?: GitRepository | null
  is_active: boolean
  definition: DeliveryFlowDefinition
  created_at: number
  updated_at: number
  updated_by?: string | null
}

export function defaultDeliveryFlowDefinition(): DeliveryFlowDefinition {
  return {
    version: DELIVERY_FLOW_VERSION,
    name: '',
    description: '',
    parameterDefinitions: [],
    stages: [],
    transitions: [],
  }
}

export function parseDeliveryFlowJson(raw: string | null | undefined): DeliveryFlowDefinition {
  if (!raw) return defaultDeliveryFlowDefinition()
  try {
    const o = JSON.parse(raw) as Partial<DeliveryFlowDefinition>
    if (o.version !== DELIVERY_FLOW_VERSION || !Array.isArray(o.stages)) {
      return defaultDeliveryFlowDefinition()
    }
    const parameterDefinitions: DeliveryFlowParameterDefinition[] = Array.isArray(o.parameterDefinitions)
      ? o.parameterDefinitions
          .map((p) => ({
            key: typeof p.key === 'string' ? p.key.replace(/\s+/g, '_').slice(0, 80) : '',
            label: typeof p.label === 'string' ? p.label.slice(0, 200) : undefined,
            description: typeof p.description === 'string' ? p.description.slice(0, 500) : undefined,
            defaultValue: typeof p.defaultValue === 'string' ? p.defaultValue.slice(0, 4000) : undefined,
          }))
          .filter((p) => /^[a-zA-Z][a-zA-Z0-9_.-]*$/.test(p.key))
      : []
    return {
      version: DELIVERY_FLOW_VERSION,
      name: typeof o.name === 'string' ? o.name : '',
      description: typeof o.description === 'string' ? o.description : '',
      parameterDefinitions,
      triggerStageId: typeof o.triggerStageId === 'string' && o.triggerStageId.length > 0 ? o.triggerStageId.slice(0, 80) : undefined,
      stages: o.stages.map((s, i) => {
        const linkedAgentId =
          typeof s.linkedAgentId === 'number' && Number.isFinite(s.linkedAgentId) && s.linkedAgentId > 0
            ? s.linkedAgentId
            : undefined
        let linkedAgentIds: number[] | undefined
        if (Array.isArray(s.linkedAgentIds)) {
          linkedAgentIds = [...new Set(s.linkedAgentIds.filter((n) => typeof n === 'number' && Number.isFinite(n) && n > 0) as number[])].sort(
            (a, b) => a - b,
          )
          if (linkedAgentIds.length === 0) linkedAgentIds = undefined
        }
        if (!linkedAgentIds && linkedAgentId) linkedAgentIds = [linkedAgentId]
        const primary = linkedAgentIds?.[0] ?? linkedAgentId
        return {
          id: typeof s.id === 'string' ? s.id : `stage-${i}`,
          label: typeof s.label === 'string' ? s.label : `Stage ${i + 1}`,
          jiraStatus: typeof s.jiraStatus === 'string' ? s.jiraStatus : undefined,
          actorRole: typeof s.actorRole === 'string' ? s.actorRole : '',
          linkedAgentId: primary,
          linkedAgentIds,
          handoff: s.handoff === 'pull' ? 'pull' : 'push',
          notes: typeof s.notes === 'string' ? s.notes : undefined,
          agentInstructions: typeof s.agentInstructions === 'string' ? s.agentInstructions.slice(0, 4000) : undefined,
        }
      }),
      transitions: Array.isArray(o.transitions) ? (o.transitions as DeliveryFlowTransition[]) : undefined,
    }
  } catch {
    return defaultDeliveryFlowDefinition()
  }
}
