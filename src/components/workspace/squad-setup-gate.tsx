'use client'

import { useTranslations } from 'next-intl'
import { useNavigateToPanel } from '@/lib/navigation'
import { Button } from '@/components/ui/button'

type SquadSetupGateProps = {
  /** i18n key under `squadGate` for the short reason (e.g. flowLocked, pipelinesLocked) */
  reasonKey: 'flowLocked' | 'pipelinesLocked' | 'parametersLocked' | 'templatesLocked' | 'workPipelineLocked' | 'generic'
}

export function SquadSetupGate({ reasonKey }: SquadSetupGateProps) {
  const t = useTranslations('squadGate')
  const navigate = useNavigateToPanel()

  return (
    <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-6 text-center space-y-3 max-w-lg mx-auto my-4">
      <div className="text-sm font-semibold text-foreground">{t('title')}</div>
      <p className="text-xs text-muted-foreground leading-relaxed">{t(reasonKey)}</p>
      <ol className="text-left text-xs text-muted-foreground space-y-1.5 max-w-sm mx-auto list-decimal list-inside">
        <li>{t('step1')}</li>
        <li>{t('step2')}</li>
        <li>{t('step3')}</li>
      </ol>
      <Button type="button" size="sm" onClick={() => navigate('agents')}>
        {t('goAgents')}
      </Button>
    </div>
  )
}
