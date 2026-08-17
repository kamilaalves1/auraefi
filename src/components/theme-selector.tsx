'use client'

import { useEffect, useState } from 'react'
import { getCurrentTheme, setTheme, type ThemeMode } from '@/lib/theme-config'
import { Button } from '@/components/ui/button'

export function ThemeSelector() {
  const [theme, setThemeState] = useState<ThemeMode>('system')
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
    setThemeState(getCurrentTheme())
  }, [])

  if (!mounted) return null

  const themes: Array<{ value: ThemeMode; label: string; icon: string }> = [
    { value: 'light', label: 'Claro', icon: '☀️' },
    { value: 'dark', label: 'Escuro', icon: '🌙' },
    { value: 'system', label: 'Sistema', icon: '🖥️' },
  ]

  return (
    <div className="flex items-center space-x-1 p-1 bg-secondary rounded-lg">
      {themes.map((t) => (
        <Button
          key={t.value}
          variant={theme === t.value ? 'default' : 'ghost'}
          size="sm"
          onClick={() => {
            setTheme(t.value)
            setThemeState(t.value)
          }}
          className="h-8 px-2 text-xs"
          title={t.label}
        >
          {t.icon}
        </Button>
      ))}
    </div>
  )
}
