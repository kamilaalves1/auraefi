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
  /** LLM provider: 'anthropic' | 'ollama' (defaults to 'anthropic') */
  llm_simple?: string
  llm_medium?: string
  llm_complex?: string
  /** Ollama base URL (default: http://localhost:11434) */
  ollamaHost?: string
  /** Ollama model override — used when provider is ollama and agent model is not set or is a Claude model */
  ollamaModel?: string
  /**
   * The @mention name the engine responds to in JIRA/Azure comments.
   * Example: "@pipeline" → user types "@pipeline reprocesse com foco em segurança"
   * Defaults to "@pipeline" if not set.
   */
  botMention?: string
  /** Fallback behaviour when primary LLM call fails: 'none' | 'fixed' | 'cascade' */
  llm_fallback_mode?: string
  /** Model string for 'fixed' fallback mode (e.g. "openai:gpt-4o-mini") */
  llm_fallback_model?: string
  /** Max additional attempts for fallback (default 2) */
  llm_fallback_max_attempts?: string
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
