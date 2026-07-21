'use client'

import { useTranslations } from 'next-intl'
import { useNavigateToPanel } from '@/lib/navigation'
import { CONFIGURATION_AREAS } from '@/lib/configuration-registry'
import { Button } from '@/components/ui/button'
import { useWorkspaceSquadActive } from '@/lib/use-workspace-squad-active'

export function ConfigurationHubPanel() {
  const t = useTranslations('configuration')
  const navigate = useNavigateToPanel()
  const { squadActive, squadActiveLoading } = useWorkspaceSquadActive()

  return (
    <div className="p-4 max-w-3xl mx-auto space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-foreground">{t('title')}</h2>
        <p className="text-sm text-muted-foreground mt-1">{t('subtitle')}</p>
      </div>

      {!squadActiveLoading && squadActive === false && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-100/90">
          {t('hubSquadNotice')}
        </div>
      )}

      <ul className="space-y-2">
        {CONFIGURATION_AREAS.map((area) => (
          <li
            key={area.id}
            className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 rounded-lg border border-border bg-card p-3"
          >
            <div className="min-w-0">
              <div className="text-sm font-medium text-foreground">{t(area.titleKey)}</div>
              <div className="text-xs text-muted-foreground mt-0.5">{t(area.descriptionKey)}</div>
            </div>
            <Button type="button" size="sm" variant="secondary" className="shrink-0" onClick={() => navigate(area.panel)}>
              {t('open')}
            </Button>
          </li>
        ))}
      </ul>
    </div>
  )
}
