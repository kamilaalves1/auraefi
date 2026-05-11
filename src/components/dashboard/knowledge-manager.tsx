'use client'

import { useState, useCallback, useEffect } from 'react'

/**
 * Knowledge Manager — Browse, search, and ingest knowledge into the vault
 *
 * Browse tab: Shows vault domains with file counts, expandable file lists
 * Ingest tab: Submit new knowledge with auto-classification
 */

type VaultFile = {
  name: string
  title: string
  size: number
  modified: string
}

type VaultDomain = {
  name: string
  fileCount: number
  totalSize: number
  recentFiles: VaultFile[]
}

type IngestResult = {
  status: string
  ref_id: number
  domain: string
  auto_classified: boolean
  filename: string
}

const DOMAIN_ICONS: Record<string, string> = {
  ai_ml: '🤖',
  business: '💼',
  cognitive_science: '🧠',
  film_production: '🎬',
  operations: '⚙️',
  safety_ethics: '🛡️',
  seo_web: '🌐',
  _incoming: '📥',
}

const DOMAIN_COLORS: Record<string, string> = {
  ai_ml: 'from-purple-500/20 to-purple-500/5 border-purple-500/20',
  business: 'from-blue-500/20 to-blue-500/5 border-blue-500/20',
  cognitive_science: 'from-pink-500/20 to-pink-500/5 border-pink-500/20',
  film_production: 'from-amber-500/20 to-amber-500/5 border-amber-500/20',
  operations: 'from-emerald-500/20 to-emerald-500/5 border-emerald-500/20',
  safety_ethics: 'from-red-500/20 to-red-500/5 border-red-500/20',
  seo_web: 'from-cyan-500/20 to-cyan-500/5 border-cyan-500/20',
  _incoming: 'from-zinc-500/20 to-zinc-500/5 border-zinc-500/20',
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

export function KnowledgeManager() {
  const [tab, setTab] = useState<'browse' | 'ingest'>('browse')
  const [domains, setDomains] = useState<VaultDomain[]>([])
  const [totalFiles, setTotalFiles] = useState(0)
  const [loading, setLoading] = useState(true)
  const [expandedDomain, setExpandedDomain] = useState<string | null>(null)
  const [expandedFiles, setExpandedFiles] = useState<VaultFile[]>([])

  // Ingest form state
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [source, setSource] = useState('dashboard')
  const [domainOverride, setDomainOverride] = useState('')
  const [ingesting, setIngesting] = useState(false)
  const [result, setResult] = useState<IngestResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  const fetchDomains = useCallback(async () => {
    try {
      const res = await fetch('http://127.0.0.1:3100/api/knowledge/browse')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setDomains(data.domains || [])
      setTotalFiles(data.totalFiles || 0)
    } catch {
      setDomains([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchDomains()
  }, [fetchDomains])

  const expandDomain = async (name: string) => {
    if (expandedDomain === name) {
      setExpandedDomain(null)
      return
    }
    setExpandedDomain(name)
    try {
      const res = await fetch(`http://127.0.0.1:3100/api/knowledge/browse?domain=${name}`)
      const data = await res.json()
      setExpandedFiles(data.domains?.[0]?.recentFiles || [])
    } catch {
      setExpandedFiles([])
    }
  }

  const handleIngest = async () => {
    if (!title.trim() || !content.trim()) return
    setIngesting(true)
    setError(null)
    setResult(null)

    try {
      const res = await fetch('http://127.0.0.1:3100/api/knowledge/ingest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          content: content.trim(),
          source: source.trim(),
          domain: domainOverride,
        }),
      })

      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || `HTTP ${res.status}`)
      }

      const data = await res.json()
      setResult(data)
      setTitle('')
      setContent('')
      setDomainOverride('')
      // Refresh domain counts
      fetchDomains()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ingestion failed')
    } finally {
      setIngesting(false)
    }
  }

  return (
    <div className="space-y-3">
      {/* Tab switch */}
      <div className="flex gap-1 p-0.5 rounded-lg bg-surface-1/50 w-fit">
        <button
          onClick={() => setTab('browse')}
          className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
            tab === 'browse' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          Browse ({totalFiles})
        </button>
        <button
          onClick={() => setTab('ingest')}
          className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
            tab === 'ingest' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          + Ingest
        </button>
      </div>

      {tab === 'browse' ? (
        /* Browse Tab */
        <div className="space-y-2">
          {loading ? (
            <div className="text-center py-8">
              <span className="text-xs text-muted-foreground animate-pulse">Loading vault...</span>
            </div>
          ) : domains.length === 0 ? (
            <div className="text-center py-8">
              <span className="text-xs text-muted-foreground">No domains found</span>
            </div>
          ) : (
            domains.map(domain => (
              <div key={domain.name} className="group">
                <button
                  onClick={() => expandDomain(domain.name)}
                  className={`w-full rounded-lg border bg-gradient-to-br ${DOMAIN_COLORS[domain.name] || DOMAIN_COLORS._incoming} px-3 py-2.5 text-left transition-all duration-200 hover:scale-[1.01]`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-base">{DOMAIN_ICONS[domain.name] || '📄'}</span>
                      <div>
                        <div className="text-xs font-medium text-foreground">{domain.name.replace(/_/g, ' ')}</div>
                        <div className="text-[10px] text-muted-foreground/50">
                          {domain.fileCount} files · {formatBytes(domain.totalSize)}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-mono text-muted-foreground/40">{domain.fileCount}</span>
                      <span className={`text-[10px] text-muted-foreground/30 transition-transform ${expandedDomain === domain.name ? 'rotate-180' : ''}`}>▼</span>
                    </div>
                  </div>
                </button>

                {/* Expanded file list */}
                {expandedDomain === domain.name && (
                  <div className="mt-1 ml-6 space-y-0.5 animate-in fade-in duration-200">
                    {expandedFiles.length === 0 ? (
                      <div className="text-[10px] text-muted-foreground/40 px-2 py-1">No files</div>
                    ) : (
                      expandedFiles.map((file, i) => (
                        <div key={i} className="flex items-center justify-between px-2 py-1 rounded text-[10px] hover:bg-surface-1/30">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="text-muted-foreground/30">📄</span>
                            <span className="text-muted-foreground truncate" title={file.title}>
                              {file.title}
                            </span>
                          </div>
                          <div className="flex items-center gap-2 text-muted-foreground/30 shrink-0 ml-2">
                            <span className="font-mono">{formatBytes(file.size)}</span>
                            <span>{timeAgo(file.modified)}</span>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      ) : (
        /* Ingest Tab */
        <div className="space-y-3">
          <div>
            <label className="text-[10px] text-muted-foreground/60 block mb-1">Title *</label>
            <input
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="e.g., Client Onboarding Best Practices"
              className="w-full rounded-md border border-border/40 bg-surface-1 px-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground/30 focus:outline-none focus:ring-1 focus:ring-primary/40"
            />
          </div>

          <div>
            <label className="text-[10px] text-muted-foreground/60 block mb-1">Content *</label>
            <textarea
              value={content}
              onChange={e => setContent(e.target.value)}
              placeholder="Paste knowledge content here..."
              rows={6}
              className="w-full rounded-md border border-border/40 bg-surface-1 px-3 py-1.5 text-xs text-foreground font-mono placeholder:text-muted-foreground/30 focus:outline-none focus:ring-1 focus:ring-primary/40 resize-y"
            />
            {content && (
              <div className="text-[9px] text-muted-foreground/30 mt-0.5">
                {content.length} chars · ~{Math.ceil(content.split(/\s+/).length)} words
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[10px] text-muted-foreground/60 block mb-1">Source</label>
              <input
                value={source}
                onChange={e => setSource(e.target.value)}
                placeholder="dashboard"
                className="w-full rounded-md border border-border/40 bg-surface-1 px-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground/30 focus:outline-none focus:ring-1 focus:ring-primary/40"
              />
            </div>
            <div>
              <label className="text-[10px] text-muted-foreground/60 block mb-1">Domain (auto if blank)</label>
              <select
                value={domainOverride}
                onChange={e => setDomainOverride(e.target.value)}
                className="w-full rounded-md border border-border/40 bg-surface-1 px-3 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary/40"
              >
                <option value="">Auto-classify</option>
                {Object.keys(DOMAIN_ICONS).map(d => (
                  <option key={d} value={d}>{DOMAIN_ICONS[d]} {d.replace(/_/g, ' ')}</option>
                ))}
              </select>
            </div>
          </div>

          <button
            onClick={handleIngest}
            disabled={ingesting || !title.trim() || !content.trim()}
            className="w-full rounded-md bg-primary py-2 text-xs font-semibold text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-40"
          >
            {ingesting ? 'Ingesting...' : '📥 Ingest to Sovereign Vault'}
          </button>

          {/* Result */}
          {result && (
            <div className="rounded-md border border-emerald-500/20 bg-emerald-500/5 p-3 animate-in fade-in">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-sm">✅</span>
                <span className="text-xs font-medium text-emerald-400">Ingested Successfully</span>
              </div>
              <div className="grid grid-cols-2 gap-1 text-[10px] text-muted-foreground">
                <span>Ref ID: <span className="font-mono text-foreground">{result.ref_id}</span></span>
                <span>Domain: <span className="font-mono text-foreground">{result.domain}</span></span>
                <span>File: <span className="font-mono text-foreground">{result.filename}</span></span>
                <span>{result.auto_classified ? '🤖 Auto-classified' : '📌 Manual domain'}</span>
              </div>
            </div>
          )}

          {error && (
            <div className="rounded-md border border-red-500/20 bg-red-500/5 p-2 text-xs text-red-400 animate-in fade-in">
              ⚠️ {error}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
