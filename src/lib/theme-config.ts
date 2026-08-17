export type ThemeMode = 'light' | 'dark' | 'system'

interface ThemeColors {
  light: Record<string, string>
  dark: Record<string, string>
}

export const themeColors: ThemeColors = {
  light: {
    background: '#ffffff',
    foreground: '#0f172a',
    card: '#f8fafc',
    border: '#e2e8f0',
    primary: '#3b82f6',
    'primary-foreground': '#ffffff',
    secondary: '#f1f5f9',
    'muted-foreground': '#64748b',
    accent: '#06b6d4',
    destructive: '#ef4444',
    success: '#10b981',
    warning: '#f59e0b',
  },
  dark: {
    background: '#0f172a',
    foreground: '#f1f5f9',
    card: '#1e293b',
    border: '#334155',
    primary: '#3b82f6',
    'primary-foreground': '#0f172a',
    secondary: '#1e293b',
    'muted-foreground': '#94a3b8',
    accent: '#06b6d4',
    destructive: '#ef4444',
    success: '#10b981',
    warning: '#f59e0b',
  },
}

export function applyTheme(mode: ThemeMode, htmlElement: HTMLElement) {
  const isDark = mode === 'dark' ||
    (mode === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)

  const colors = isDark ? themeColors.dark : themeColors.light

  Object.entries(colors).forEach(([key, value]) => {
    htmlElement.style.setProperty(`--color-${key}`, value)
  })

  htmlElement.setAttribute('data-theme', isDark ? 'dark' : 'light')
}

export function initializeTheme(mode: ThemeMode = 'system') {
  if (typeof window !== 'undefined') {
    const htmlElement = document.documentElement
    applyTheme(mode, htmlElement)

    if (mode === 'system') {
      window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
        applyTheme('system', htmlElement)
      })
    }
  }
}

export function getCurrentTheme(): ThemeMode {
  if (typeof window === 'undefined') return 'light'

  const stored = localStorage.getItem('theme-mode') as ThemeMode | null
  if (stored) return stored

  return 'system'
}

export function setTheme(mode: ThemeMode) {
  localStorage.setItem('theme-mode', mode)
  if (typeof window !== 'undefined') {
    applyTheme(mode, document.documentElement)
  }
}
