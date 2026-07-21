/** Placeholders: {{param_key}} — keys are [a-zA-Z][a-zA-Z0-9_.-]* */

const PLACEHOLDER = /\{\{\s*([a-zA-Z][a-zA-Z0-9_.-]*)\s*\}\}/g

export function applyParameterSubstitution(text: string, params: Record<string, string>): string {
  return text.replace(PLACEHOLDER, (_, key: string) => {
    const v = params[key]
    return v !== undefined && v !== '' ? String(v) : `{{${key}}}`
  })
}

/** Later layers override earlier: defaults < workspace < pipeline < step */
export function mergeParameterLayers(
  definitionDefaults: Record<string, string>,
  workspace: Record<string, string>,
  pipeline: Record<string, string>,
  step: Record<string, string>
): Record<string, string> {
  return { ...definitionDefaults, ...workspace, ...pipeline, ...step }
}

export function parseStringRecordJson(raw: string | null | undefined): Record<string, string> {
  if (!raw || raw === '{}') return {}
  try {
    const o = JSON.parse(raw) as unknown
    if (!o || typeof o !== 'object' || Array.isArray(o)) return {}
    const out: Record<string, string> = {}
    for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
      if (typeof k !== 'string' || k.length === 0 || k.length > 80) continue
      if (typeof v === 'string') out[k] = v.slice(0, 4000)
      else if (v !== null && v !== undefined) out[k] = String(v).slice(0, 4000)
    }
    return out
  } catch {
    return {}
  }
}

/** Accept client_metadata.parameters as object of strings or JSON string */
export function extractPipelineParameters(meta: Record<string, unknown> | undefined): Record<string, string> {
  if (!meta) return {}
  const p = meta.parameters
  if (!p) return {}
  if (typeof p === 'string') return parseStringRecordJson(p)
  if (typeof p === 'object' && !Array.isArray(p)) {
    const out: Record<string, string> = {}
    for (const [k, v] of Object.entries(p as Record<string, unknown>)) {
      if (typeof k !== 'string' || k.length > 80) continue
      if (typeof v === 'string') out[k] = v.slice(0, 4000)
    }
    return out
  }
  return {}
}
