'use client'

import { useState, useEffect, useCallback } from 'react'

/**
 * IntelligencePanel — Email Lane + Intelligence Report
 *
 * Shows Amy's email monitoring status and the latest
 * intelligence report with component health scores.
 */

type IntelReport = {
  overall_score: number
  overall_status: string
  components: Record<string, { score: number; status: string; detail: string }>
  alerts: string[]
  timestamp: string
}

export function IntelligencePanel() {
  const [emailStatus, setEmailStatus] = useState<any>(null)
  const [report, setReport] = useState<IntelReport | null>(null)
  const [reportFile, setReportFile] = useState('')
  const [loading, setLoading] = useState(true)

  const fetchData = useCallback(async () => {
    try {
      const [emailRes, intelRes] = await Promise.all([
        fetch('http://127.0.0.1:3100/api/email/status'),
        fetch('http://127.0.0.1:3100/api/intelligence'),
      ])
      if (emailRes.ok) {
        setEmailStatus(await emailRes.json())
      }
      if (intelRes.ok) {
        const data = await intelRes.json()
        setReport(data.report)
        setReportFile(data.filename || '')
      }
    } catch {
      // Silent fail
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchData()
    const interval = setInterval(fetchData, 30000)
    return () => clearInterval(interval)
  }, [fetchData])

  if (loading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 animate-pulse">
        <div className="h-48 rounded-lg bg-surface-1/30" />
        <div className="h-48 rounded-lg bg-surface-1/30" />
      </div>
    )
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {/* Email Lane Status */}
      <section className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border">
          <span className="text-sm">📧</span>
          <h3 className="text-sm font-semibold text-foreground">Email Lane</h3>
          <span className="text-[10px] text-muted-foreground/40">IMAP monitor</span>
        </div>
        <div className="p-3 space-y-3">
          {/* IMAP Status */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="relative flex h-2.5 w-2.5">
                {emailStatus?.imapRunning ? (
                  <>
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-50" />
                    <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500" />
                  </>
                ) : (
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-zinc-500" />
                )}
              </span>
              <span className="text-xs text-foreground">IMAP Watcher</span>
            </div>
            <span className={`text-[10px] font-mono ${emailStatus?.imapRunning ? 'text-emerald-400' : 'text-zinc-500'}`}>
              {emailStatus?.imapRunning ? 'WATCHING' : 'IDLE'}
            </span>
          </div>

          {/* Counts */}
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-lg border border-border/20 bg-surface-1/20 px-3 py-2 text-center">
              <div className="text-lg font-bold text-foreground">{emailStatus?.draftCount ?? 0}</div>
              <div className="text-[9px] text-muted-foreground/40">Pending Drafts</div>
            </div>
            <div className="rounded-lg border border-border/20 bg-surface-1/20 px-3 py-2 text-center">
              <div className="text-lg font-bold text-foreground">{emailStatus?.outboxCount ?? 0}</div>
              <div className="text-[9px] text-muted-foreground/40">Sent (Outbox)</div>
            </div>
          </div>

          {/* Recent log */}
          {emailStatus?.recentLog?.length > 0 && (
            <div className="space-y-0.5">
              <div className="text-[9px] text-muted-foreground/30">Recent activity:</div>
              {emailStatus.recentLog.slice(-3).map((line: string, i: number) => (
                <div key={i} className="text-[9px] text-muted-foreground/40 font-mono truncate" title={line}>
                  {line}
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* Intelligence Report */}
      <section className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border">
          <span className="text-sm">🧠</span>
          <h3 className="text-sm font-semibold text-foreground">Intelligence Report</h3>
          <span className="text-[10px] text-muted-foreground/40">Latest analysis</span>
        </div>
        <div className="p-3 space-y-3">
          {report ? (
            <>
              {/* Overall score */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className={`text-2xl font-bold tabular-nums ${
                    report.overall_score >= 90 ? 'text-emerald-400' :
                    report.overall_score >= 60 ? 'text-amber-400' : 'text-red-400'
                  }`}>
                    {report.overall_score}
                  </div>
                  <div>
                    <div className={`text-xs font-medium ${
                      report.overall_score >= 90 ? 'text-emerald-400' :
                      report.overall_score >= 60 ? 'text-amber-400' : 'text-red-400'
                    }`}>
                      {report.overall_status}
                    </div>
                    <div className="text-[9px] text-muted-foreground/30">{report.timestamp}</div>
                  </div>
                </div>
                {report.alerts.length > 0 && (
                  <span className="text-[10px] text-red-400 font-medium">
                    ⚠ {report.alerts.length} alert{report.alerts.length > 1 ? 's' : ''}
                  </span>
                )}
              </div>

              {/* Component scores */}
              <div className="space-y-1">
                {Object.entries(report.components).map(([name, comp]) => (
                  <div key={name} className="flex items-center justify-between px-1 py-0.5">
                    <div className="flex items-center gap-1.5">
                      <span className={`h-1.5 w-1.5 rounded-full ${
                        comp.score >= 90 ? 'bg-emerald-500' :
                        comp.score >= 60 ? 'bg-amber-500' : 'bg-red-500'
                      }`} />
                      <span className="text-[10px] text-foreground">{name}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[9px] text-muted-foreground/40 truncate max-w-[120px]" title={comp.detail}>
                        {comp.detail}
                      </span>
                      <span className={`text-[10px] font-mono font-bold tabular-nums ${
                        comp.score >= 90 ? 'text-emerald-400' :
                        comp.score >= 60 ? 'text-amber-400' : 'text-red-400'
                      }`}>
                        {comp.score}
                      </span>
                    </div>
                  </div>
                ))}
              </div>

              {reportFile && (
                <div className="text-[8px] text-muted-foreground/20 font-mono">{reportFile}</div>
              )}
            </>
          ) : (
            <div className="text-center py-6">
              <div className="text-lg">📊</div>
              <div className="text-[10px] text-muted-foreground/30">No intelligence reports yet</div>
            </div>
          )}
        </div>
      </section>
    </div>
  )
}
