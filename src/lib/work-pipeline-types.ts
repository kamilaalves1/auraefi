export type WorkPipelineProvider = 'none' | 'jira' | 'azure_devops'

export interface WorkPipelineConfigJson {
  /** JIRA Cloud / Server base, e.g. https://yourco.atlassian.net */
  jiraHost?: string
  jiraProjectKey?: string
  /** Atlassian account email (JIRA Cloud API token auth) */
  jiraAccountEmail?: string
  /** Optional JQL; default uses project + open statuses */
  jiraJql?: string
  /** e.g. https://dev.azure.com/myorg or https://myorg.visualstudio.com */
  azureOrganizationUrl?: string
  /** Azure DevOps project name */
  azureProject?: string
}

export interface WorkPipelineSecrets {
  /** @deprecated migrated to config.jiraAccountEmail; still read for old rows */
  jiraEmail?: string
  jiraApiToken?: string
  azurePat?: string
}

export interface NormalizedBacklogItem {
  externalId: string
  title: string
  description: string
  state: string
  type: string
  url: string
  /** Raw provider payload for advanced agent tooling */
  raw?: Record<string, unknown>
}
