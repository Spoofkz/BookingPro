'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'

type ScenarioStatus = 0 | 50 | 100

type ScenarioListItem = {
  scenarioId: string
  name: string
  ownerMilestone: number
  dependencies: number[]
  mvpScope: boolean
  status: ScenarioStatus
  nfrTags: string[]
  gapNote: string
  updatedAt: string
  completeness: {
    coverageVerdict: 'Missing' | 'Partial' | 'Covered'
    acLinked: boolean
    testsLinked: boolean
    evidenceLinked: boolean
    negativeCaseLinked: boolean
    missingItems: string[]
  }
}

type Milestone = {
  id: number
  name: string
}

type ScenarioListResponse = {
  items: ScenarioListItem[]
  milestones: Milestone[]
  total: number
  error?: string
}

type CreateState = {
  scenarioId: string
  name: string
  outcome: string
  ownerMilestone: string
  dependencies: string
}

const STATUS_LABELS: Record<ScenarioStatus, string> = {
  0: 'Missing',
  50: 'Partial',
  100: 'Covered',
}

function toShortDateTime(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString()
}

function parseDependencies(text: string) {
  return text
    .split(',')
    .map((item) => Number(item.trim()))
    .filter((item) => Number.isInteger(item) && item > 0)
}

function boolBadge(value: boolean) {
  return value ? 'Y' : 'N'
}

