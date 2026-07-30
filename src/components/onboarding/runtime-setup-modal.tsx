'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { apiFetch, ApiError } from '@/lib/api-client'

interface RuntimeSetupModalProps {
  runtime: 'gateway' | 'claude' | 'external' | 'opencode'
  onClose: () => void
  onComplete: () => void
}

export function RuntimeSetupModal({ runtime, onClose, onComplete }: RuntimeSetupModalProps) {
  const SetupComponent = {
    gateway: GatewaySetup,
    claude: ClaudeSetup,
    external: ExternalSetup,
    opencode: OpenCodeSetup,
  }[runtime]

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center z-50 p-4" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="bg-card border border-border rounded-xl max-w-lg w-full max-h-[80vh] overflow-y-auto shadow-2xl shadow-black/30">
        <SetupComponent onClose={onClose} onComplete={onComplete} />
      </div>
    </div>
  )
}

function OpenCodeSetup({ onClose, onComplete }: { onClose: () => void; onComplete: () => void }) {
  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-lg font-semibold">Set Up OpenCode</h3>
          <p className="text-xs text-muted-foreground mt-0.5">OpenCode is detected locally and sessions are read from its local SQLite state store.</p>
        </div>
        <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground">
          <svg className="w-5 h-5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M4 4l8 8M12 4l-8 8" /></svg>
        </button>
      </div>
      <div className="p-4 rounded-lg border border-border/30 bg-secondary/20 text-sm text-muted-foreground space-y-2">
        <p>Mission Control reads OpenCode runtime status from the installed <code>opencode</code> CLI and scans session history from <code>~/.local/share/opencode/*.db</code>.</p>
        <p>Restart OpenCode or create a new OpenCode session if you want Mission Control to pick up fresh session activity immediately.</p>
      </div>
      <div className="flex justify-end mt-4">
        <Button size="sm" onClick={onComplete}>Done</Button>
      </div>
    </div>
  )
}

// ─── Gateway Setup ──────────────────────────────────────────────────────

function GatewaySetup({ onClose, onComplete }: { onClose: () => void; onComplete: () => void }) {
  const [step, setStep] = useState<'onboard' | 'verify' | 'done'>('onboard')
  const [running, setRunning] = useState(false)
  const [output, setOutput] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [healthStatus, setHealthStatus] = useState<any>(null)

  const runOnboard = useCallback(async () => {
    setRunning(true)
    setError(null)
    setOutput('')
    try {
      // The install result is intentionally ignored (same as the original
      // raw-fetch behavior, which checked neither .ok nor the body). The
      // onboard command runs as part of post-install in agent-runtimes.ts.
      // Swallow any error so we always proceed to the doctor health check.
      try {
        await apiFetch('/api/agent-runtimes', {
          method: 'POST',
          body: JSON.stringify({ action: 'install', runtime: 'gateway', mode: 'local' }),
        })
      } catch {
        // ignore — original code never inspected the install response
      }
      // Use the doctor endpoint to check health.
      try {
        const data = await apiFetch<{ healthy?: boolean; issues?: string[] }>('/api/gateway/doctor')
        setHealthStatus(data)
        if (data.healthy) {
          setStep('done')
        } else {
          setStep('verify')
          setOutput(data.issues?.join('\n') || 'Some issues detected')
        }
      } catch (doctorErr) {
        // Preserve graceful degradation: a non-ok doctor response previously
        // fell through to the verify step rather than surfacing an error.
        if (doctorErr instanceof ApiError) {
          setStep('verify')
        } else {
          throw doctorErr
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Setup failed')
    } finally {
      setRunning(false)
    }
  }, [])

  const runDoctorFix = useCallback(async () => {
    setRunning(true)
    setError(null)
    try {
      const data = await apiFetch<{ success?: boolean }>('/api/gateway/doctor', {
        method: 'POST',
        body: JSON.stringify({ confirmation: 'fix_gateway' }),
      })
      if (data.success) {
        setStep('done')
        setOutput('All issues resolved')
      } else {
        setOutput('Fix attempt completed with warnings')
      }
    } catch (err) {
      // Preserve graceful degradation: a non-ok response previously did
      // nothing (no error surfaced), so swallow ApiError here. Only genuine
      // failures (e.g. network) surface an error, as before.
      if (err instanceof ApiError) {
        // no-op — matches the original `if (res.ok)` with no else branch
      } else {
        setError(err instanceof Error ? err.message : 'Doctor fix failed')
      }
    } finally {
      setRunning(false)
    }
  }, [])

  const checkHealth = useCallback(async () => {
    try {
      const data = await apiFetch<{ healthy?: boolean }>('/api/gateway/doctor')
      setHealthStatus(data)
      if (data.healthy) setStep('done')
    } catch {
      // ignore — a non-ok/failed health check leaves state untouched,
      // matching the original `if (res.ok)` guard with an empty catch.
    }
  }, [])

  useEffect(() => { checkHealth() }, [checkHealth])

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-lg font-semibold">Set Up Gateway</h3>
          <p className="text-xs text-muted-foreground mt-0.5">Configure the gateway and verify connectivity</p>
        </div>
        <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground">
          <svg className="w-5 h-5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M4 4l8 8M12 4l-8 8" /></svg>
        </button>
      </div>

      {/* Step indicators */}
      <div className="flex items-center gap-2 mb-6">
        {(['onboard', 'verify', 'done'] as const).map((s, i) => (
          <div key={s} className="flex items-center gap-2">
            <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold ${
              step === s ? 'bg-primary text-primary-foreground' :
              (['onboard', 'verify', 'done'].indexOf(step) > i) ? 'bg-green-500/20 text-green-400' :
              'bg-secondary text-muted-foreground'
            }`}>
              {(['onboard', 'verify', 'done'].indexOf(step) > i) ? (
                <svg className="w-3 h-3" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M3 8.5l3.5 3.5 6.5-8" /></svg>
              ) : i + 1}
            </div>
            {i < 2 && <div className={`w-8 h-px ${(['onboard', 'verify', 'done'].indexOf(step) > i) ? 'bg-green-500/40' : 'bg-border/30'}`} />}
          </div>
        ))}
      </div>

      {step === 'onboard' && (
        <div className="space-y-4">
          <div className="p-4 rounded-lg border border-border/30 bg-secondary/20 space-y-3">
            <div className="flex items-start gap-3">
              <span className="text-lg">1</span>
              <div>
                <p className="text-sm font-medium">Health Check</p>
                <p className="text-xs text-muted-foreground">Verify gateway configuration and connectivity.</p>
              </div>
            </div>
          </div>

          {error && <p className="text-xs text-red-400">{error}</p>}

          {healthStatus?.healthy && (
            <div className="p-3 rounded-lg border border-green-500/30 bg-green-500/5 text-xs text-green-400">
              Gateway is healthy and properly configured.
            </div>
          )}

          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={onClose}>Skip</Button>
            <Button size="sm" onClick={runOnboard} disabled={running}>
              {running ? 'Checking...' : 'Run Health Check'}
            </Button>
          </div>
        </div>
      )}

      {step === 'verify' && (
        <div className="space-y-4">
          <div className="p-4 rounded-lg border border-amber-500/20 bg-amber-500/5 space-y-2">
            <p className="text-sm font-medium text-amber-400">Issues Detected</p>
            {healthStatus?.issues?.map((issue: string, i: number) => (
              <p key={i} className="text-xs text-muted-foreground">- {issue}</p>
            ))}
            {output && <pre className="text-xs text-muted-foreground/70 whitespace-pre-wrap mt-2">{output}</pre>}
          </div>

          {error && <p className="text-xs text-red-400">{error}</p>}

          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={onClose}>Skip for now</Button>
            <Button size="sm" onClick={runDoctorFix} disabled={running}>
              {running ? 'Fixing...' : 'Auto-Fix Issues'}
            </Button>
          </div>
        </div>
      )}

      {step === 'done' && (
        <div className="space-y-4">
          <div className="p-4 rounded-lg border border-green-500/30 bg-green-500/5 text-center space-y-2">
            <div className="text-2xl">+</div>
            <p className="text-sm font-medium text-green-400">Gateway is ready</p>
            <p className="text-xs text-muted-foreground">Gateway is configured and healthy. Agents can now connect.</p>
          </div>

          <div className="flex justify-end">
            <Button size="sm" onClick={onComplete}>Done</Button>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Claude Code Setup ──────────────────────────────────────────────────

function ClaudeSetup({ onClose, onComplete }: { onClose: () => void; onComplete: () => void }) {
  const [step, setStep] = useState<'check' | 'auth' | 'done'>('check')
  const [checking, setChecking] = useState(false)
  const [version, setVersion] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const checkAuth = useCallback(async () => {
    setChecking(true)
    setError(null)
    try {
      const data = await apiFetch<{ runtimes?: Array<{ id: string; version: string; authenticated?: boolean }> }>('/api/agent-runtimes')
      const claude = (data.runtimes || []).find((r) => r.id === 'claude')
      if (claude) {
        setVersion(claude.version)
        if (claude.authenticated) setStep('done')
        else setStep('auth')
      }
    } catch (err) {
      // Preserve graceful degradation: the original `if (res.ok)` guard left
      // state untouched on a non-ok response (no error surfaced). apiFetch
      // throws on 401/403/404/5xx, so swallow ApiError to match. Genuine
      // network/parse failures still surface "Check failed" as before.
      if (err instanceof ApiError) {
        // no-op — matches the original `if (res.ok)` with no else branch
      } else {
        setError(err instanceof Error ? err.message : 'Check failed')
      }
    } finally {
      setChecking(false)
    }
  }, [])

  useEffect(() => { checkAuth() }, [checkAuth])

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-lg font-semibold">Set Up Claude Code</h3>
          <p className="text-xs text-muted-foreground mt-0.5">Authenticate the Anthropic CLI agent</p>
        </div>
        <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground">
          <svg className="w-5 h-5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M4 4l8 8M12 4l-8 8" /></svg>
        </button>
      </div>

      {/* Step indicators */}
      <div className="flex items-center gap-2 mb-6">
        {(['check', 'auth', 'done'] as const).map((s, i) => {
          const labels = ['Check', 'Authenticate', 'Ready']
          const currentIdx = (['check', 'auth', 'done'] as const).indexOf(step)
          return (
            <div key={s} className="flex items-center gap-2">
              <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold ${
                step === s ? 'bg-primary text-primary-foreground' :
                currentIdx > i ? 'bg-green-500/20 text-green-400' :
                'bg-secondary text-muted-foreground'
              }`}>
                {currentIdx > i ? (
                  <svg className="w-3 h-3" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M3 8.5l3.5 3.5 6.5-8" /></svg>
                ) : i + 1}
              </div>
              <span className={`text-[10px] ${step === s ? 'text-foreground' : 'text-muted-foreground/40'}`}>{labels[i]}</span>
              {i < 2 && <div className={`w-4 h-px ${currentIdx > i ? 'bg-green-500/40' : 'bg-border/20'}`} />}
            </div>
          )
        })}
      </div>

      {step === 'check' && (
        <div className="space-y-4">
          <div className="p-4 rounded-lg border border-border/30 bg-secondary/20">
            <p className="text-sm font-medium">Checking authentication status...</p>
            <p className="text-xs text-muted-foreground mt-1">Verifying Claude Code credentials.</p>
          </div>
          {checking && <div className="flex items-center gap-2 text-xs text-muted-foreground"><div className="w-3 h-3 rounded-full border-2 border-primary/20 border-t-primary animate-spin" /> Checking...</div>}
          {error && <p className="text-xs text-red-400">{error}</p>}
        </div>
      )}

      {step === 'auth' && (
        <div className="space-y-4">
          <div className="p-4 rounded-lg border border-amber-500/20 bg-amber-500/5 space-y-3">
            <p className="text-sm font-medium text-amber-400">Authentication Required</p>
            <p className="text-xs text-muted-foreground">
              Claude Code {version ? `(v${version})` : ''} is installed but not authenticated.
            </p>
            <div className="p-3 rounded bg-black/20 border border-border/20">
              <p className="text-xs text-muted-foreground mb-1.5">Run this command in your terminal:</p>
              <code className="block font-mono text-sm text-foreground select-all">claude login</code>
            </div>
            <p className="text-xs text-muted-foreground">
              This opens a browser for OAuth login with your Anthropic account, or you can set <code className="text-[11px] bg-black/20 px-1 rounded">ANTHROPIC_API_KEY</code> in your environment.
            </p>
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={onClose}>Skip</Button>
            <Button size="sm" onClick={checkAuth} disabled={checking}>
              {checking ? 'Checking...' : 'I\'ve logged in — verify'}
            </Button>
          </div>
        </div>
      )}

      {step === 'done' && (
        <div className="space-y-4">
          <div className="p-4 rounded-lg border border-green-500/30 bg-green-500/5 text-center space-y-2">
            <div className="text-2xl">+</div>
            <p className="text-sm font-medium text-green-400">Claude Code is ready</p>
            <p className="text-xs text-muted-foreground">Authenticated and available for agent tasks.</p>
            {version && <p className="text-2xs text-muted-foreground/60">v{version}</p>}
          </div>
          <div className="flex justify-end">
            <Button size="sm" onClick={onComplete}>Done</Button>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── External CLI Setup ────────────────────────────────────────────────────

function ExternalSetup({ onClose, onComplete }: { onClose: () => void; onComplete: () => void }) {
  const [step, setStep] = useState<'check' | 'auth' | 'done'>('check')
  const [checking, setChecking] = useState(false)
  const [version, setVersion] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const checkAuth = useCallback(async () => {
    setChecking(true)
    setError(null)
    try {
      const data = await apiFetch<{ runtimes?: Array<{ id: string; version: string; authenticated?: boolean }> }>('/api/agent-runtimes')
      const external = (data.runtimes || []).find((r) => r.id === 'external')
      if (external) {
        setVersion(external.version)
        if (external.authenticated) setStep('done')
        else setStep('auth')
      }
    } catch (err) {
      // Preserve graceful degradation: the original `if (res.ok)` guard left
      // state untouched on a non-ok response (no error surfaced). apiFetch
      // throws on 401/403/404/5xx, so swallow ApiError to match. Genuine
      // network/parse failures still surface "Check failed" as before.
      if (err instanceof ApiError) {
        // no-op — matches the original `if (res.ok)` with no else branch
      } else {
        setError(err instanceof Error ? err.message : 'Check failed')
      }
    } finally {
      setChecking(false)
    }
  }, [])

  useEffect(() => { checkAuth() }, [checkAuth])

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-lg font-semibold">Set Up External CLI</h3>
          <p className="text-xs text-muted-foreground mt-0.5">Authenticate the OpenAI CLI agent</p>
        </div>
        <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground">
          <svg className="w-5 h-5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M4 4l8 8M12 4l-8 8" /></svg>
        </button>
      </div>

      {/* Step indicators */}
      <div className="flex items-center gap-2 mb-6">
        {(['check', 'auth', 'done'] as const).map((s, i) => {
          const labels = ['Check', 'Authenticate', 'Ready']
          const currentIdx = (['check', 'auth', 'done'] as const).indexOf(step)
          return (
            <div key={s} className="flex items-center gap-2">
              <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold ${
                step === s ? 'bg-primary text-primary-foreground' :
                currentIdx > i ? 'bg-green-500/20 text-green-400' :
                'bg-secondary text-muted-foreground'
              }`}>
                {currentIdx > i ? (
                  <svg className="w-3 h-3" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M3 8.5l3.5 3.5 6.5-8" /></svg>
                ) : i + 1}
              </div>
              <span className={`text-[10px] ${step === s ? 'text-foreground' : 'text-muted-foreground/40'}`}>{labels[i]}</span>
              {i < 2 && <div className={`w-4 h-px ${currentIdx > i ? 'bg-green-500/40' : 'bg-border/20'}`} />}
            </div>
          )
        })}
      </div>

      {step === 'check' && (
        <div className="space-y-4">
          <div className="p-4 rounded-lg border border-border/30 bg-secondary/20">
            <p className="text-sm font-medium">Checking authentication status...</p>
            <p className="text-xs text-muted-foreground mt-1">Verifying External CLI credentials.</p>
          </div>
          {checking && <div className="flex items-center gap-2 text-xs text-muted-foreground"><div className="w-3 h-3 rounded-full border-2 border-primary/20 border-t-primary animate-spin" /> Checking...</div>}
          {error && <p className="text-xs text-red-400">{error}</p>}
        </div>
      )}

      {step === 'auth' && (
        <div className="space-y-4">
          <div className="p-4 rounded-lg border border-amber-500/20 bg-amber-500/5 space-y-3">
            <p className="text-sm font-medium text-amber-400">Authentication Required</p>
            <p className="text-xs text-muted-foreground">
              External CLI {version ? `(v${version})` : ''} is installed but not authenticated.
            </p>
            <div className="p-3 rounded bg-black/20 border border-border/20">
              <p className="text-xs text-muted-foreground mb-1.5">Run this command in your terminal:</p>
              <code className="block font-mono text-sm text-foreground select-all">external auth</code>
            </div>
            <p className="text-xs text-muted-foreground">
              This authenticates with your OpenAI account, or you can set <code className="text-[11px] bg-black/20 px-1 rounded">OPENAI_API_KEY</code> in your environment.
            </p>
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={onClose}>Skip</Button>
            <Button size="sm" onClick={checkAuth} disabled={checking}>
              {checking ? 'Checking...' : 'I\'ve authenticated — verify'}
            </Button>
          </div>
        </div>
      )}

      {step === 'done' && (
        <div className="space-y-4">
          <div className="p-4 rounded-lg border border-green-500/30 bg-green-500/5 text-center space-y-2">
            <div className="text-2xl">+</div>
            <p className="text-sm font-medium text-green-400">External CLI is ready</p>
            <p className="text-xs text-muted-foreground">Authenticated and available for agent tasks.</p>
            {version && <p className="text-2xs text-muted-foreground/60">v{version}</p>}
          </div>
          <div className="flex justify-end">
            <Button size="sm" onClick={onComplete}>Done</Button>
          </div>
        </div>
      )}
    </div>
  )
}

function StatusCard({ label, ok, value, subtitle }: { label: string; ok?: boolean; value?: number; subtitle?: string }) {
  return (
    <div className={`p-2.5 rounded-lg border text-xs ${
      ok ? 'border-green-500/20 bg-green-500/5' : 'border-border/20 bg-secondary/10'
    }`}>
      <div className="flex items-center justify-between">
        <span className="text-muted-foreground">{label}</span>
        {value !== undefined ? (
          <span className="font-mono text-foreground">{value}</span>
        ) : (
          <span className={ok ? 'text-green-400' : 'text-muted-foreground/40'}>
            {ok ? '+' : '-'}
          </span>
        )}
      </div>
      {subtitle && <p className="text-[10px] text-muted-foreground/40 mt-0.5">{subtitle}</p>}
    </div>
  )
}
