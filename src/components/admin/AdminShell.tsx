'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { MilestoneReadinessPanel } from '@/src/components/admin/MilestoneReadinessPanel'
import { ScenarioDetailPanel } from '@/src/components/admin/ScenarioDetailPanel'
import { ScenarioRegistryPanel } from '@/src/components/admin/ScenarioRegistryPanel'

type SectionKey =
  | 'dashboard'
  | 'clubs'
  | 'users'
  | 'bookings'
  | 'disputes'
  | 'featured'
  | 'audit'
  | 'scenarios'
  | 'readiness'

type ApiPanelSectionKey = 'clubs' | 'users' | 'bookings' | 'disputes' | 'featured' | 'audit'

const SECTION_ENDPOINTS: Record<ApiPanelSectionKey, string> = {
  clubs: '/api/admin/clubs?pageSize=20',
  users: '/api/admin/users?pageSize=20',
  bookings: '/api/admin/bookings?pageSize=20',
  disputes: '/api/admin/disputes?pageSize=20',
  featured: '/api/admin/featured',
  audit: '/api/admin/audit?pageSize=20',
}

const SECTIONS: Array<{ key: SectionKey; label: string; href: string }> = [
  { key: 'dashboard', label: 'Dashboard', href: '/admin' },
  { key: 'clubs', label: 'Clubs', href: '/admin/clubs' },
  { key: 'users', label: 'Users', href: '/admin/users' },
  { key: 'bookings', label: 'Bookings', href: '/admin/bookings' },
  { key: 'disputes', label: 'Disputes', href: '/admin/disputes' },
  { key: 'featured', label: 'Featured', href: '/admin/featured' },
  { key: 'scenarios', label: 'Scenarios', href: '/admin/scenarios' },
  { key: 'readiness', label: 'Readiness', href: '/admin/readiness' },
  { key: 'audit', label: 'Audit', href: '/admin/audit' },
]

function pretty(value: unknown) {
  return JSON.stringify(value, null, 2)
}

function DashboardPanel() {
  const [data, setData] = useState<{
    me?: unknown
    clubs?: unknown
    bookings?: unknown
    disputes?: unknown
    error?: string
  }>({})

  useEffect(() => {
    let ignore = false
    ;(async () => {
      try {
        const [me, clubs, bookings, disputes] = await Promise.all([
          fetch('/api/admin/me').then((r) => r.json()),
          fetch('/api/admin/clubs?pageSize=5').then((r) => r.json()),
          fetch('/api/admin/bookings?pageSize=5').then((r) => r.json()),
          fetch('/api/admin/disputes?pageSize=5').then((r) => r.json()),
        ])
        if (ignore) return
        setData({ me, clubs, bookings, disputes })
      } catch (error) {
        if (ignore) return
        setData({ error: error instanceof Error ? error.message : 'Load failed' })
      }
    })()
    return () => {
      ignore = true
    }
  }, [])

  const clubTotal =
    typeof (data.clubs as { total?: number } | undefined)?.total === 'number'
      ? (data.clubs as { total: number }).total
      : null
  const bookingTotal =
    typeof (data.bookings as { total?: number } | undefined)?.total === 'number'
      ? (data.bookings as { total: number }).total
      : null
  const disputeTotal =
    typeof (data.disputes as { total?: number } | undefined)?.total === 'number'
      ? (data.disputes as { total: number }).total
      : null

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div
        className="panel"
        style={{ padding: 16, display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit,minmax(160px,1fr))' }}
      >
        <Stat label="Active Session" value={Array.isArray((data.me as { roles?: unknown[] } | undefined)?.roles) ? 'Yes' : 'No'} />
        <Stat label="Clubs" value={clubTotal == null ? '...' : String(clubTotal)} />
        <Stat label="Bookings" value={bookingTotal == null ? '...' : String(bookingTotal)} />
        <Stat label="Disputes" value={disputeTotal == null ? '...' : String(disputeTotal)} />
      </div>
      {data.error ? (
        <div className="panel" style={{ padding: 16, color: '#b91c1c' }}>
          {data.error}
        </div>
      ) : (
        <div className="panel" style={{ padding: 16 }}>
          <h2 style={{ margin: 0, fontSize: 16 }}>Snapshot</h2>
          <pre style={{ margin: '12px 0 0', overflow: 'auto', fontSize: 12 }}>
            {pretty({
              me: data.me,
              clubsPreview: (data.clubs as { items?: unknown[] } | undefined)?.items,
              disputesPreview: (data.disputes as { items?: unknown[] } | undefined)?.items,
            })}
          </pre>
        </div>
      )}
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="panel-strong" style={{ padding: 12 }}>
      <div style={{ fontSize: 12, opacity: 0.75 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 600 }}>{value}</div>
    </div>
  )
}