export function ScenarioRegistryPanel() {
  const [items, setItems] = useState<ScenarioListItem[]>([])
  const [milestones, setMilestones] = useState<Milestone[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reloadToken, setReloadToken] = useState(0)
  const [isCreating, setIsCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [createState, setCreateState] = useState<CreateState>({
    scenarioId: '',
    name: '',
    outcome: '',
    ownerMilestone: '',
    dependencies: '',
  })
  const [filters, setFilters] = useState({
    q: '',
    milestoneId: '',
    status: '',
    mvpScope: '',
    tag: '',
  })

  const queryString = useMemo(() => {
    const search = new URLSearchParams()
    const q = filters.q.trim()
    const tag = filters.tag.trim()
    if (q) search.set('q', q)
    if (filters.milestoneId) search.set('milestoneId', filters.milestoneId)
    if (filters.status) search.set('status', filters.status)
    if (filters.mvpScope) search.set('mvpScope', filters.mvpScope)
    if (tag) search.set('tag', tag)
    return search.toString()
  }, [filters])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await fetch(`/api/scenarios${queryString ? `?${queryString}` : ''}`)
      const json = (await response.json()) as ScenarioListResponse
      if (!response.ok) {
        setError(json?.error ?? `HTTP ${response.status}`)
        setItems([])
        return
      }
      setItems(Array.isArray(json.items) ? json.items : [])
      setMilestones(Array.isArray(json.milestones) ? json.milestones : [])
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Load failed')
      setItems([])
    } finally {
      setLoading(false)
    }
  }, [queryString])

  useEffect(() => {
    void load()
  }, [load, reloadToken])

  async function createScenario() {
    if (isCreating) return
    setCreateError(null)
    setIsCreating(true)
    try {
      const ownerMilestone = Number(createState.ownerMilestone)
      const response = await fetch('/api/scenarios', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scenarioId: createState.scenarioId.trim(),
          name: createState.name.trim(),
          outcome: createState.outcome.trim(),
          ownerMilestone,
          dependencies: parseDependencies(createState.dependencies),
          mvpScope: true,
          status: 0,
        }),
      })
      const json = (await response.json()) as { error?: string }
      if (!response.ok) {
        setCreateError(json?.error ?? `HTTP ${response.status}`)
        return
      }
      setCreateState({
        scenarioId: '',
        name: '',
        outcome: '',
        ownerMilestone: '',
        dependencies: '',
      })
      setReloadToken((token) => token + 1)
    } catch (createScenarioError) {
      setCreateError(
        createScenarioError instanceof Error ? createScenarioError.message : 'Create failed',
      )
    } finally {
      setIsCreating(false)
    }
  }

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div className="panel" style={{ padding: 16, display: 'grid', gap: 12 }}>
        <h2 style={{ margin: 0, fontSize: 16 }}>Scenario Registry</h2>
        <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit,minmax(170px,1fr))' }}>
          <label style={{ display: 'grid', gap: 4, fontSize: 12 }}>
            Search
            <input
              value={filters.q}
              onChange={(event) =>
                setFilters((prev) => ({ ...prev, q: event.target.value }))
              }
              placeholder="Scenario ID or name"
            />
          </label>
          <label style={{ display: 'grid', gap: 4, fontSize: 12 }}>
            Milestone
            <select
              value={filters.milestoneId}
              onChange={(event) =>
                setFilters((prev) => ({ ...prev, milestoneId: event.target.value }))
              }
            >
              <option value="">All</option>
              {milestones.map((milestone) => (
                <option key={milestone.id} value={String(milestone.id)}>
                  {milestone.id}: {milestone.name}
                </option>
              ))}
            </select>
          </label>
          <label style={{ display: 'grid', gap: 4, fontSize: 12 }}>
            Status
            <select
              value={filters.status}
              onChange={(event) =>
                setFilters((prev) => ({ ...prev, status: event.target.value }))
              }
            >
              <option value="">All</option>
              <option value="0">0 Missing</option>
              <option value="50">50 Partial</option>
              <option value="100">100 Covered</option>
            </select>
          </label>
          <label style={{ display: 'grid', gap: 4, fontSize: 12 }}>
            MVP scope
            <select
              value={filters.mvpScope}
              onChange={(event) =>
                setFilters((prev) => ({ ...prev, mvpScope: event.target.value }))
              }
            >
              <option value="">All</option>
              <option value="true">MVP only</option>
              <option value="false">Non-MVP</option>
            </select>
          </label>
          <label style={{ display: 'grid', gap: 4, fontSize: 12 }}>
            NFR tag
            <input
              value={filters.tag}
              onChange={(event) =>
                setFilters((prev) => ({ ...prev, tag: event.target.value }))
              }
              placeholder="audit / security / perf"
            />
          </label>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
          <div style={{ fontSize: 12, opacity: 0.8 }}>
            {loading ? 'Loading…' : `${items.length} scenarios`}
          </div>
          <button type="button" onClick={() => setReloadToken((token) => token + 1)}>
            Refresh
          </button>
        </div>
        {error ? <div style={{ color: '#b91c1c', fontSize: 12 }}>{error}</div> : null}
      </div>

      <div className="panel" style={{ padding: 16, display: 'grid', gap: 8 }}>
        <h3 style={{ margin: 0, fontSize: 14 }}>Create scenario</h3>
        <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit,minmax(170px,1fr))' }}>
          <label style={{ display: 'grid', gap: 4, fontSize: 12 }}>
            Scenario ID
            <input
              value={createState.scenarioId}
              onChange={(event) =>
                setCreateState((prev) => ({ ...prev, scenarioId: event.target.value }))
              }
              placeholder="BK-99"
            />
          </label>
          <label style={{ display: 'grid', gap: 4, fontSize: 12 }}>
            Name
            <input
              value={createState.name}
              onChange={(event) => setCreateState((prev) => ({ ...prev, name: event.target.value }))}
              placeholder="Booking confirmation flow"
            />
          </label>
          <label style={{ display: 'grid', gap: 4, fontSize: 12 }}>
            Owner milestone
            <input
              value={createState.ownerMilestone}
              onChange={(event) =>
                setCreateState((prev) => ({ ...prev, ownerMilestone: event.target.value }))
              }
              placeholder="7"
            />
          </label>
          <label style={{ display: 'grid', gap: 4, fontSize: 12 }}>
            Dependencies
            <input
              value={createState.dependencies}
              onChange={(event) =>
                setCreateState((prev) => ({ ...prev, dependencies: event.target.value }))
              }
              placeholder="1,5,6,8"
            />
          </label>
        </div>
        <label style={{ display: 'grid', gap: 4, fontSize: 12 }}>
          Outcome
          <textarea
            value={createState.outcome}
            onChange={(event) => setCreateState((prev) => ({ ...prev, outcome: event.target.value }))}
            rows={3}
            placeholder="Business outcome statement"
          />
        </label>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button type="button" onClick={createScenario} disabled={isCreating}>
            {isCreating ? 'Creating…' : 'Create'}
          </button>
          {createError ? <span style={{ color: '#b91c1c', fontSize: 12 }}>{createError}</span> : null}
        </div>
      </div>

      <div className="panel" style={{ padding: 0, overflow: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 980 }}>
          <thead>
            <tr style={{ textAlign: 'left', fontSize: 12, opacity: 0.8 }}>
              <th style={{ padding: 10, borderBottom: '1px solid var(--border)' }}>Scenario</th>
              <th style={{ padding: 10, borderBottom: '1px solid var(--border)' }}>Owner</th>
              <th style={{ padding: 10, borderBottom: '1px solid var(--border)' }}>Status</th>
              <th style={{ padding: 10, borderBottom: '1px solid var(--border)' }}>Coverage</th>
              <th style={{ padding: 10, borderBottom: '1px solid var(--border)' }}>Links</th>
              <th style={{ padding: 10, borderBottom: '1px solid var(--border)' }}>Updated</th>
              <th style={{ padding: 10, borderBottom: '1px solid var(--border)' }}>Action</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.scenarioId} style={{ borderTop: '1px solid color-mix(in oklab, var(--border) 70%, transparent)' }}>
                <td style={{ padding: 10, verticalAlign: 'top' }}>
                  <div style={{ fontWeight: 600 }}>{item.scenarioId}</div>
                  <div style={{ fontSize: 12, opacity: 0.8 }}>{item.name}</div>
                  {item.gapNote ? (
                    <div style={{ marginTop: 6, fontSize: 11, color: '#b45309' }}>{item.gapNote}</div>
                  ) : null}
                </td>
                <td style={{ padding: 10, verticalAlign: 'top', fontSize: 12 }}>
                  <div>M{item.ownerMilestone}</div>
                  <div style={{ opacity: 0.8 }}>
                    deps: {item.dependencies.length > 0 ? item.dependencies.join(',') : '-'}
                  </div>
                </td>
                <td style={{ padding: 10, verticalAlign: 'top', fontSize: 12 }}>
                  <div>{item.status}</div>
                  <div style={{ opacity: 0.8 }}>{STATUS_LABELS[item.status]}</div>
                  <div style={{ marginTop: 4 }} className="chip">
                    MVP: {boolBadge(item.mvpScope)}
                  </div>
                </td>
                <td style={{ padding: 10, verticalAlign: 'top', fontSize: 12 }}>
                  <div>{item.completeness.coverageVerdict}</div>
                  {item.completeness.missingItems.length > 0 ? (
                    <div style={{ opacity: 0.8 }}>
                      Missing: {item.completeness.missingItems.join(', ')}
                    </div>
                  ) : (
                    <div style={{ opacity: 0.8 }}>All required links present</div>
                  )}
                </td>
                <td style={{ padding: 10, verticalAlign: 'top', fontSize: 12 }}>
                  <div>AC: {boolBadge(item.completeness.acLinked)}</div>
                  <div>TEST: {boolBadge(item.completeness.testsLinked)}</div>
                  <div>EVIDENCE: {boolBadge(item.completeness.evidenceLinked)}</div>
                  <div>NEGATIVE: {boolBadge(item.completeness.negativeCaseLinked)}</div>
                </td>
                <td style={{ padding: 10, verticalAlign: 'top', fontSize: 12 }}>
                  {toShortDateTime(item.updatedAt)}
                </td>
                <td style={{ padding: 10, verticalAlign: 'top', fontSize: 12 }}>
                  <Link href={`/admin/scenarios/${encodeURIComponent(item.scenarioId)}`}>Open</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
