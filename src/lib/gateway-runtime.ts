/**
 * Returns the gateway auth credential (token or password) for Bearer/WS auth.
 * Env overrides: GATEWAY_TOKEN, GATEWAY_PASSWORD (also accepts legacy OPENCLAW_GATEWAY_* prefixes).
 */
export function getDetectedGatewayToken(): string {
  const envToken = (process.env.GATEWAY_TOKEN || process.env.OPENCLAW_GATEWAY_TOKEN || '').trim()
  if (envToken) return envToken

  const envPassword = (process.env.GATEWAY_PASSWORD || process.env.OPENCLAW_GATEWAY_PASSWORD || '').trim()
  if (envPassword) return envPassword

  return ''
}

export function getDetectedGatewayPort(): number | null {
  const envPort = Number(process.env.GATEWAY_PORT || process.env.OPENCLAW_GATEWAY_PORT || '')
  if (Number.isFinite(envPort) && envPort > 0) return envPort
  return null
}