function DataPanel({ section }: { section: ApiPanelSectionKey }) {
  const [state, setState] = useState<{ loading: boolean; data: unknown; error: string | null }>({
    loading: true,
    data: null,
    error: null,
  })
  const endpoint = SECTION_ENDPOINTS[section]

  useEffect(() => {
    let ignore = false
    setState({ loading: true, data: null, error: null })
    ;(async () => {
      try {
        const response = await fetch(endpoint)
        const json = await response.json()
        if (ignore) return
        if (!response.ok) {
          setState({ loading: false, data: json, error: json?.error || `HTTP ${response.status}` })
          return
        }
        setState({ loading: false, data: json, error: null })
      } catch (error) {
        if (ignore) return
        setState({
          loading: false,
          data: null,
          error: error instanceof Error ? error.message : 'Load failed',
        })
      }
    })()
    return () => {
      ignore = true
    }
  }, [endpoint])

  return (
    <div className="panel" style={{ padding: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
        <h2 style={{ margin: 0, fontSize: 16, textTransform: 'capitalize' }}>{section}</h2>
        <code style={{ fontSize: 12 }}>{endpoint}</code>
      </div>
      {state.loading ? <p style={{ margin: '12px 0 0' }}>Loading…</p> : null}
      {state.error ? <p style={{ margin: '12px 0 0', color: '#b91c1c' }}>{state.error}</p> : null}
      {!state.loading && (
        <pre style={{ margin: '12px 0 0', overflow: 'auto', fontSize: 12, maxHeight: '70vh' }}>
          {pretty(state.data)}
        </pre>
      )}
    </div>
  )
}

export function AdminShell({
  section,
  scenarioId,
}: {
  section: SectionKey
  scenarioId?: string
}) {
  const title = useMemo(
    () => SECTIONS.find((item) => item.key === section)?.label ?? 'Admin',
    [section],
  )

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div className="panel" style={{ padding: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <div>
            <div className="chip" style={{ display: 'inline-block', marginBottom: 8 }}>
              Admin Mode
            </div>
            <h1 style={{ margin: 0, fontSize: 22 }}>{title}</h1>
            <p style={{ margin: '6px 0 0', opacity: 0.8, fontSize: 13 }}>
              Platform-scoped operations. All actions are audited.
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignContent: 'flex-start' }}>
            {SECTIONS.map((item) => (
              <Link
                key={item.key}
                href={item.href}
                className="chip"
                style={{
                  textDecoration: 'none',
                  padding: '6px 10px',
                  background: item.key === section ? 'rgba(15,118,110,0.15)' : undefined,
                  borderColor: item.key === section ? 'rgba(15,118,110,0.35)' : undefined,
                }}
              >
                {item.label}
              </Link>
            ))}
          </div>
        </div>
      </div>

      {section === 'dashboard' ? <DashboardPanel /> : null}
      {section === 'scenarios' ? (
        scenarioId ? <ScenarioDetailPanel scenarioId={scenarioId} /> : <ScenarioRegistryPanel />
      ) : null}
      {section === 'readiness' ? <MilestoneReadinessPanel /> : null}
      {section !== 'dashboard' && section !== 'scenarios' && section !== 'readiness' ? (
        <DataPanel section={section} />
      ) : null}
    </div>
  )
}
