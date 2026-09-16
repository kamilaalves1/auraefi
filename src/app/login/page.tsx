'use client'

import { useCallback, useEffect, useState, FormEvent } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { LanguageSwitcherSelect } from '@/components/ui/language-switcher'

type LoginRequestBody = { username: string; password: string }

type LoginErrorPayload = {
  code?: string
  error?: string
}

function readLoginErrorPayload(value: unknown): LoginErrorPayload {
  if (!value || typeof value !== 'object') return {}
  const record = value as Record<string, unknown>
  return {
    code: typeof record.code === 'string' ? record.code : undefined,
    error: typeof record.error === 'string' ? record.error : undefined,
  }
}

function MicrosoftIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none">
      <rect x="1" y="1" width="10.5" height="10.5" fill="#F25022" />
      <rect x="12.5" y="1" width="10.5" height="10.5" fill="#7FBA00" />
      <rect x="1" y="12.5" width="10.5" height="10.5" fill="#00A4EF" />
      <rect x="12.5" y="12.5" width="10.5" height="10.5" fill="#FFB900" />
    </svg>
  )
}

export default function LoginPage() {
  const t = useTranslations('auth')
  const tc = useTranslations('common')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [pendingApproval, setPendingApproval] = useState(false)
  const [needsSetup, setNeedsSetup] = useState(false)
  const [loading, setLoading] = useState(false)

  const azureClientId = process.env.NEXT_PUBLIC_AZURE_CLIENT_ID || ''

  // Redireciona para /setup se ainda não há nenhum usuário admin
  useEffect(() => {
    fetch('/api/setup')
      .then((res) => res.json())
      .then((data) => {
        if (data.needsSetup) {
          window.location.href = '/setup'
        }
      })
      .catch(() => {
        // best-effort
      })
  }, [])

  const completeLogin = useCallback(
    async (path: string, body: LoginRequestBody) => {
      const res = await fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      if (!res.ok) {
        const data = readLoginErrorPayload(await res.json().catch(() => null))
        if (data.code === 'PENDING_APPROVAL') {
          setPendingApproval(true)
          setNeedsSetup(false)
          setError('')
          setLoading(false)
          return false
        }
        if (data.code === 'NO_USERS') {
          setNeedsSetup(true)
          setError('')
          setLoading(false)
          return false
        }
        setError(data.error || t('loginFailed'))
        setPendingApproval(false)
        setNeedsSetup(false)
        setLoading(false)
        return false
      }

      window.location.href = '/'
      return true
    },
    [t]
  )

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)

    // Lê direto do DOM para capturar autopreenchimento do browser
    const form = e.target as HTMLFormElement
    const formUsername =
      (form.elements.namedItem('username') as HTMLInputElement)?.value || username
    const formPassword =
      (form.elements.namedItem('password') as HTMLInputElement)?.value || password

    try {
      await completeLogin('/api/auth/login', {
        username: formUsername,
        password: formPassword,
      })
    } catch {
      setError(t('networkError'))
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="absolute top-4 right-4">
        <LanguageSwitcherSelect />
      </div>
      <div className="w-full max-w-sm">
        {/* Logo + título */}
        <div className="flex flex-col items-center mb-8">
          <div className="w-14 h-14 rounded-2xl overflow-hidden flex items-center justify-center mb-4">
            <img
              src="/brand/aura-icon.svg"
              alt="AURA logo"
              width={56}
              height={56}
              className="h-full w-full object-cover"
            />
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            {t('missionControl')}
          </h1>
          <p className="text-xs text-muted-foreground/60 mt-0.5 uppercase tracking-widest font-medium">
            Banco Efí · IA Operations
          </p>
          <p className="text-sm text-muted-foreground mt-2">{t('signInToContinue')}</p>
        </div>

        {/* Aprovação pendente */}
        {pendingApproval && (
          <div className="mb-4 p-4 rounded-lg bg-amber-500/10 border border-amber-500/20 text-center">
            <div className="flex justify-center mb-2">
              <svg
                className="w-8 h-8 text-amber-400"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="12" cy="12" r="10" />
                <polyline points="12,6 12,12 16,14" />
              </svg>
            </div>
            <div className="text-sm font-medium text-amber-200">
              {t('accessRequestSubmitted')}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {t('accessRequestDescription')}
            </p>
            <Button
              onClick={() => {
                setPendingApproval(false)
                setError('')
              }}
              variant="ghost"
              size="sm"
              className="mt-3 text-xs"
            >
              {t('tryAgain')}
            </Button>
          </div>
        )}

        {/* Sem admin ainda */}
        {needsSetup && (
          <div className="mb-4 p-4 rounded-lg bg-blue-500/10 border border-blue-500/20 text-center">
            <div className="flex justify-center mb-2">
              <svg
                className="w-8 h-8 text-blue-400"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
            </div>
            <div className="text-sm font-medium text-blue-200">{t('noAdminAccount')}</div>
            <p className="text-xs text-muted-foreground mt-1">{t('noAdminDescription')}</p>
            <Button
              onClick={() => {
                window.location.href = '/setup'
              }}
              size="sm"
              className="mt-3"
            >
              {t('createAdminAccount')}
            </Button>
          </div>
        )}

        {/* Erro */}
        {error && (
          <div
            role="alert"
            className="mb-4 p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-sm text-destructive"
          >
            {error}
          </div>
        )}

        {/* Botão Azure AD / Microsoft SSO */}
        <div className={pendingApproval ? 'opacity-50 pointer-events-none mb-3' : 'mb-3'}>
          <div title={!azureClientId ? 'SSO com Azure AD — configuração pendente' : undefined}>
            <button
              type="button"
              disabled={!azureClientId || loading}
              onClick={() => {
                if (azureClientId) window.location.href = '/api/auth/azure/login'
              }}
              className="w-full h-10 flex items-center justify-center gap-3 rounded-lg border border-border bg-[#0078d4] hover:bg-[#106ebe] text-white text-sm font-medium focus:outline-none focus:ring-2 focus:ring-[#0078d4]/50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:bg-secondary disabled:text-muted-foreground disabled:border-border"
            >
              <MicrosoftIcon className="w-[18px] h-[18px]" />
              {azureClientId ? 'Entrar com Microsoft' : 'Entrar com Microsoft (em breve)'}
            </button>
          </div>
        </div>

        {/* Divisor */}
        <div className="my-4 flex items-center gap-2">
          <div className="h-px flex-1 bg-border" />
          <span className="text-xs text-muted-foreground">{tc('or')}</span>
          <div className="h-px flex-1 bg-border" />
        </div>

        {/* Formulário local (admin) */}
        <form
          onSubmit={handleSubmit}
          className={`space-y-4 ${pendingApproval ? 'opacity-50 pointer-events-none' : ''}`}
        >
          <div>
            <label
              htmlFor="username"
              className="block text-sm font-medium text-foreground mb-1.5"
            >
              {t('username')}
            </label>
            <input
              id="username"
              type="text"
              name="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full h-10 px-3 rounded-lg bg-secondary border border-border text-foreground text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-smooth"
              placeholder={t('enterUsername')}
              autoComplete="username"
              autoFocus
              required
              aria-required="true"
            />
          </div>

          <div>
            <label
              htmlFor="password"
              className="block text-sm font-medium text-foreground mb-1.5"
            >
              {t('password')}
            </label>
            <input
              id="password"
              type="password"
              name="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full h-10 px-3 rounded-lg bg-secondary border border-border text-foreground text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-smooth"
              placeholder={t('enterPassword')}
              autoComplete="current-password"
              required
              aria-required="true"
            />
          </div>

          <Button
            type="submit"
            disabled={loading}
            size="lg"
            className="w-full rounded-lg"
          >
            {loading ? (
              <>
                <div className="w-4 h-4 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />
                {t('signingIn')}
              </>
            ) : (
              t('signIn')
            )}
          </Button>
        </form>

        <p className="text-center text-xs text-muted-foreground mt-6">
          {t('orchestrationTagline')}
        </p>
      </div>
    </div>
  )
}
