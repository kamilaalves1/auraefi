'use client'

import Image from 'next/image'
import { useEffect } from 'react'
import { useTranslations } from 'next-intl'
import { APP_VERSION } from '@/lib/version'

interface InitStep {
  key: string
  label: string
  status: 'pending' | 'done'
}

interface LoaderProps {
  variant?: 'page' | 'panel' | 'inline'
  label?: string
  steps?: InitStep[]
}

const LOADER_IMAGE_SOURCES = [
  '/brand/mc-logo-128.png',
] as const

function LoaderDots({ size = 'md' }: { size?: 'sm' | 'md' }) {
  const dotSize = size === 'sm' ? 'w-1 h-1' : 'w-1.5 h-1.5'
  return (
    <div className="flex items-center gap-1.5">
      <div className={`${dotSize} rounded-full bg-void-purple animate-pulse`} style={{ animationDelay: '0ms' }} />
      <div className={`${dotSize} rounded-full bg-void-purple animate-pulse`} style={{ animationDelay: '200ms' }} />
      <div className={`${dotSize} rounded-full bg-void-purple animate-pulse`} style={{ animationDelay: '400ms' }} />
    </div>
  )
}

function PageLoader({ steps }: { steps?: InitStep[] }) {
  const t = useTranslations('boot')
  useEffect(() => {
    const createdLinks: HTMLLinkElement[] = []

    for (const href of LOADER_IMAGE_SOURCES) {
      const existing = document.head.querySelector(`link[rel="preload"][href="${href}"]`)
      if (!existing) {
        const link = document.createElement('link')
        link.rel = 'preload'
        link.as = 'image'
        link.href = href
        document.head.appendChild(link)
        createdLinks.push(link)
      }

      const img = new window.Image()
      img.src = href
    }

    return () => {
      for (const link of createdLinks) {
        link.remove()
      }
    }
  }, [])

  const doneCount = steps?.filter(s => s.status === 'done').length ?? 0
  const totalCount = steps?.length ?? 1
  const progress = steps ? (doneCount / totalCount) * 100 : 0
  const allDone = steps ? doneCount === totalCount : false

  const activeStep = steps?.find(s => s.status === 'pending')

  return (
    <div
      className={`flex items-center justify-center min-h-screen bg-background dark:void-bg transition-opacity duration-300 ${allDone ? 'opacity-0' : 'opacity-100'}`}
    >
      <div className="flex flex-col items-center gap-8 w-64">
        {/* MC logo with ambient glow */}
        <div className="relative flex items-center justify-center h-28 w-full">
          <div className="absolute w-28 h-28 rounded-full bg-primary/8 blur-2xl animate-glow-pulse" />
          <div className="animate-float">
            <Image
              src="/brand/mc-logo-128.png"
              alt="Mission Control"
              width={56}
              height={56}
              priority
              fetchPriority="high"
              className="w-14 h-14"
            />
          </div>
        </div>

        {/* Title */}
        <div className="flex flex-col items-center gap-1">
          <h1 className="font-mono text-sm tracking-[0.2em] uppercase text-foreground font-medium">
            {t('missionControl')}
          </h1>
          <p className="text-2xs text-muted-foreground/60">
            {t('agentOrchestration')}
          </p>
        </div>

        {/* Progress section — appears after logo animation, only while loading */}
        {steps ? (
          <div
            className="w-full flex flex-col items-center gap-3 opacity-0"
            style={{ animation: 'mcFadeIn 0.6s ease-out 2.4s forwards' }}
          >
            {/* Progress bar */}
            <div className="w-full h-0.5 bg-border/50 rounded-full overflow-hidden">
              <div
                className="h-full bg-primary shimmer-bar rounded-full transition-all duration-500 ease-out"
                style={{ width: `${progress}%` }}
              />
            </div>

            {/* Active step label — crossfades on step change */}
            <div className="h-5 flex items-center justify-center">
              {activeStep && (
                <div
                  key={activeStep.key}
                  className="flex items-center gap-2"
                  style={{ animation: 'fadeIn 0.3s ease-out' }}
                >
                  <div className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
                  <span className="font-mono text-2xs tracking-wide text-muted-foreground">
                    {activeStep.label}
                  </span>
                </div>
              )}
            </div>
          </div>
        ) : (
          /* SSR fallback — no progress data yet */
          <LoaderDots />
        )}

        {/* Version */}
        <span className="text-2xs font-mono text-muted-foreground/40">
          v{APP_VERSION}
        </span>
      </div>
    </div>
  )
}

export function Loader({ variant = 'panel', label, steps }: LoaderProps) {
  if (variant === 'page') {
    return <PageLoader steps={steps} />
  }

  if (variant === 'inline') {
    return (
      <div className="flex items-center gap-2">
        <LoaderDots size="sm" />
        {label && <span className="text-sm text-muted-foreground">{label}</span>}
      </div>
    )
  }

  // panel (default)
  return (
    <div className="flex items-center justify-center py-12">
      <div className="flex flex-col items-center gap-3">
        <LoaderDots />
        {label && <span className="text-sm text-muted-foreground">{label}</span>}
      </div>
    </div>
  )
}
