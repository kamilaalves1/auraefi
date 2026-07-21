export interface TemplatePick {
  id: number
  name: string
}

/** First two templates by stable id order — enough for a minimal default pipeline. */
export function defaultPipelineStepsFromTemplates(templates: TemplatePick[]): Array<{
  template_id: number
  template_name: string
  on_failure: 'stop'
}> {
  if (templates.length < 2) return []
  const sorted = [...templates].sort((a, b) => a.id - b.id)
  return [
    { template_id: sorted[0].id, template_name: sorted[0].name, on_failure: 'stop' as const },
    { template_id: sorted[1].id, template_name: sorted[1].name, on_failure: 'stop' as const },
  ]
}
