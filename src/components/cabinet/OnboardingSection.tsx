'use client'

import { Role } from '@prisma/client'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { FormEvent, useEffect, useMemo, useState } from 'react'

type MeResponse = {
  activeClubId: string | null
}

type ClubListResponse = {
  items: Array<{
    id: string
    name: string
    slug: string
    status: string
    timezone: string
    currency: string
    address: string | null
    roles: Role[]
    updatedAt: string
  }>
}

type ClubDetailsResponse = {
  id: string
  name: string
  slug: string
  status: string
  timezone: string
  currency: string
  description: string | null
  address: string | null
  city: string | null
  area: string | null
  amenities: string[]
  geoLat: number | null
  geoLng: number | null
  logoUrl: string | null
  galleryUrls: string[]
  startingFromAmount: number | null
  startingFromSegment: string | null
  contacts: {
    phone?: string
    whatsapp?: string
    email?: string
  }
  businessHoursText: string | null
  holdTtlMinutes: number | null
  cancellationPolicy: Record<string, unknown> | null
  checkInPolicy: Record<string, unknown> | null
  schedulePublishedAt: string | null
  slotsGeneratedUntil: string | null
  pauseReason: string | null
  pauseUntil: string | null
  publishedAt: string | null
}

type OnboardingResponse = {
  clubId: string
  status: string
  progress: {
    completed: number
    total: number
  }
  items: Array<{
    key: string
    status: 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETE' | 'BLOCKED'
    missing: string[]
    fixLink: string
  }>
  canPublish: boolean
  publishBlockers: string[]
}

type MembersResponse = {
  items: Array<{
    id: string
    role: Role
    createdAt: string
    user: {
      id: string
      name: string
      email: string | null
      phone: string | null
    }
  }>
}

type CreateClubForm = {
  name: string
  timezone: string
  currency: string
  address: string
  phone: string
  whatsapp: string
  email: string
}

type ClubProfileForm = {
  name: string
  timezone: string
  currency: string
  address: string
  city: string
  area: string
  description: string
  amenities: string
  geoLat: string
  geoLng: string
  logoUrl: string
  galleryUrls: string
  phone: string
  whatsapp: string
  email: string
  businessHoursText: string
  holdTtlMinutes: string
  schedulePublishedAt: string
  slotsGeneratedUntil: string
  cancellationPolicyJson: string
  checkInPolicyJson: string
}

type AssignMemberForm = {
  email: string
  role: Role
}

type PauseForm = {
  reason: string
  pauseUntil: string
}

type FeaturedItem = {
  id: string
  clubId: string
  featuredRank: number
  badgeText: string | null
  featuredStartAt: string
  featuredEndAt: string
  isActive: boolean
  createdAt: string
  updatedAt: string
}

type FeaturedResponse = {
  items: FeaturedItem[]
  activeNow: FeaturedItem | null
}

type FeaturedForm = {
  featuredRank: string
  badgeText: string
  featuredStartAt: string
  featuredEndAt: string
  isActive: boolean
}

function toDateTimeLocalValue(value: string | null) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const offsetMs = date.getTimezoneOffset() * 60 * 1000
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16)
}

function defaultFutureDate(days: number) {
  const date = new Date()
  date.setDate(date.getDate() + days)
  return toDateTimeLocalValue(date.toISOString())
}

function fromDateTimeLocalValue(value: string) {
  if (!value.trim()) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return date.toISOString()
}

