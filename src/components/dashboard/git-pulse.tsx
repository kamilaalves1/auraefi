'use client'

import { useState, useEffect, useCallback } from 'react'

/**
 * GitPulse — Repository activity + commit history
 */

type Repo = {
  name: string
  recentCommits: { hash: string; message: string }[]
  branchCount: number
  totalCommits: number
}

export function GitPulse() {
  const [repos, setRepos] = useState<Repo[]>([])
  const [loading, setLoading] = useState(true)
  const [activeRepo, setActiveRepo] = useState(0)

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch('http://127.0.0.1:3100/api/git')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setRepos(data.repos || [])
    } catch { /* silent */ }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  if (loading) return <div className="h-32 rounded-lg bg-surface-1/30 animate-pulse" />

  const repo = repos[activeRepo]
  const totalCommits = repos.reduce((s, r) => s + r.totalCommits, 0)
  const totalBranches = repos.reduce((s, r) => s + r.branchCount, 0)

  return (
    <div className="space-y-3">
      {/* Stats */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1.5">
          <span className="text-lg font-bold text-primary">{totalCommits}</span>
          <span className="text-[9px] text-muted-foreground/30">commits</span>
        </div>
        <div className="h-3 w-px bg-border/20" />
        <div className="flex items-center gap-1.5">
          <span className="text-sm font-bold text-foreground">{totalBranches}</span>
          <span className="text-[9px] text-muted-foreground/30">branches</span>
        </div>
        <div className="h-3 w-px bg-border/20" />
        <span className="text-[9px] text-muted-foreground/20">{repos.length} repos</span>
      </div>

      {/* Repo tabs */}
      <div className="flex gap-1">
        {repos.map((r, i) => (
          <button
            key={r.name}
            onClick={() => setActiveRepo(i)}
            className={`text-[9px] px-2 py-1 rounded-md transition-all ${
              i === activeRepo
                ? 'bg-primary/20 text-primary font-medium'
                : 'text-muted-foreground/30 hover:text-foreground/50'
            }`}
          >
            {r.name} ({r.totalCommits})
          </button>
        ))}
      </div>

      {/* Recent commits */}
      {repo && (
        <div className="space-y-0.5 max-h-[200px] overflow-y-auto scrollbar-thin pr-1">
          {repo.recentCommits.map((c, i) => (
            <div key={i} className="flex items-start gap-2 rounded px-1.5 py-1 hover:bg-surface-1/15 transition-colors">
              <code className="text-[8px] text-primary/50 font-mono mt-0.5 shrink-0">{c.hash.substring(0, 7)}</code>
              <span className="text-[9px] text-foreground/40 leading-tight">{c.message}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
