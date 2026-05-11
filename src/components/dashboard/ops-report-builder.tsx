'use client'

import { useState } from 'react'

/**
 * OpsReportBuilder — One-click operational report generator
 *
 * Phase 131: Fetches aggregated data from /api/ops-report
 * and downloads it as a markdown file.
 */

export function OpsReportBuilder() {
  const [loading, setLoading] = useState(false)
  const [lastGenerated, setLastGenerated] = useState<string | null>(null)
  const [preview, setPreview] = useState<string | null>(null)

  const generateReport = async () => {
    setLoading(true)
    try {
      const res = await fetch('http://127.0.0.1:3100/api/ops-report')
      const data = await res.json()
      const report = data.report || '# Report generation failed'
      setLastGenerated(data.generated_at)
      setPreview(report)

      // Trigger download
      const blob = new Blob([report], { type: 'text/markdown' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      const ts = new Date().toISOString().slice(0, 10)
      a.download = `amy-ops-report-${ts}.md`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch {
      setPreview('⚠️ Failed to generate report. Is the bridge running?')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-lg">📋</span>
            <h3 className="text-sm font-semibold text-foreground">Ops Report Builder</h3>
            <span className="px-1.5 py-0.5 rounded text-[9px] font-mono bg-violet-500/15 text-violet-300">
              1-click
            </span>
          </div>
          <p className="text-xs text-muted-foreground/70 mt-0.5 ml-7">
            Generate a full operational report — health, performance, council, logs
          </p>
        </div>

        <button
          onClick={generateReport}
          disabled={loading}
          className={`px-4 py-2 rounded-lg text-xs font-medium transition-all ${
            loading
              ? 'bg-violet-500/10 text-violet-300/50 cursor-wait'
              : 'bg-violet-500/20 text-violet-300 hover:bg-violet-500/30 hover:shadow-lg hover:shadow-violet-500/10 cursor-pointer'
          }`}
        >
          {loading ? (
            <span className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-full border-2 border-violet-400/30 border-t-violet-400 animate-spin" />
              Generating...
            </span>
          ) : (
            '⬇️ Generate & Download'
          )}
        </button>
      </div>

      {/* Last generated timestamp */}
      {lastGenerated && (
        <div className="text-[10px] text-muted-foreground/40 font-mono ml-7">
          Last generated: {new Date(lastGenerated).toLocaleString()}
        </div>
      )}

      {/* Preview */}
      {preview && (
        <div className="ml-7 p-3 rounded-lg bg-surface-1/40 border border-border/20 max-h-[200px] overflow-y-auto">
          <pre className="text-[11px] text-muted-foreground/80 whitespace-pre-wrap font-mono leading-relaxed">
            {preview.slice(0, 800)}
            {preview.length > 800 && '...'}
          </pre>
        </div>
      )}

      {/* Tip */}
      <div className="ml-7 px-3 py-1.5 rounded bg-surface-1/20 border border-border/10">
        <p className="text-[10px] text-muted-foreground/50 italic">
          💡 Downloads a .md file with Amy&apos;s health, log volumes, council activity, and performance summary. Share with your team or keep as records.
        </p>
      </div>
    </div>
  )
}