function parseListInput(value: string) {
  return Array.from(
    new Set(
      value
        .split(/[\n,]/g)
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  )
}

function parseNullableNumberInput(value: string, fieldLabel: string) {
  const normalized = value.trim()
  if (!normalized) return null
  const parsed = Number(normalized)
  if (!Number.isFinite(parsed)) {
    throw new Error(`${fieldLabel} must be a valid number.`)
  }
  return parsed
}

function statusColor(status: string) {
  if (status === 'COMPLETE' || status === 'PUBLISHED' || status === 'READY_TO_PUBLISH') {
    return 'text-emerald-700 dark:text-emerald-300'
  }
  if (status === 'BLOCKED' || status === 'PAUSED' || status === 'ARCHIVED') {
    return 'text-red-700 dark:text-red-300'
  }
  return 'text-amber-700 dark:text-amber-300'
}

function safeJsonStringify(value: Record<string, unknown> | null) {
  if (!value) return '{}'
  return JSON.stringify(value, null, 2)
}

export default function OnboardingSection() {
  const router = useRouter()
  const [activeClubId, setActiveClubId] = useState<string | null>(null)
  const [clubs, setClubs] = useState<ClubListResponse['items']>([])
  const [clubDetails, setClubDetails] = useState<ClubDetailsResponse | null>(null)
  const [onboarding, setOnboarding] = useState<OnboardingResponse | null>(null)
  const [featured, setFeatured] = useState<FeaturedResponse | null>(null)
  const [members, setMembers] = useState<MembersResponse['items']>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [actioning, setActioning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const [createForm, setCreateForm] = useState<CreateClubForm>({
    name: '',
    timezone: 'Asia/Almaty',
    currency: 'KZT',
    address: '',
    phone: '',
    whatsapp: '',
    email: '',
  })

  const [clubForm, setClubForm] = useState<ClubProfileForm>({
    name: '',
    timezone: 'Asia/Almaty',
    currency: 'KZT',
    address: '',
    city: '',
    area: '',
    description: '',
    amenities: '',
    geoLat: '',
    geoLng: '',
    logoUrl: '',
    galleryUrls: '',
    phone: '',
    whatsapp: '',
    email: '',
    businessHoursText: '',
    holdTtlMinutes: '15',
    schedulePublishedAt: '',
    slotsGeneratedUntil: '',
    cancellationPolicyJson: '{}',
    checkInPolicyJson: '{}',
  })

  const [featuredForm, setFeaturedForm] = useState<FeaturedForm>({
    featuredRank: '100',
    badgeText: '',
    featuredStartAt: defaultFutureDate(0),
    featuredEndAt: defaultFutureDate(7),
    isActive: true,
  })

  const [assignForm, setAssignForm] = useState<AssignMemberForm>({
    email: '',
    role: Role.HOST_ADMIN,
  })

  const [pauseForm, setPauseForm] = useState<PauseForm>({
    reason: '',
    pauseUntil: '',
  })

  async function readJsonOrError<T>(response: Response, fallbackError: string) {
    const payload = (await response.json()) as T | { error?: string; blockers?: string[]; details?: Record<string, string[]> }
    if (!response.ok) {
      const baseMessage =
        typeof (payload as { error?: string }).error === 'string'
          ? (payload as { error?: string }).error
          : fallbackError
      const blockers = Array.isArray((payload as { blockers?: string[] }).blockers)
        ? ((payload as { blockers?: string[] }).blockers as string[])
        : []
      const details = (payload as { details?: Record<string, string[]> }).details
      const blockerDetails = blockers
        .map((blocker) => {
          const messages = Array.isArray(details?.[blocker]) ? details?.[blocker] ?? [] : []
          return messages.length > 0 ? `${blocker}: ${messages.join(' ')}` : blocker
        })
        .join(' ')
      const message = blockerDetails ? `${baseMessage} ${blockerDetails}` : baseMessage
      throw new Error(message)
    }
    return payload as T
  }

  async function loadClubDetails(clubId: string) {
    const [detailsResponse, onboardingResponse, membersResponse, featuredResponse] = await Promise.all([
      fetch(`/api/clubs/${clubId}`, { cache: 'no-store' }),
      fetch(`/api/clubs/${clubId}/onboarding`, { cache: 'no-store' }),
      fetch(`/api/clubs/${clubId}/members`, { cache: 'no-store' }),
      fetch(`/api/clubs/${clubId}/featured`, { cache: 'no-store' }),
    ])

    const details = await readJsonOrError<ClubDetailsResponse>(detailsResponse, 'Failed to load club profile.')
    const onboardingData = await readJsonOrError<OnboardingResponse>(onboardingResponse, 'Failed to load onboarding checklist.')
    const membersData = await readJsonOrError<MembersResponse>(membersResponse, 'Failed to load club members.')
    const featuredData = await readJsonOrError<FeaturedResponse>(
      featuredResponse,
      'Failed to load featured campaigns.',
    )

    setClubDetails(details)
    setOnboarding(onboardingData)
    setMembers(membersData.items)
    setFeatured(featuredData)

    setClubForm({
      name: details.name,
      timezone: details.timezone,
      currency: details.currency,
      address: details.address || '',
      city: details.city || '',
      area: details.area || '',
      description: details.description || '',
      amenities: details.amenities.join(', '),
      geoLat: details.geoLat == null ? '' : String(details.geoLat),
      geoLng: details.geoLng == null ? '' : String(details.geoLng),
      logoUrl: details.logoUrl || '',
      galleryUrls: details.galleryUrls.join('\n'),
      phone: details.contacts.phone || '',
      whatsapp: details.contacts.whatsapp || '',
      email: details.contacts.email || '',
      businessHoursText: details.businessHoursText || '',
      holdTtlMinutes: String(details.holdTtlMinutes ?? 15),
      schedulePublishedAt: toDateTimeLocalValue(details.schedulePublishedAt),
      slotsGeneratedUntil: toDateTimeLocalValue(details.slotsGeneratedUntil),
      cancellationPolicyJson: safeJsonStringify(details.cancellationPolicy),
      checkInPolicyJson: safeJsonStringify(details.checkInPolicy),
    })

    const defaultFeatured = featuredData.activeNow ?? featuredData.items[0] ?? null
    if (defaultFeatured) {
      setFeaturedForm({
        featuredRank: String(defaultFeatured.featuredRank),
        badgeText: defaultFeatured.badgeText || '',
        featuredStartAt: toDateTimeLocalValue(defaultFeatured.featuredStartAt),
        featuredEndAt: toDateTimeLocalValue(defaultFeatured.featuredEndAt),
        isActive: defaultFeatured.isActive,
      })
    } else {
      setFeaturedForm({
        featuredRank: '100',
        badgeText: '',
        featuredStartAt: defaultFutureDate(0),
        featuredEndAt: defaultFutureDate(7),
        isActive: true,
      })
    }
  }

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const [meResponse, clubsResponse] = await Promise.all([
        fetch('/api/me', { cache: 'no-store' }),
        fetch('/api/clubs?scope=mine', { cache: 'no-store' }),
      ])

      const me = await readJsonOrError<MeResponse>(meResponse, 'Failed to load user context.')
      const clubsPayload = await readJsonOrError<ClubListResponse>(clubsResponse, 'Failed to load clubs.')

      setActiveClubId(me.activeClubId)
      setClubs(clubsPayload.items)

      if (me.activeClubId) {
        await loadClubDetails(me.activeClubId)
      } else {
        setClubDetails(null)
        setOnboarding(null)
        setFeatured(null)
        setMembers([])
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Failed to load onboarding data.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const completionLabel = useMemo(() => {
    if (!onboarding) return '0/0'
    return `${onboarding.progress.completed}/${onboarding.progress.total}`
  }, [onboarding])

  async function handleCreateClub(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true)
    setError(null)
    setMessage(null)
    try {
      const response = await fetch('/api/clubs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: createForm.name,
          timezone: createForm.timezone,
          currency: createForm.currency,
          address: createForm.address,
          contacts: {
            phone: createForm.phone,
            whatsapp: createForm.whatsapp,
            email: createForm.email,
          },
        }),
      })
      const payload = await readJsonOrError<{ clubId: string; status: string }>(
        response,
        'Failed to create club.',
      )

      const contextResponse = await fetch('/api/context', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clubId: payload.clubId, role: Role.TECH_ADMIN }),
      })
      await readJsonOrError(contextResponse, 'Club created, but failed to switch active club.')

      setCreateForm((current) => ({ ...current, name: '', address: '', phone: '', whatsapp: '', email: '' }))
      setMessage('Club created and selected as active context.')
      router.refresh()
      await load()
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : 'Failed to create club.')
    } finally {
      setSaving(false)
    }
  }

  async function handleSaveClubProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!activeClubId) return
    setSaving(true)
    setError(null)
    setMessage(null)
    try {
      const cancellationPolicy = clubForm.cancellationPolicyJson.trim()
        ? (JSON.parse(clubForm.cancellationPolicyJson) as Record<string, unknown>)
        : null
      const checkInPolicy = clubForm.checkInPolicyJson.trim()
        ? (JSON.parse(clubForm.checkInPolicyJson) as Record<string, unknown>)
        : null
      const geoLat = parseNullableNumberInput(clubForm.geoLat, 'Geo latitude')
      const geoLng = parseNullableNumberInput(clubForm.geoLng, 'Geo longitude')

      const response = await fetch(`/api/clubs/${activeClubId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: clubForm.name,
          timezone: clubForm.timezone,
          currency: clubForm.currency,
          address: clubForm.address,
          city: clubForm.city,
          area: clubForm.area,
          description: clubForm.description,
          amenities: parseListInput(clubForm.amenities),
          geo: {
            lat: geoLat,
            lng: geoLng,
          },
          logoUrl: clubForm.logoUrl.trim() || null,
          galleryUrls: parseListInput(clubForm.galleryUrls),
          businessHoursText: clubForm.businessHoursText,
          holdTtlMinutes: Number(clubForm.holdTtlMinutes),
          schedulePublishedAt: fromDateTimeLocalValue(clubForm.schedulePublishedAt),
          slotsGeneratedUntil: fromDateTimeLocalValue(clubForm.slotsGeneratedUntil),
          contacts: {
            phone: clubForm.phone,
            whatsapp: clubForm.whatsapp,
            email: clubForm.email,
          },
          cancellationPolicy,
          checkInPolicy,
        }),
      })
      await readJsonOrError(response, 'Failed to update club profile.')

      setMessage('Club profile saved.')
      await load()
    } catch (saveError) {
      if (saveError instanceof SyntaxError) {
        setError('Policy JSON is invalid.')
      } else {
        setError(saveError instanceof Error ? saveError.message : 'Failed to update club profile.')
      }
    } finally {
      setSaving(false)
    }
  }

  async function handleAssignMember(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!activeClubId) return
    setActioning(true)
    setError(null)
    setMessage(null)
    try {
      const response = await fetch(`/api/clubs/${activeClubId}/members/invite`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(assignForm),
      })
      await readJsonOrError(response, 'Failed to assign member.')

      setAssignForm({
        email: '',
        role: Role.HOST_ADMIN,
      })
      setMessage('Member assigned.')
      await load()
    } catch (assignError) {
      setError(assignError instanceof Error ? assignError.message : 'Failed to assign member.')
    } finally {
      setActioning(false)
    }
  }

  async function handleCreateFeaturedCampaign(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!activeClubId) return
    setActioning(true)
    setError(null)
    setMessage(null)
    try {
      const featuredRank = Number(featuredForm.featuredRank)
      if (!Number.isInteger(featuredRank) || featuredRank < 1 || featuredRank > 9999) {
        throw new Error('Featured rank must be an integer between 1 and 9999.')
      }
      const featuredStartAt = fromDateTimeLocalValue(featuredForm.featuredStartAt)
      const featuredEndAt = fromDateTimeLocalValue(featuredForm.featuredEndAt)
      if (!featuredStartAt || !featuredEndAt) {
        throw new Error('Featured start/end must be valid datetime values.')
      }

      const response = await fetch(`/api/clubs/${activeClubId}/featured`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          featuredRank,
          badgeText: featuredForm.badgeText.trim() || null,
          featuredStartAt,
          featuredEndAt,
          isActive: featuredForm.isActive,
        }),
      })
      await readJsonOrError(response, 'Failed to save featured campaign.')

      setMessage('Featured campaign saved.')
      await loadClubDetails(activeClubId)
    } catch (featuredError) {
      setError(
        featuredError instanceof Error
          ? featuredError.message
          : 'Failed to save featured campaign.',
      )
    } finally {
      setActioning(false)
    }
  }

  async function runLifecycleAction(action: 'publish' | 'pause' | 'resume') {
    if (!activeClubId) return
    setActioning(true)
    setError(null)
    setMessage(null)
    try {
      const body =
        action === 'pause'
          ? {
              reason: pauseForm.reason,
              pauseUntil: fromDateTimeLocalValue(pauseForm.pauseUntil),
            }
          : {}

      const response = await fetch(`/api/clubs/${activeClubId}/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      await readJsonOrError(response, `Failed to ${action} club.`)

      if (action === 'pause') {
        setPauseForm({ reason: '', pauseUntil: '' })
      }
      setMessage(
        action === 'publish'
          ? 'Club published.'
          : action === 'pause'
            ? 'Club paused.'
            : 'Club resumed.',
      )
      await load()
    } catch (lifecycleError) {
      setError(lifecycleError instanceof Error ? lifecycleError.message : `Failed to ${action} club.`)
    } finally {
      setActioning(false)
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-2xl font-semibold">Club Onboarding</h2>
        <p className="text-sm text-[var(--muted)]">
          Register clubs, complete onboarding checklist, and control publish lifecycle.
        </p>
      </div>

      {error ? (
        <div className="panel-strong border-red-400/40 p-3 text-sm text-red-700 dark:text-red-300">
          {error}
        </div>
      ) : null}
      {message ? (
        <div className="panel-strong border-emerald-400/40 p-3 text-sm text-emerald-700 dark:text-emerald-300">
          {message}
        </div>
      ) : null}

      <form onSubmit={handleCreateClub} className="panel-strong space-y-3 p-4">
        <h3 className="text-lg font-semibold">Create Club</h3>
        <div className="grid gap-3 md:grid-cols-3">
          <label className="flex flex-col gap-1 text-sm">
            Name
            <input
              className="panel rounded-lg px-3 py-2"
              value={createForm.name}
              onChange={(event) =>
                setCreateForm((current) => ({ ...current, name: event.target.value }))
              }
              placeholder="Ultras Cyber Arena"
              required
            />
          </label>

          <label className="flex flex-col gap-1 text-sm">
            Timezone
            <input
              className="panel rounded-lg px-3 py-2"
              value={createForm.timezone}
              onChange={(event) =>
                setCreateForm((current) => ({ ...current, timezone: event.target.value }))
              }
              placeholder="Asia/Almaty"
              required
            />
          </label>

          <label className="flex flex-col gap-1 text-sm">
            Currency
            <input
              className="panel rounded-lg px-3 py-2"
              value={createForm.currency}
              onChange={(event) =>
                setCreateForm((current) => ({ ...current, currency: event.target.value.toUpperCase() }))
              }
              placeholder="KZT"
              maxLength={3}
              required
            />
          </label>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm">
            Address
            <input
              className="panel rounded-lg px-3 py-2"
              value={createForm.address}
              onChange={(event) =>
                setCreateForm((current) => ({ ...current, address: event.target.value }))
              }
              placeholder="Almaty, ..."
            />
          </label>

          <label className="flex flex-col gap-1 text-sm">
            Phone
            <input
              className="panel rounded-lg px-3 py-2"
              value={createForm.phone}
              onChange={(event) =>
                setCreateForm((current) => ({ ...current, phone: event.target.value }))
              }
              placeholder="+7..."
            />
          </label>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm">
            WhatsApp
            <input
              className="panel rounded-lg px-3 py-2"
              value={createForm.whatsapp}
              onChange={(event) =>
                setCreateForm((current) => ({ ...current, whatsapp: event.target.value }))
              }
              placeholder="+7..."
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Email
            <input
              className="panel rounded-lg px-3 py-2"
              type="email"
              value={createForm.email}
              onChange={(event) =>
                setCreateForm((current) => ({ ...current, email: event.target.value }))
              }
              placeholder="club@example.com"
            />
          </label>
        </div>

        <button
          type="submit"
          className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm hover:bg-white/10 disabled:opacity-50"
          disabled={saving}
        >
          {saving ? 'Creating...' : 'Create Draft Club'}
        </button>
      </form>

      <article className="panel-strong p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-lg font-semibold">My Clubs</h3>
          <span className="chip">{clubs.length} clubs</span>
        </div>
        <div className="mt-3 space-y-2">
          {clubs.length === 0 ? (
            <p className="text-sm text-[var(--muted)]">No clubs assigned.</p>
          ) : (
            clubs.map((club) => (
              <article key={club.id} className="panel rounded-lg px-3 py-2 text-sm">
                <p className="font-medium">{club.name}</p>
                <p className={`text-xs ${statusColor(club.status)}`}>{club.status}</p>
                <p className="text-xs text-[var(--muted)]">
                  {club.currency} · {club.timezone}
                </p>
              </article>
            ))
          )}
        </div>
      </article>

      {loading ? (
        <p className="text-sm text-[var(--muted)]">Loading active club onboarding...</p>
      ) : null}

      {activeClubId && clubDetails ? (
        <>
          <article className="panel-strong p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-lg font-semibold">Checklist</h3>
              <p className="text-sm text-[var(--muted)]">
                Progress: {completionLabel} · Status{' '}
                <span className={statusColor(onboarding?.status ?? clubDetails.status)}>
                  {onboarding?.status ?? clubDetails.status}
                </span>
              </p>
            </div>

            <div className="mt-3 space-y-2">
              {(onboarding?.items ?? []).map((item) => (
                <article key={item.key} className="panel rounded-lg p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-medium">{item.key}</p>
                    <span className={`text-xs ${statusColor(item.status)}`}>{item.status}</span>
                  </div>
                  {item.missing.length > 0 ? (
                    <div className="mt-1 space-y-1 text-xs text-[var(--muted)]">
                      {item.missing.map((missing, index) => (
                        <p key={`${item.key}-${index}`}>{missing}</p>
                      ))}
                    </div>
                  ) : (
                    <p className="mt-1 text-xs text-[var(--muted)]">No blockers.</p>
                  )}
                  <Link
                    href={item.fixLink}
                    className="mt-2 inline-block rounded-lg border border-[var(--border)] px-2 py-1 text-xs hover:bg-white/10"
                  >
                    Fix
                  </Link>
                </article>
              ))}
            </div>
          </article>

          <form onSubmit={handleSaveClubProfile} className="panel-strong space-y-3 p-4">
            <h3 className="text-lg font-semibold">Club Profile & Operational Settings</h3>

            <div className="grid gap-3 md:grid-cols-3">
              <label className="flex flex-col gap-1 text-sm">
                Name
                <input
                  className="panel rounded-lg px-3 py-2"
                  value={clubForm.name}
                  onChange={(event) =>
                    setClubForm((current) => ({ ...current, name: event.target.value }))
                  }
                  required
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                Timezone
                <input
                  className="panel rounded-lg px-3 py-2"
                  value={clubForm.timezone}
                  onChange={(event) =>
                    setClubForm((current) => ({ ...current, timezone: event.target.value }))
                  }
                  required
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                Currency
                <input
                  className="panel rounded-lg px-3 py-2"
                  value={clubForm.currency}
                  onChange={(event) =>
                    setClubForm((current) => ({ ...current, currency: event.target.value.toUpperCase() }))
                  }
                  maxLength={3}
                  required
                />
              </label>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <label className="flex flex-col gap-1 text-sm">
                Address
                <input
                  className="panel rounded-lg px-3 py-2"
                  value={clubForm.address}
                  onChange={(event) =>
                    setClubForm((current) => ({ ...current, address: event.target.value }))
                  }
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                City
                <input
                  className="panel rounded-lg px-3 py-2"
                  value={clubForm.city}
                  onChange={(event) =>
                    setClubForm((current) => ({ ...current, city: event.target.value }))
                  }
                  placeholder="Almaty"
                />
              </label>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <label className="flex flex-col gap-1 text-sm">
                Area
                <input
                  className="panel rounded-lg px-3 py-2"
                  value={clubForm.area}
                  onChange={(event) =>
                    setClubForm((current) => ({ ...current, area: event.target.value }))
                  }
                  placeholder="Downtown"
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                Business Hours (display)
                <input
                  className="panel rounded-lg px-3 py-2"
                  value={clubForm.businessHoursText}
                  onChange={(event) =>
                    setClubForm((current) => ({ ...current, businessHoursText: event.target.value }))
                  }
                  placeholder="Mon-Sun 10:00-23:00"
                />
              </label>
            </div>

            <label className="flex flex-col gap-1 text-sm">
              Description
              <textarea
                className="panel min-h-[80px] rounded-lg px-3 py-2"
                value={clubForm.description}
                onChange={(event) =>
                  setClubForm((current) => ({ ...current, description: event.target.value }))
                }
              />
            </label>

            <div className="grid gap-3 md:grid-cols-2">
              <label className="flex flex-col gap-1 text-sm">
                Amenities (comma/newline separated)
                <textarea
                  className="panel min-h-[80px] rounded-lg px-3 py-2"
                  value={clubForm.amenities}
                  onChange={(event) =>
                    setClubForm((current) => ({ ...current, amenities: event.target.value }))
                  }
                  placeholder="vip, bootcamp, parking"
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                Gallery URLs (one per line)
                <textarea
                  className="panel min-h-[80px] rounded-lg px-3 py-2"
                  value={clubForm.galleryUrls}
                  onChange={(event) =>
                    setClubForm((current) => ({ ...current, galleryUrls: event.target.value }))
                  }
                  placeholder="https://..."
                />
              </label>
            </div>

            <div className="grid gap-3 md:grid-cols-4">
              <label className="flex flex-col gap-1 text-sm">
                Geo latitude
                <input
                  className="panel rounded-lg px-3 py-2"
                  value={clubForm.geoLat}
                  onChange={(event) =>
                    setClubForm((current) => ({ ...current, geoLat: event.target.value }))
                  }
                  placeholder="43.2389"
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                Geo longitude
                <input
                  className="panel rounded-lg px-3 py-2"
                  value={clubForm.geoLng}
                  onChange={(event) =>
                    setClubForm((current) => ({ ...current, geoLng: event.target.value }))
                  }
                  placeholder="76.8897"
                />
              </label>
              <label className="flex flex-col gap-1 text-sm md:col-span-2">
                Logo URL
                <input
                  className="panel rounded-lg px-3 py-2"
                  value={clubForm.logoUrl}
                  onChange={(event) =>
                    setClubForm((current) => ({ ...current, logoUrl: event.target.value }))
                  }
                  placeholder="https://..."
                />
              </label>
            </div>

            <article className="panel rounded-lg p-3 text-xs text-[var(--muted)]">
              <p>
                Discovery price hint:{' '}
                {clubDetails.startingFromAmount == null
                  ? 'n/a'
                  : `${clubDetails.startingFromAmount} ${clubDetails.currency}`}
                {clubDetails.startingFromSegment
                  ? ` · ${clubDetails.startingFromSegment}`
                  : ''}
              </p>
              <p>
                Current geo: {clubDetails.geoLat ?? 'n/a'}, {clubDetails.geoLng ?? 'n/a'}
              </p>
            </article>

            <div className="grid gap-3 md:grid-cols-3">
              <label className="flex flex-col gap-1 text-sm">
                Contact Phone
                <input
                  className="panel rounded-lg px-3 py-2"
                  value={clubForm.phone}
                  onChange={(event) =>
                    setClubForm((current) => ({ ...current, phone: event.target.value }))
                  }
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                Contact WhatsApp
                <input
                  className="panel rounded-lg px-3 py-2"
                  value={clubForm.whatsapp}
                  onChange={(event) =>
                    setClubForm((current) => ({ ...current, whatsapp: event.target.value }))
                  }
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                Contact Email
                <input
                  className="panel rounded-lg px-3 py-2"
                  type="email"
                  value={clubForm.email}
                  onChange={(event) =>
                    setClubForm((current) => ({ ...current, email: event.target.value }))
                  }
                />
              </label>
            </div>

            <div className="grid gap-3 md:grid-cols-3">
              <label className="flex flex-col gap-1 text-sm">
                Hold TTL (minutes)
                <input
                  className="panel rounded-lg px-3 py-2"
                  type="number"
                  min={1}
                  value={clubForm.holdTtlMinutes}
                  onChange={(event) =>
                    setClubForm((current) => ({ ...current, holdTtlMinutes: event.target.value }))
                  }
                  required
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                Schedule Published At
                <input
                  className="panel rounded-lg px-3 py-2"
                  type="datetime-local"
                  value={clubForm.schedulePublishedAt}
                  onChange={(event) =>
                    setClubForm((current) => ({ ...current, schedulePublishedAt: event.target.value }))
                  }
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                Slots Generated Until
                <input
                  className="panel rounded-lg px-3 py-2"
                  type="datetime-local"
                  value={clubForm.slotsGeneratedUntil}
                  onChange={(event) =>
                    setClubForm((current) => ({ ...current, slotsGeneratedUntil: event.target.value }))
                  }
                />
              </label>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <label className="flex flex-col gap-1 text-sm">
                Cancellation Policy JSON
                <textarea
                  className="panel min-h-[120px] rounded-lg px-3 py-2 font-mono text-xs"
                  value={clubForm.cancellationPolicyJson}
                  onChange={(event) =>
                    setClubForm((current) => ({ ...current, cancellationPolicyJson: event.target.value }))
                  }
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                Check-in Policy JSON
                <textarea
                  className="panel min-h-[120px] rounded-lg px-3 py-2 font-mono text-xs"
                  value={clubForm.checkInPolicyJson}
                  onChange={(event) =>
                    setClubForm((current) => ({ ...current, checkInPolicyJson: event.target.value }))
                  }
                />
              </label>
            </div>

            <button
              type="submit"
              className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm hover:bg-white/10 disabled:opacity-50"
              disabled={saving}
            >
              {saving ? 'Saving...' : 'Save Profile'}
            </button>
          </form>

          <article className="panel-strong space-y-3 p-4">
            <h3 className="text-lg font-semibold">Featured Placement</h3>
            <p className="text-sm text-[var(--muted)]">
              Configure temporary featured windows for discovery ranking.
            </p>

            {featured?.activeNow ? (
              <article className="panel rounded-lg p-3 text-xs">
                <p className="font-medium">
                  Active now · Rank {featured.activeNow.featuredRank}
                </p>
                <p className="text-[var(--muted)]">
                  {featured.activeNow.badgeText || 'Featured'} ·{' '}
                  {new Date(featured.activeNow.featuredStartAt).toLocaleString()} -{' '}
                  {new Date(featured.activeNow.featuredEndAt).toLocaleString()}
                </p>
              </article>
            ) : (
              <p className="text-sm text-[var(--muted)]">No active featured campaign.</p>
            )}

            <form
              onSubmit={handleCreateFeaturedCampaign}
              className="grid gap-3 md:grid-cols-[140px_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto]"
            >
              <label className="flex flex-col gap-1 text-sm">
                Rank
                <input
                  className="panel rounded-lg px-3 py-2"
                  type="number"
                  min={1}
                  max={9999}
                  value={featuredForm.featuredRank}
                  onChange={(event) =>
                    setFeaturedForm((current) => ({
                      ...current,
                      featuredRank: event.target.value,
                    }))
                  }
                  required
                />
              </label>

              <label className="flex flex-col gap-1 text-sm">
                Badge
                <input
                  className="panel rounded-lg px-3 py-2"
                  value={featuredForm.badgeText}
                  onChange={(event) =>
                    setFeaturedForm((current) => ({
                      ...current,
                      badgeText: event.target.value,
                    }))
                  }
                  placeholder="Top club"
                />
              </label>

              <label className="flex flex-col gap-1 text-sm">
                Start at
                <input
                  className="panel rounded-lg px-3 py-2"
                  type="datetime-local"
                  value={featuredForm.featuredStartAt}
                  onChange={(event) =>
                    setFeaturedForm((current) => ({
                      ...current,
                      featuredStartAt: event.target.value,
                    }))
                  }
                  required
                />
              </label>

              <label className="flex flex-col gap-1 text-sm">
                End at
                <input
                  className="panel rounded-lg px-3 py-2"
                  type="datetime-local"
                  value={featuredForm.featuredEndAt}
                  onChange={(event) =>
                    setFeaturedForm((current) => ({
                      ...current,
                      featuredEndAt: event.target.value,
                    }))
                  }
                  required
                />
              </label>

              <div className="flex flex-col justify-end gap-2">
                <label className="inline-flex items-center gap-2 text-xs">
                  <input
                    type="checkbox"
                    checked={featuredForm.isActive}
                    onChange={(event) =>
                      setFeaturedForm((current) => ({
                        ...current,
                        isActive: event.target.checked,
                      }))
                    }
                  />
                  Active
                </label>
                <button
                  type="submit"
                  className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm hover:bg-white/10 disabled:opacity-50"
                  disabled={actioning}
                >
                  {actioning ? 'Saving...' : 'Save'}
                </button>
              </div>
            </form>

            <div className="space-y-2">
              {(featured?.items ?? []).length < 1 ? (
                <p className="text-sm text-[var(--muted)]">No featured windows configured yet.</p>
              ) : (
                featured?.items.map((item) => (
                  <article key={item.id} className="panel rounded-lg p-2 text-xs">
                    <p className="font-medium">
                      Rank {item.featuredRank} · {item.badgeText || 'Featured'}
                    </p>
                    <p className="text-[var(--muted)]">
                      {new Date(item.featuredStartAt).toLocaleString()} -{' '}
                      {new Date(item.featuredEndAt).toLocaleString()}
                    </p>
                    <p className="text-[var(--muted)]">
                      {item.isActive ? 'Active flag: on' : 'Active flag: off'}
                    </p>
                  </article>
                ))
              )}
            </div>
          </article>

          <article className="panel-strong space-y-3 p-4">
            <h3 className="text-lg font-semibold">Staff Assignment</h3>
            <form onSubmit={handleAssignMember} className="grid gap-3 md:grid-cols-[minmax(0,1fr)_200px_auto]">
              <label className="flex flex-col gap-1 text-sm">
                User Email
                <input
                  className="panel rounded-lg px-3 py-2"
                  type="email"
                  value={assignForm.email}
                  onChange={(event) =>
                    setAssignForm((current) => ({ ...current, email: event.target.value }))
                  }
                  placeholder="host@example.com"
                  required
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                Role
                <select
                  className="panel rounded-lg px-3 py-2"
                  value={assignForm.role}
                  onChange={(event) =>
                    setAssignForm((current) => ({ ...current, role: event.target.value as Role }))
                  }
                >
                  <option value={Role.HOST_ADMIN}>HOST_ADMIN</option>
                  <option value={Role.TECH_ADMIN}>TECH_ADMIN</option>
                </select>
              </label>
              <button
                type="submit"
                className="self-end rounded-lg border border-[var(--border)] px-3 py-2 text-sm hover:bg-white/10 disabled:opacity-50"
                disabled={actioning}
              >
                Assign
              </button>
            </form>

            <div className="space-y-2">
              {members.length === 0 ? (
                <p className="text-sm text-[var(--muted)]">No members assigned yet.</p>
              ) : (
                members.map((member) => (
                  <article key={member.id} className="panel rounded-lg p-2 text-sm">
                    <p className="font-medium">{member.user.name}</p>
                    <p className="text-xs text-[var(--muted)]">
                      {member.user.email || 'No email'} · {member.role}
                    </p>
                  </article>
                ))
              )}
            </div>
          </article>

          <article className="panel-strong space-y-3 p-4">
            <h3 className="text-lg font-semibold">Lifecycle Actions</h3>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="rounded-lg border border-[var(--border)] bg-[color-mix(in_oklab,var(--accent)_18%,transparent)] px-3 py-2 text-sm hover:opacity-90 disabled:opacity-50"
                onClick={() => void runLifecycleAction('publish')}
                disabled={actioning || !(onboarding?.canPublish ?? false)}
              >
                Publish Club
              </button>
              <button
                type="button"
                className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm hover:bg-white/10 disabled:opacity-50"
                onClick={() => void runLifecycleAction('resume')}
                disabled={actioning || (clubDetails.status !== 'PAUSED' && onboarding?.status !== 'PAUSED')}
              >
                Resume Club
              </button>
            </div>

            <div className="grid gap-3 md:grid-cols-3">
              <label className="flex flex-col gap-1 text-sm md:col-span-2">
                Pause Reason
                <input
                  className="panel rounded-lg px-3 py-2"
                  value={pauseForm.reason}
                  onChange={(event) =>
                    setPauseForm((current) => ({ ...current, reason: event.target.value }))
                  }
                  placeholder="Maintenance"
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                Pause Until
                <input
                  className="panel rounded-lg px-3 py-2"
                  type="datetime-local"
                  value={pauseForm.pauseUntil}
                  onChange={(event) =>
                    setPauseForm((current) => ({ ...current, pauseUntil: event.target.value }))
                  }
                />
              </label>
            </div>
            <button
              type="button"
              className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm hover:bg-white/10 disabled:opacity-50"
              onClick={() => void runLifecycleAction('pause')}
              disabled={actioning}
            >
              Pause Club
            </button>
          </article>
        </>
      ) : (
        <p className="text-sm text-[var(--muted)]">
          Select an active club from cabinet header to manage onboarding.
        </p>
      )}
    </div>
  )
}
