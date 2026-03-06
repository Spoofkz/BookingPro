'use client'

import { useCallback, useEffect, useState } from 'react'

type ReadinessSnapshot = {
  milestoneId: number
  milestoneName: string
  codexScore: number
  evidenceScore: number
  delta: number
  computedAt: string
  breakdown: {
    ownedCoveragePoints: number
    policyFailurePoints: number
    securityAuditObsPoints: number
    testsReleasePoints: number
    ownedCovered: number
    ownedTotal: number
  }
  reasons: string[]
}

type ReadinessResponse = {
  items: ReadinessSnapshot[]
  total: number
  error?: string
}

function toShortDateTime(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString()
}

function deltaColor(delta: number) {
  if (delta > 0) return '#166534'
  if (delta < 0) return '#b91c1c'
  return 'inherit'
}

export function MilestoneReadinessPanel() {
  const [items, setItems] = useState<ReadinessSnapshot[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [recomputing, setRecomputing] = useState(false)
  const [reloadToken, setReloadToken] = useState(0)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await fetch('/api/milestones/readiness')
      const json = (await response.json()) as ReadinessResponse
      if (!response.ok) {
        setError(json?.error ?? `HTTP ${response.status}`)
        setItems([])
        return
      }
      setItems(Array.isArray(json.items) ? json.items : [])
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Load failed')
      setItems([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load, reloadToken])

  async function recompute() {
    if (recomputing) return
    setRecomputing(true)
    setError(null)
    try {
      const response = await fetch('/api/milestones/readiness/recompute', { method: 'POST' })
      const json = (await response.json()) as ReadinessResponse
      if (!response.ok) {
        setError(json?.error ?? `HTTP ${response.status}`)
        return
      }
      setItems(Array.isArray(json.items) ? json.items : [])
    } catch (recomputeError) {
      setError(recomputeError instanceof Error ? recomputeError.message : 'Recompute failed')
    } finally {
      setRecomputing(false)
    }
  }

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div className="panel" style={{ padding: 16, display: 'grid', gap: 10 }}>
        <h2 style={{ margin: 0, fontSize: 16 }}>Milestone Readiness</h2>
        <p style={{ margin: 0, fontSize: 12, opacity: 0.85 }}>
          Evidence score is computed with the PRD-00 rubric (A/B/C/D) and compared against Codex estimate.
        </p>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button type="button" onClick={recompute} disabled={recomputing}>
            {recomputing ? 'Recomputing…' : 'Recompute snapshots'}
          </button>
          <button type="button" onClick={() => setReloadToken((token) => token + 1)}>
            Refresh
          </button>
          {loading ? <span style={{ fontSize: 12, opacity: 0.8 }}>Loading…</span> : null}
        </div>
        {error ? <div style={{ color: '#b91c1c', fontSize: 12 }}>{error}</div> : null}
      </div>

      <div className="panel" style={{ padding: 0, overflow: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1200 }}>
          <thead>
            <tr style={{ textAlign: 'left', fontSize: 12, opacity: 0.8 }}>
              <th style={{ padding: 10, borderBottom: '1px solid var(--border)' }}>Milestone</th>
              <th style={{ padding: 10, borderBottom: '1px solid var(--border)' }}>Codex %</th>
              <th style={{ padding: 10, borderBottom: '1px solid var(--border)' }}>Evidence %</th>
              <th style={{ padding: 10, borderBottom: '1px solid var(--border)' }}>Delta</th>
              <th style={{ padding: 10, borderBottom: '1px solid var(--border)' }}>A/B/C/D</th>
              <th style={{ padding: 10, borderBottom: '1px solid var(--border)' }}>Owned coverage</th>
              <th style={{ padding: 10, borderBottom: '1px solid var(--border)' }}>Top reasons</th>
              <th style={{ padding: 10, borderBottom: '1px solid var(--border)' }}>Computed at</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.milestoneId} style={{ borderTop: '1px solid color-mix(in oklab, var(--border) 70%, transparent)' }}>
                <td style={{ padding: 10, verticalAlign: 'top', fontSize: 12 }}>
                  <strong>#{item.milestoneId}</strong> {item.milestoneName}
                </td>
                <td style={{ padding: 10, verticalAlign: 'top', fontSize: 12 }}>{item.codexScore}</td>
                <td style={{ padding: 10, verticalAlign: 'top', fontSize: 12 }}>{item.evidenceScore}</td>
                <td style={{ padding: 10, verticalAlign: 'top', fontSize: 12, color: deltaColor(item.delta) }}>
                  {item.delta > 0 ? `+${item.delta}` : item.delta}
                </td>
                <td style={{ padding: 10, verticalAlign: 'top', fontSize: 12 }}>
                  <div>A {item.breakdown.ownedCoveragePoints}</div>
                  <div>B {item.breakdown.policyFailurePoints}</div>
                  <div>C {item.breakdown.securityAuditObsPoints}</div>
                  <div>D {item.breakdown.testsReleasePoints}</div>
                </td>
                <td style={{ padding: 10, verticalAlign: 'top', fontSize: 12 }}>
                  {item.breakdown.ownedCovered}/{item.breakdown.ownedTotal}
                </td>
                <td style={{ padding: 10, verticalAlign: 'top', fontSize: 12 }}>
                  {item.reasons.length > 0 ? item.reasons.slice(0, 2).join(' | ') : 'No gaps'}
                </td>
                <td style={{ padding: 10, verticalAlign: 'top', fontSize: 12 }}>
                  {toShortDateTime(item.computedAt)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
