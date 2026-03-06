'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'

type ScenarioLinkType = 'PRD' | 'AC' | 'TEST' | 'EVIDENCE' | 'BACKLOG'
type CoverageVerdict = 'Missing' | 'Partial' | 'Covered'
type ScenarioStatus = 0 | 50 | 100

type ScenarioLink = {
  linkId: string
  linkType: ScenarioLinkType
  title: string
  url: string
  createdAt: string
}

type ScenarioRun = {
  runId: string
  runAt: string
  environment: string
  verdict: CoverageVerdict
  notes: string
  artifactUrl: string
  negativeCaseRecorded: boolean
  createdBy: string | null
}

type ScenarioResponse = {
  scenario: {
    scenarioId: string
    name: string
    outcome: string
    ownerMilestone: number
    dependencies: number[]
    mvpScope: boolean
    status: ScenarioStatus
    nfrTags: string[]
    notes: string
    gapNote: string
    negativeCaseVerified: boolean
    links: ScenarioLink[]
    updatedAt: string
  }
  runs: ScenarioRun[]
  completeness: {
    coverageVerdict: CoverageVerdict
    missingItems: string[]
  }
  error?: string
}

type EditState = {
  name: string
  outcome: string
  ownerMilestone: string
  dependencies: string
  mvpScope: boolean
  status: ScenarioStatus
  nfrTags: string
  notes: string
  gapNote: string
  negativeCaseVerified: boolean
}

function toShortDateTime(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString()
}

function parseNumberArray(text: string) {
  return text
    .split(',')
    .map((item) => Number(item.trim()))
    .filter((item) => Number.isInteger(item) && item > 0)
}

