'use client'

import { useEffect, useState, useCallback } from 'react'

/**
 * ApprovalGate — Review and decide on Amy's pending proposals
 * 
 * Fetches from Amy API Bridge (:3100/api/approvals) and provides
 * approve/reject actions directly from the dashboard.
 */

type Proposal = {
  proposal_id: string
  action: string
  tier: number
  timestamp: string
  summary?: string
  source?: string
  auto?: boolean
  details?: Record<string, unknown>
}

const TIER_LABELS: Record<number, { label: string; color: string }> = {
  0: { label: 'Auto', color: 'bg-green-500/15 text-green-400' },
  1: { label: 'Low', color: 'bg-blue-500/15 text-blue-400' },
  2: { label: 'Medium', color: 'bg-amber-500/15 text-amber-400' },
  3: { label: 'High', color: 'bg-red-500/15 text-red-400' },
}

export function ApprovalGate() {
  const [pending, setPending] = useState<Proposal[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [rejectReason, setRejectReason] = useState<string>('')
  const [rejectingId, setRejectingId] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<{ id: string; msg: string; ok: boolean } | null>(null)

  const loadApprovals = useCallback(async () => {
    try {
      const res = await fetch('http://127.0.0.1:3100/api/approvals')
      if (!res.ok) throw new Error(`Bridge error: ${res.status}`)
      const data = await res.json()
      setPending(data.pending || [])
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadApprovals()
    const interval = setInterval(loadApprovals, 10000)
    return () => clearInterval(interval)
  }, [loadApprovals])

  const handleApprove = async (id: string) => {
    setActionLoading(id)
    try {
      const res = await fetch(`http://127.0.0.1:3100/api/approvals/${id}/approve`, { method: 'POST' })
      if (!res.ok) throw new Error('Approve failed')
      setFeedback({ id, msg: '✅ Approved', ok: true })
      setTimeout(() => { setFeedback(null); loadApprovals() }, 1500)
    } catch {
      setFeedback({ id, msg: '❌ Failed', ok: false })
      setTimeout(() => setFeedback(null), 3000)
    } finally {
      setActionLoading(null)
    }
  }

  const handleReject = async (id: string) => {
    setActionLoading(id)
    try {
      const res = await fetch(`http://127.0.0.1:3100/api/approvals/${id}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: rejectReason || 'Rejected from dashboard' }),
      })
      if (!res.ok) throw new Error('Reject failed')
      setRejectingId(null)
      setRejectReason('')
      setFeedback({ id, msg: '🚫 Rejected', ok: true })
      setTimeout(() => { setFeedback(null); loadApprovals() }, 1500)
    } catch {
      setFeedback({ id, msg: '❌ Failed', ok: false })
      setTimeout(() => setFeedback(null), 3000)
    } finally {
      setActionLoading(null)
    }
  }

  if (loading) {
    return (
      <div className="p-6 space-y-3 animate-pulse">
        <div className="h-4 w-1/2 rounded bg-surface-1/60" />
        <div className="h-16 w-full rounded bg-surface-1/40" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-6">
        <div className="rounded-lg border border-red-500/20 bg-red-500/5 px-4 py-3 text-sm">
          <span className="text-red-400">⚠️ Approval Gate Offline</span>
          <p className="mt-1 text-xs text-red-400/70">{error}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto">
        {pending.length === 0 ? (
          <div className="p-6 text-center">
            <div className="text-3xl mb-2">🔐</div>
            <p className="text-xs text-muted-foreground/50">No pending proposals</p>
            <p className="text-[10px] text-muted-foreground/30 mt-1">
              When Amy needs permission, proposals appear here
            </p>
          </div>
        ) : (
          <div className="py-2">
            {pending.map((proposal) => {
              const tier = TIER_LABELS[proposal.tier] || TIER_LABELS[1]
              const isActioning = actionLoading === proposal.proposal_id
              const fb = feedback?.id === proposal.proposal_id ? feedback : null
              const isRejecting = rejectingId === proposal.proposal_id

              return (
                <div
                  key={proposal.proposal_id}
                  className="px-4 py-3 border-b border-border/20 hover:bg-accent/20 transition-colors"
                >
                  <div className="flex items-start gap-2">
                    <span className="text-sm mt-0.5">🔐</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className={`rounded px-1.5 py-0.5 text-[9px] font-medium ${tier.color}`}>
                          T{proposal.tier} {tier.label}
                        </span>
                        <span className="text-xs font-medium text-foreground">
                          {proposal.action}
                        </span>
                      </div>
                      {proposal.summary && (
                        <p className="text-[11px] text-muted-foreground/60 mt-0.5 truncate">
                          {proposal.summary}
                        </p>
                      )}
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-[9px] font-mono text-muted-foreground/30">
                          #{proposal.proposal_id.slice(0, 8)}
                        </span>
                        <span className="text-[9px] text-muted-foreground/30">
                          {proposal.timestamp}
                        </span>
                      </div>

                      {/* Action feedback */}
                      {fb && (
                        <div className={`mt-1.5 text-[10px] ${fb.ok ? 'text-green-400' : 'text-red-400'}`}>
                          {fb.msg}
                        </div>
                      )}

                      {/* Reject reason input */}
                      {isRejecting && (
                        <div className="mt-2 flex gap-1.5">
                          <input
                            value={rejectReason}
                            onChange={e => setRejectReason(e.target.value)}
                            placeholder="Reason (optional)..."
                            className="flex-1 rounded border border-border/40 bg-surface-1 px-2 py-1 text-[10px] text-foreground placeholder:text-muted-foreground/40 focus:outline-none"
                          />
                          <button
                            onClick={() => handleReject(proposal.proposal_id)}
                            disabled={isActioning}
                            className="rounded bg-red-500/20 px-2 py-1 text-[10px] text-red-400 hover:bg-red-500/30 disabled:opacity-40"
                          >
                            Confirm
                          </button>
                          <button
                            onClick={() => { setRejectingId(null); setRejectReason('') }}
                            className="text-[10px] text-muted-foreground/40 hover:text-muted-foreground"
                          >
                            Cancel
                          </button>
                        </div>
                      )}

                      {/* Action buttons */}
                      {!isRejecting && !fb && (
                        <div className="flex gap-2 mt-2">
                          <button
                            onClick={() => handleApprove(proposal.proposal_id)}
                            disabled={isActioning}
                            className="rounded bg-green-500/20 px-3 py-1 text-[10px] font-medium text-green-400 hover:bg-green-500/30 disabled:opacity-40 transition-colors"
                          >
                            {isActioning ? '...' : '✅ Approve'}
                          </button>
                          <button
                            onClick={() => setRejectingId(proposal.proposal_id)}
                            disabled={isActioning}
                            className="rounded bg-red-500/10 px-3 py-1 text-[10px] font-medium text-red-400 hover:bg-red-500/20 disabled:opacity-40 transition-colors"
                          >
                            🚫 Reject
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      <div className="flex items-center justify-between px-4 py-1.5 border-t border-border/30 flex-shrink-0">
        <span className="text-[10px] text-muted-foreground/40">
          {pending.length} pending • auto-refresh 10s
        </span>
        <button onClick={loadApprovals} className="text-[10px] text-primary/60 hover:text-primary transition-colors">
          Refresh
        </button>
      </div>
    </div>
  )
}
