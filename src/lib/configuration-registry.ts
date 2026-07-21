/**
 * Index of configurable areas — used by the Configuration hub panel.
 * Each entry maps to an existing nav panel or external doc expectation.
 */

export type ConfigurationArea = {
  id: string
  panel: string
  titleKey: string
  descriptionKey: string
}

export const CONFIGURATION_AREAS: ConfigurationArea[] = [
  { id: 'general', panel: 'settings', titleKey: 'areas.settings', descriptionKey: 'areas.settingsDesc' },
  { id: 'workspace-parameters', panel: 'workspace-parameters', titleKey: 'areas.workspaceParameters', descriptionKey: 'areas.workspaceParametersDesc' },
  { id: 'delivery-flow', panel: 'delivery-flow', titleKey: 'areas.deliveryFlow', descriptionKey: 'areas.deliveryFlowDesc' },
  { id: 'work-pipeline', panel: 'work-pipeline', titleKey: 'areas.workPipeline', descriptionKey: 'areas.workPipelineDesc' },
  { id: 'agents', panel: 'agents', titleKey: 'areas.agents', descriptionKey: 'areas.agentsDesc' },
  { id: 'pipelines', panel: 'agents', titleKey: 'areas.pipelines', descriptionKey: 'areas.pipelinesDesc' },
  { id: 'integrations', panel: 'integrations', titleKey: 'areas.integrations', descriptionKey: 'areas.integrationsDesc' },
  { id: 'gateway', panel: 'gateways', titleKey: 'areas.gateway', descriptionKey: 'areas.gatewayDesc' },
  { id: 'webhooks', panel: 'webhooks', titleKey: 'areas.webhooks', descriptionKey: 'areas.webhooksDesc' },
  { id: 'alerts', panel: 'alerts', titleKey: 'areas.alerts', descriptionKey: 'areas.alertsDesc' },
  { id: 'users', panel: 'users', titleKey: 'areas.users', descriptionKey: 'areas.usersDesc' },
  { id: 'audit', panel: 'audit', titleKey: 'areas.audit', descriptionKey: 'areas.auditDesc' },
]