function parseStringArray(text: string) {
  return text
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

const LINK_TYPE_OPTIONS: ScenarioLinkType[] = ['PRD', 'AC', 'TEST', 'EVIDENCE', 'BACKLOG']

export function ScenarioDetailPanel({ scenarioId }: { scenarioId: string }) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reloadToken, setReloadToken] = useState(0)
  const [data, setData] = useState<ScenarioResponse | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [editState, setEditState] = useState<EditState>({
    name: '',
    outcome: '',
    ownerMilestone: '',
    dependencies: '',
    mvpScope: true,
    status: 0,
    nfrTags: '',
    notes: '',
    gapNote: '',
    negativeCaseVerified: false,
  })
  const [linkState, setLinkState] = useState({
    linkType: 'PRD' as ScenarioLinkType,
    title: '',
    url: '',
    loading: false,
    error: '',
  })
  const [verifyState, setVerifyState] = useState({
    environment: 'staging',
    verdict: 'Partial' as CoverageVerdict,
    negativeCaseRecorded: false,
    artifactUrl: '',
    notes: '',
    loading: false,
    error: '',
  })

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await fetch(`/api/scenarios/${encodeURIComponent(scenarioId)}`)
      const json = (await response.json()) as ScenarioResponse
      if (!response.ok) {
        setError(json?.error ?? `HTTP ${response.status}`)
        setData(null)
        return
      }
      setData(json)
      setEditState({
        name: json.scenario.name,
        outcome: json.scenario.outcome,
        ownerMilestone: String(json.scenario.ownerMilestone),
        dependencies: json.scenario.dependencies.join(','),
        mvpScope: json.scenario.mvpScope,
        status: json.scenario.status,
        nfrTags: json.scenario.nfrTags.join(','),
        notes: json.scenario.notes ?? '',
        gapNote: json.scenario.gapNote ?? '',
        negativeCaseVerified: json.scenario.negativeCaseVerified,
      })
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Load failed')
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [scenarioId])

  useEffect(() => {
    void load()
  }, [load, reloadToken])

  const canSave = useMemo(() => !loading && !!data && !saving, [loading, data, saving])

  async function saveChanges() {
    if (!canSave) return
    setSaving(true)
    setSaveError(null)
    try {
      const ownerMilestone = Number(editState.ownerMilestone)
      const response = await fetch(`/api/scenarios/${encodeURIComponent(scenarioId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: editState.name.trim(),
          outcome: editState.outcome.trim(),
          ownerMilestone,
          dependencies: parseNumberArray(editState.dependencies),
          mvpScope: editState.mvpScope,
          status: editState.status,
          nfrTags: parseStringArray(editState.nfrTags),
          notes: editState.notes.trim(),
          gapNote: editState.gapNote.trim(),
          negativeCaseVerified: editState.negativeCaseVerified,
        }),
      })
      const json = (await response.json()) as { error?: string }
      if (!response.ok) {
        setSaveError(json?.error ?? `HTTP ${response.status}`)
        return
      }
      setReloadToken((token) => token + 1)
    } catch (saveChangesError) {
      setSaveError(saveChangesError instanceof Error ? saveChangesError.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  async function addLink() {
    if (linkState.loading) return
    setLinkState((prev) => ({ ...prev, loading: true, error: '' }))
    try {
      const response = await fetch(`/api/scenarios/${encodeURIComponent(scenarioId)}/links`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          linkType: linkState.linkType,
          title: linkState.title.trim(),
          url: linkState.url.trim(),
        }),
      })
      const json = (await response.json()) as { error?: string }
      if (!response.ok) {
        setLinkState((prev) => ({ ...prev, loading: false, error: json?.error ?? `HTTP ${response.status}` }))
        return
      }
      setLinkState((prev) => ({ ...prev, title: '', url: '', loading: false, error: '' }))
      setReloadToken((token) => token + 1)
    } catch (addLinkError) {
      setLinkState((prev) => ({
        ...prev,
        loading: false,
        error: addLinkError instanceof Error ? addLinkError.message : 'Add link failed',
      }))
    }
  }

  async function deleteLink(linkId: string) {
    const response = await fetch(
      `/api/scenarios/${encodeURIComponent(scenarioId)}/links/${encodeURIComponent(linkId)}`,
      { method: 'DELETE' },
    )
    if (response.ok) {
      setReloadToken((token) => token + 1)
      return
    }
    const json = (await response.json()) as { error?: string }
    setLinkState((prev) => ({ ...prev, error: json?.error ?? `HTTP ${response.status}` }))
  }

  async function addVerificationRun() {
    if (verifyState.loading) return
    setVerifyState((prev) => ({ ...prev, loading: true, error: '' }))
    try {
      const response = await fetch(`/api/scenarios/${encodeURIComponent(scenarioId)}/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          environment: verifyState.environment.trim(),
          verdict: verifyState.verdict,
          negativeCaseRecorded: verifyState.negativeCaseRecorded,
          artifactUrl: verifyState.artifactUrl.trim(),
          notes: verifyState.notes.trim(),
        }),
      })
      const json = (await response.json()) as { error?: string }
      if (!response.ok) {
        setVerifyState((prev) => ({
          ...prev,
          loading: false,
          error: json?.error ?? `HTTP ${response.status}`,
        }))
        return
      }
      setVerifyState((prev) => ({ ...prev, loading: false, notes: '', error: '' }))
      setReloadToken((token) => token + 1)
    } catch (verificationError) {
      setVerifyState((prev) => ({
        ...prev,
        loading: false,
        error: verificationError instanceof Error ? verificationError.message : 'Verification failed',
      }))
    }
  }

  if (loading) {
    return (
      <div className="panel" style={{ padding: 16 }}>
        Loading…
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="panel" style={{ padding: 16, display: 'grid', gap: 8 }}>
        <div style={{ color: '#b91c1c' }}>{error ?? 'Scenario not found.'}</div>
        <Link href="/admin/scenarios">Back to registry</Link>
      </div>
    )
  }

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div className="panel" style={{ padding: 16, display: 'grid', gap: 8 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <div>
            <div className="chip" style={{ display: 'inline-block', marginBottom: 6 }}>
              Scenario
            </div>
            <h2 style={{ margin: 0, fontSize: 18 }}>{data.scenario.scenarioId}</h2>
          </div>
          <div style={{ fontSize: 12, opacity: 0.8 }}>
            Coverage: {data.completeness.coverageVerdict}
          </div>
        </div>
        <div style={{ fontSize: 12, opacity: 0.85 }}>
          Missing: {data.completeness.missingItems.length > 0 ? data.completeness.missingItems.join(', ') : 'none'}
        </div>
        <Link href="/admin/scenarios">Back to registry</Link>
      </div>

      <div className="panel" style={{ padding: 16, display: 'grid', gap: 10 }}>
        <h3 style={{ margin: 0, fontSize: 14 }}>Scenario config</h3>
        <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))' }}>
          <label style={{ display: 'grid', gap: 4, fontSize: 12 }}>
            Name
            <input
              value={editState.name}
              onChange={(event) => setEditState((prev) => ({ ...prev, name: event.target.value }))}
            />
          </label>
          <label style={{ display: 'grid', gap: 4, fontSize: 12 }}>
            Owner milestone
            <input
              value={editState.ownerMilestone}
              onChange={(event) =>
                setEditState((prev) => ({ ...prev, ownerMilestone: event.target.value }))
              }
            />
          </label>
          <label style={{ display: 'grid', gap: 4, fontSize: 12 }}>
            Dependencies
            <input
              value={editState.dependencies}
              onChange={(event) =>
                setEditState((prev) => ({ ...prev, dependencies: event.target.value }))
              }
            />
          </label>
          <label style={{ display: 'grid', gap: 4, fontSize: 12 }}>
            Status
            <select
              value={String(editState.status)}
              onChange={(event) =>
                setEditState((prev) => ({
                  ...prev,
                  status: Number(event.target.value) as ScenarioStatus,
                }))
              }
            >
              <option value="0">0 Missing</option>
              <option value="50">50 Partial</option>
              <option value="100">100 Covered</option>
            </select>
          </label>
        </div>
        <label style={{ display: 'grid', gap: 4, fontSize: 12 }}>
          Outcome
          <textarea
            value={editState.outcome}
            onChange={(event) => setEditState((prev) => ({ ...prev, outcome: event.target.value }))}
            rows={3}
          />
        </label>
        <label style={{ display: 'grid', gap: 4, fontSize: 12 }}>
          NFR tags (comma separated)
          <input
            value={editState.nfrTags}
            onChange={(event) => setEditState((prev) => ({ ...prev, nfrTags: event.target.value }))}
          />
        </label>
        <label style={{ display: 'grid', gap: 4, fontSize: 12 }}>
          Notes
          <textarea
            value={editState.notes}
            onChange={(event) => setEditState((prev) => ({ ...prev, notes: event.target.value }))}
            rows={2}
          />
        </label>
        <label style={{ display: 'grid', gap: 4, fontSize: 12 }}>
          Gap note
          <textarea
            value={editState.gapNote}
            onChange={(event) => setEditState((prev) => ({ ...prev, gapNote: event.target.value }))}
            rows={2}
          />
        </label>
        <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', fontSize: 12 }}>
          <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input
              type="checkbox"
              checked={editState.mvpScope}
              onChange={(event) => setEditState((prev) => ({ ...prev, mvpScope: event.target.checked }))}
            />
            MVP scope
          </label>
          <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input
              type="checkbox"
              checked={editState.negativeCaseVerified}
              onChange={(event) =>
                setEditState((prev) => ({ ...prev, negativeCaseVerified: event.target.checked }))
              }
            />
            Negative case verified
          </label>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button type="button" onClick={saveChanges} disabled={!canSave}>
            {saving ? 'Saving…' : 'Save changes'}
          </button>
          {saveError ? <span style={{ color: '#b91c1c', fontSize: 12 }}>{saveError}</span> : null}
          <span style={{ fontSize: 12, opacity: 0.75 }}>
            Last update: {toShortDateTime(data.scenario.updatedAt)}
          </span>
        </div>
      </div>

      <div className="panel" style={{ padding: 16, display: 'grid', gap: 10 }}>
        <h3 style={{ margin: 0, fontSize: 14 }}>Links</h3>
        <div style={{ display: 'grid', gap: 8, gridTemplateColumns: '160px 1fr 1fr auto' }}>
          <select
            value={linkState.linkType}
            onChange={(event) =>
              setLinkState((prev) => ({
                ...prev,
                linkType: event.target.value as ScenarioLinkType,
              }))
            }
          >
            {LINK_TYPE_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
          <input
            value={linkState.title}
            onChange={(event) => setLinkState((prev) => ({ ...prev, title: event.target.value }))}
            placeholder="Title"
          />
          <input
            value={linkState.url}
            onChange={(event) => setLinkState((prev) => ({ ...prev, url: event.target.value }))}
            placeholder="URL or test id"
          />
          <button type="button" onClick={addLink} disabled={linkState.loading}>
            Add
          </button>
        </div>
        {linkState.error ? <div style={{ color: '#b91c1c', fontSize: 12 }}>{linkState.error}</div> : null}
        <div style={{ display: 'grid', gap: 8 }}>
          {data.scenario.links.map((link) => (
            <div
              key={link.linkId}
              className="panel-strong"
              style={{ padding: 10, display: 'grid', gap: 4, gridTemplateColumns: '120px 1fr auto' }}
            >
              <div style={{ fontSize: 12 }}>{link.linkType}</div>
              <div style={{ fontSize: 12 }}>
                <div>{link.title}</div>
                <div style={{ opacity: 0.8 }}>{link.url}</div>
              </div>
              <button type="button" onClick={() => void deleteLink(link.linkId)}>
                Remove
              </button>
            </div>
          ))}
        </div>
      </div>

      <div className="panel" style={{ padding: 16, display: 'grid', gap: 10 }}>
        <h3 style={{ margin: 0, fontSize: 14 }}>Verification runs</h3>
        <div style={{ display: 'grid', gap: 8, gridTemplateColumns: '140px 120px 1fr' }}>
          <input
            value={verifyState.environment}
            onChange={(event) => setVerifyState((prev) => ({ ...prev, environment: event.target.value }))}
            placeholder="staging"
          />
          <select
            value={verifyState.verdict}
            onChange={(event) =>
              setVerifyState((prev) => ({ ...prev, verdict: event.target.value as CoverageVerdict }))
            }
          >
            <option value="Missing">Missing</option>
            <option value="Partial">Partial</option>
            <option value="Covered">Covered</option>
          </select>
          <input
            value={verifyState.artifactUrl}
            onChange={(event) => setVerifyState((prev) => ({ ...prev, artifactUrl: event.target.value }))}
            placeholder="Artifact URL/path"
          />
        </div>
        <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12 }}>
          <input
            type="checkbox"
            checked={verifyState.negativeCaseRecorded}
            onChange={(event) =>
              setVerifyState((prev) => ({ ...prev, negativeCaseRecorded: event.target.checked }))
            }
          />
          Negative case recorded in this run
        </label>
        <textarea
          rows={2}
          value={verifyState.notes}
          onChange={(event) => setVerifyState((prev) => ({ ...prev, notes: event.target.value }))}
          placeholder="Verification notes"
        />
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button type="button" onClick={addVerificationRun} disabled={verifyState.loading}>
            {verifyState.loading ? 'Saving…' : 'Record run'}
          </button>
          {verifyState.error ? <span style={{ color: '#b91c1c', fontSize: 12 }}>{verifyState.error}</span> : null}
        </div>
        <div style={{ display: 'grid', gap: 8 }}>
          {data.runs.map((run) => (
            <div key={run.runId} className="panel-strong" style={{ padding: 10, fontSize: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                <strong>
                  {run.verdict} · {run.environment}
                </strong>
                <span>{toShortDateTime(run.runAt)}</span>
              </div>
              {run.artifactUrl ? <div>Artifact: {run.artifactUrl}</div> : null}
              {run.notes ? <div style={{ opacity: 0.85 }}>{run.notes}</div> : null}
              <div style={{ opacity: 0.8 }}>
                Negative case: {run.negativeCaseRecorded ? 'yes' : 'no'}
              </div>
            </div>
          ))}
          {data.runs.length < 1 ? <div style={{ fontSize: 12, opacity: 0.8 }}>No verification runs yet.</div> : null}
        </div>
      </div>
    </div>
  )
}
