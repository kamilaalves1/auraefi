'use client'

import { useCallback, useEffect, useState } from 'react'

export function useWorkspaceSquadActive() {
  const [squadActive, setSquadActive] = useState<boolean | null>(null)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/workspace/squad-state')
      const data = await res.json().catch(() => ({}))
      setSquadActive(!!data.squad_active)
    } catch {
      setSquadActive(false)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return { squadActive, squadActiveLoading: loading, refreshSquadState: refresh }
}
