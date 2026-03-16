'use client'

import Link from 'next/link'
import { FormEvent, useEffect, useMemo, useState } from 'react'

type Booking = {
  id: number
  guestName: string
  guestEmail: string
  guestPhone?: string | null
  seatId: string | null
  seatLabelSnapshot: string | null
  checkIn: string
  checkOut: string
  status: string
  paymentStatus: string
  priceTotalCents: number | null
  priceCurrency: string | null
  notes: string | null
  createdAt?: string
  updatedAt?: string
  seatSegment?: {
    segmentId: string
    segmentName: string | null
  } | null
  room: {
    name: string
  }
  club?: {
    id: string
    name: string
    slug?: string
    city?: string | null
  } | null
}

type BookingDetail = {
  id: number
  status: string
  paymentStatus: string
  guestName: string
  guestEmail: string
  guestPhone: string | null
  seatLabelSnapshot: string | null
  seatSegment?: {
    segmentId: string
    segmentName: string | null
  } | null
  checkIn: string
  checkOut: string
  priceTotalCents: number | null
  priceCurrency: string | null
  notes: string | null
  room: {
    name: string
  }
  slot: {
    id: string
    startAtUtc: string
    endAtUtc: string
    status: string
  } | null
  payments: Array<{
    id: number
    amountCents: number
    method: string
    status: string
    createdAt: string
  }>
}

type PaymentItem = {
  id: number
  amountCents: number
  method: string
  status: string
  createdAt: string
  bookingId: number
  booking?: {
    id: number
    status: string
    checkIn: string
    checkOut: string
    paymentStatus: string
    room: {
      name: string
    } | null
  } | null
}

type MembershipEntitlement = {
  entitlementId: string
  planId: string | null
  type: string
  status: string
  computedStatus?: string
  remainingMinutes: number | null
  remainingSessions: number | null
  walletBalance: number | null
  validFrom: string
  validTo: string | null
  plan: {
    planId: string
    name: string
    status: string
    type: string
    priceAmount: number
    currency: string
    valueAmount: number
  } | null
}

type MembershipTransaction = {
  txId: string
  entitlementId: string
  txType: string
  amountDelta: number
  minutesDelta: number
  sessionsDelta: number
  bookingId: number | null
  reason: string | null
  createdAt: string
}

type MembershipPlan = {
  planId: string
  name: string
  type: string
  priceAmount: number
  currency: string
  valueAmount: number
}

type MembershipSnapshotResponse = {
  clubId: string
  entitlements: MembershipEntitlement[]
  transactions: MembershipTransaction[]
  availablePlans: MembershipPlan[]
}

type MeResponse = {
  activeClubId: string | null
  profile: {
    login?: string | null
    name: string
    phone: string | null
    email: string | null
    preferredLanguage?: string | null
    marketingOptIn?: boolean
    transactionalOptIn?: boolean
    avatarUrl?: string | null
    nickname?: string | null
    birthday?: string | null
    city?: string | null
    preferredTimeWindow?: string | null
    favoriteSegment?: string | null
    seatPreference?: string | null
    favoriteClubIds?: string[]
  }
}

type DeviceSession = {
  sessionId: string
  deviceName: string
  ipAddress: string | null
  lastSeenAt: string
  createdAt: string
  expiresAt: string
  isCurrent: boolean
}

type SupportCase = {
  disputeId: string
  type: string
  status: string
  subject: string | null
  description: string | null
  resolutionSummary: string | null
  createdAt: string
  updatedAt: string
  booking: {
    id: number
    status: string
    checkIn: string
    checkOut: string
    roomId?: number
  } | null
  club: {
    id: string
    name: string
    slug: string
  } | null
}

type PrivacyRequest = {
  requestId: string
  createdAt: string
  text?: string
  requestType?: string
  reason?: string
  status?: string
}

type PrivacyRequestView = {
  requestId: string
  requestType: string
  reason: string
  status: string
  createdAt: string
}

type MembershipClubOption = {
  id: string
  name: string
}

function formatDateRange(startIso: string, endIso: string) {
  const start = new Date(startIso)
  const end = new Date(endIso)
  return `${start.toLocaleDateString()} ${start.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  })} - ${end.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
}

function formatDate(value: string | null) {
  if (!value) return 'No expiry'
  return new Date(value).toLocaleString()
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString()
}

function normalizeRoomName(value: string) {
  if (/auto room/i.test(value)) return 'Operational Room'
  return value
}

function bookingBucket(booking: Booking) {
  if (booking.status === 'CANCELED') return 'cancelled'
  if (new Date(booking.checkOut) < new Date()) return 'past'
  return 'upcoming'
}

function formatMoney(amountKzt: number, _currency: string) {
  const rounded = Math.max(0, Math.trunc(amountKzt))
  try {
    return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(rounded)} KZT`
  } catch {
    return `${rounded} KZT`
  }
}

function maskPhone(phone: string | null | undefined) {
  if (!phone) return 'Not set'
  const visibleTail = phone.slice(-4)
  return `${phone.slice(0, 3)}***${visibleTail}`
}

function maskEmail(email: string | null | undefined) {
  if (!email) return 'Not set'
  const [local, domain] = email.split('@')
  if (!domain) return 'Not set'
  if (local.length <= 2) return `${local[0] || '*'}*@${domain}`
  return `${local.slice(0, 2)}***@${domain}`
}

function parsePrivacyText(item: PrivacyRequest): PrivacyRequestView {
  if (item.requestType || item.reason || item.status) {
    return {
      requestId: item.requestId,
      requestType: item.requestType || 'UNKNOWN',
      reason: item.reason || '',
      status: item.status || 'REQUESTED',
      createdAt: item.createdAt,
    }
  }

  if (!item.text) {
    return {
      requestId: item.requestId,
      requestType: 'UNKNOWN',
      reason: '',
      status: 'REQUESTED',
      createdAt: item.createdAt,
    }
  }

  try {
    const parsed = JSON.parse(item.text) as {
      requestType?: string
      reason?: string
      status?: string
    }
    return {
      requestId: item.requestId,
      requestType: parsed.requestType || 'UNKNOWN',
      reason: parsed.reason || '',
      status: parsed.status || 'REQUESTED',
      createdAt: item.createdAt,
    }
  } catch {
    return {
      requestId: item.requestId,
      requestType: 'UNKNOWN',
      reason: item.text,
      status: 'REQUESTED',
      createdAt: item.createdAt,
    }
  }
}

async function readJson<T>(response: Response, fallback: string) {
  const payload = (await response.json()) as T | { error?: string }
  if (!response.ok) {
    throw new Error((payload as { error?: string }).error || fallback)
  }
  return payload as T
}

export default function ClientSection({ section }: { section: string }) {
  const knownSections = new Set([
    'dashboard',
    'my-bookings',
    'payments',
    'wallet',
    'memberships',
    'profile',
    'support',
    'security',
    'privacy',
  ])

  const [bookings, setBookings] = useState<Booking[]>([])
  const [payments, setPayments] = useState<PaymentItem[]>([])
  const [profile, setProfile] = useState<MeResponse['profile'] | null>(null)
  const [profileForm, setProfileForm] = useState({
    login: '',
    name: '',
    phone: '',
    email: '',
    preferredLanguage: 'en',
    marketingOptIn: false,
    transactionalOptIn: true,
    nickname: '',
    birthday: '',
    city: '',
    preferredTimeWindow: '',
    favoriteSegment: '',
    seatPreference: '',
    favoriteClubIdsRaw: '',
  })
  const [profileOtpCode, setProfileOtpCode] = useState('')
  const [profileBusy, setProfileBusy] = useState(false)
  const [passwordBusy, setPasswordBusy] = useState(false)
  const [passwordForm, setPasswordForm] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
    revokeOtherSessions: true,
  })
  const [avatarBusy, setAvatarBusy] = useState(false)

  const [activeClubId, setActiveClubId] = useState<string | null>(null)
  const [membershipClubId, setMembershipClubId] = useState<string | null>(null)
  const [membershipClubOptions, setMembershipClubOptions] = useState<MembershipClubOption[]>([])
  const [membershipSnapshot, setMembershipSnapshot] = useState<MembershipSnapshotResponse | null>(null)

  const [bookingDetailsById, setBookingDetailsById] = useState<Record<number, BookingDetail>>({})
  const [loadingBookingDetailId, setLoadingBookingDetailId] = useState<number | null>(null)

  const [deviceSessions, setDeviceSessions] = useState<DeviceSession[]>([])
  const [sessionsBusy, setSessionsBusy] = useState(false)

  const [supportCases, setSupportCases] = useState<SupportCase[]>([])
  const [supportForm, setSupportForm] = useState({
    bookingId: '',
    type: 'BOOKING_ISSUE',
    subject: '',
    description: '',
  })
  const [supportBusy, setSupportBusy] = useState(false)

  const [privacyRequests, setPrivacyRequests] = useState<PrivacyRequestView[]>([])
  const [privacyBusy, setPrivacyBusy] = useState(false)
  const [privacyOtpCode, setPrivacyOtpCode] = useState('')
  const [bookingFilters, setBookingFilters] = useState({
    clubId: '',
    status: 'ALL',
    paymentStatus: 'ALL',
    from: '',
    to: '',
  })

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [busyBookingId, setBusyBookingId] = useState<number | null>(null)

  async function loadMembershipSnapshotForClub(clubId: string) {
    try {
      const membershipsResponse = await fetch(
        `/api/me/memberships?clubId=${encodeURIComponent(clubId)}`,
        { cache: 'no-store' },
      )
      const memberships = await readJson<MembershipSnapshotResponse>(
        membershipsResponse,
        'Failed to load memberships.',
      )
      setMembershipSnapshot(memberships)
    } catch {
      setMembershipSnapshot({
        clubId,
        entitlements: [],
        transactions: [],
        availablePlans: [],
      })
    }
  }

  async function loadData() {
    const [bookingsResponse, paymentsResponse, meResponse] = await Promise.all([
      fetch('/api/client/bookings?pageSize=50', { cache: 'no-store' }),
      fetch('/api/client/payments?pageSize=50', { cache: 'no-store' }),
      fetch('/api/client/me', { cache: 'no-store' }),
    ])

    const bookingData = await readJson<{ items: Booking[] }>(
      bookingsResponse,
      'Failed to load bookings.',
    )
    const paymentData = await readJson<{ items: PaymentItem[] }>(
      paymentsResponse,
      'Failed to load payments.',
    )
    const meData = await readJson<MeResponse>(meResponse, 'Failed to load profile.')

    setBookings(bookingData.items)
    setPayments(paymentData.items)
    setProfile(meData.profile)
    setProfileForm({
      login: meData.profile.login || '',
      name: meData.profile.name || '',
      phone: meData.profile.phone || '',
      email: meData.profile.email || '',
      preferredLanguage: meData.profile.preferredLanguage || 'en',
      marketingOptIn: meData.profile.marketingOptIn ?? false,
      transactionalOptIn: meData.profile.transactionalOptIn ?? true,
      nickname: meData.profile.nickname || '',
      birthday: meData.profile.birthday || '',
      city: meData.profile.city || '',
      preferredTimeWindow: meData.profile.preferredTimeWindow || '',
      favoriteSegment: meData.profile.favoriteSegment || '',
      seatPreference: meData.profile.seatPreference || '',
      favoriteClubIdsRaw: (meData.profile.favoriteClubIds || []).join(', '),
    })
    setActiveClubId(meData.activeClubId)

    const bookingClubOptions = new Map<string, MembershipClubOption>()
    for (const booking of bookingData.items) {
      if (!booking.club?.id || !booking.club?.name) continue
      bookingClubOptions.set(booking.club.id, {
        id: booking.club.id,
        name: booking.club.name,
      })
    }
    const options = Array.from(bookingClubOptions.values())
    setMembershipClubOptions(options)

    const fallbackClubId = options[0]?.id || null
    const preferredClubId = meData.activeClubId || fallbackClubId
    setMembershipClubId(preferredClubId)
    if (preferredClubId) {
      await loadMembershipSnapshotForClub(preferredClubId)
    } else {
      setMembershipSnapshot(null)
    }
  }

  async function loadSecuritySessions() {
    const response = await fetch('/api/client/sessions', { cache: 'no-store' })
    const payload = await readJson<{ items: DeviceSession[] }>(
      response,
      'Failed to load security sessions.',
    )
    setDeviceSessions(payload.items)
  }

  async function loadSupportCases() {
    const response = await fetch('/api/client/tickets', { cache: 'no-store' })
    const payload = await readJson<{ items: SupportCase[] }>(response, 'Failed to load support cases.')
    setSupportCases(payload.items)
  }

  async function loadPrivacyRequests() {
    const response = await fetch('/api/client/privacy/requests', { cache: 'no-store' })
    const payload = await readJson<{ items: PrivacyRequest[] }>(
      response,
      'Failed to load privacy requests.',
    )
    setPrivacyRequests(payload.items.map(parsePrivacyText))
  }

  useEffect(() => {
    let mounted = true
    async function run() {
      try {
        setLoading(true)
        setError(null)
        await loadData()

        if (section === 'security' || section === 'profile') {
          await loadSecuritySessions()
        }
        if (section === 'support' || section === 'profile') {
          await loadSupportCases()
        }
        if (section === 'privacy' || section === 'profile') {
          await loadPrivacyRequests()
        }
      } catch (loadError) {
        if (mounted) {
          setError(loadError instanceof Error ? loadError.message : 'Failed to load cabinet data.')
        }
      } finally {
        if (mounted) setLoading(false)
      }
    }
    void run()
    return () => {
      mounted = false
    }
  }, [section])

  async function handleCancelBooking(bookingId: number) {
    setBusyBookingId(bookingId)
    setMessage(null)
    setError(null)
    try {
      const response = await fetch(`/api/client/bookings/${bookingId}/cancel`, {
        method: 'POST',
      })
      await readJson(response, 'Failed to cancel booking.')
      setBookings((current) =>
        current.map((booking) =>
          booking.id === bookingId ? { ...booking, status: 'CANCELED' } : booking,
        ),
      )
      setMessage(`Booking #${bookingId} canceled.`)
      await loadData()
    } catch (cancelError) {
      setError(cancelError instanceof Error ? cancelError.message : 'Failed to cancel booking.')
    } finally {
      setBusyBookingId(null)
    }
  }

  async function handleLogoutAction(type: 'logout' | 'logout_all') {
    setSessionsBusy(true)
    setError(null)
    try {
      const endpoint =
        type === 'logout_all' ? '/api/client/sessions/logout_all' : '/api/auth/logout'
      const response = await fetch(endpoint, {
        method: 'POST',
      })
      await readJson<{ ok: true }>(response, 'Failed to end session.')
      window.location.href = '/'
    } catch (sessionError) {
      setError(sessionError instanceof Error ? sessionError.message : 'Failed to end session.')
      setSessionsBusy(false)
    }
  }

  async function handleLoadBookingDetails(bookingId: number) {
    if (bookingDetailsById[bookingId]) {
      setBookingDetailsById((current) => {
        const copy = { ...current }
        delete copy[bookingId]
        return copy
      })
      return
    }

    setLoadingBookingDetailId(bookingId)
    setError(null)
    try {
      const response = await fetch(`/api/client/bookings/${bookingId}`, { cache: 'no-store' })
      const detail = await readJson<BookingDetail>(response, 'Failed to load booking details.')
      setBookingDetailsById((current) => ({
        ...current,
        [bookingId]: detail,
      }))
    } catch (detailError) {
      setError(detailError instanceof Error ? detailError.message : 'Failed to load booking details.')
    } finally {
      setLoadingBookingDetailId(null)
    }
  }

  async function handleSaveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setProfileBusy(true)
    setMessage(null)
    setError(null)

    try {
      const targetName = profileForm.name.trim()
      const targetPhone = profileForm.phone.trim()
      const targetEmail = profileForm.email.trim()
      const currentPhone = profile?.phone?.trim() || ''
      const currentEmail = profile?.email?.trim() || ''
      const identityChanged = targetPhone !== currentPhone || targetEmail !== currentEmail
      let revokedSessions = 0

      if (identityChanged) {
        const identityResponse = await fetch('/api/client/me/identity/change', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            newPhone: targetPhone || null,
            newEmail: targetEmail || null,
            otpCode: profileOtpCode || undefined,
            revokeOtherSessions: true,
          }),
        })
        const identityPayload = (await identityResponse.json()) as {
          error?: string
          code?: string
          revokedSessions?: number
        }
        if (!identityResponse.ok) {
          throw new Error(identityPayload.error || 'Failed to update phone/email.')
        }
        revokedSessions = identityPayload.revokedSessions || 0
      }

      const profileResponse = await fetch('/api/client/me', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          login: profileForm.login.trim(),
          name: targetName,
          preferredLanguage: profileForm.preferredLanguage || 'en',
          marketingOptIn: profileForm.marketingOptIn,
          transactionalOptIn: profileForm.transactionalOptIn,
          nickname: profileForm.nickname || null,
          birthday: profileForm.birthday || null,
          city: profileForm.city || null,
          preferredTimeWindow: profileForm.preferredTimeWindow || null,
          favoriteSegment: profileForm.favoriteSegment || null,
          seatPreference: profileForm.seatPreference || null,
          favoriteClubIds: profileForm.favoriteClubIdsRaw
            .split(',')
            .map((item) => item.trim())
            .filter(Boolean),
        }),
      })
      const profilePayload = (await profileResponse.json()) as {
        error?: string
        profile?: MeResponse['profile']
      }
      if (!profileResponse.ok) {
        throw new Error(profilePayload.error || 'Failed to update profile.')
      }

      const nextProfile = profilePayload.profile
      if (nextProfile) {
        setProfile(nextProfile)
        setProfileForm({
          login: nextProfile.login || '',
          name: nextProfile.name || '',
          phone: nextProfile.phone || '',
          email: nextProfile.email || '',
          preferredLanguage: nextProfile.preferredLanguage || 'en',
          marketingOptIn: nextProfile.marketingOptIn ?? false,
          transactionalOptIn: nextProfile.transactionalOptIn ?? true,
          nickname: nextProfile.nickname || '',
          birthday: nextProfile.birthday || '',
          city: nextProfile.city || '',
          preferredTimeWindow: nextProfile.preferredTimeWindow || '',
          favoriteSegment: nextProfile.favoriteSegment || '',
          seatPreference: nextProfile.seatPreference || '',
          favoriteClubIdsRaw: (nextProfile.favoriteClubIds || []).join(', '),
        })
      }
      setProfileOtpCode('')
      setMessage(
        revokedSessions > 0
          ? `Profile updated. Revoked ${revokedSessions} other session(s).`
          : 'Profile updated.',
      )
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : 'Failed to update profile.')
    } finally {
      setProfileBusy(false)
    }
  }

  async function handleChangePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setPasswordBusy(true)
    setMessage(null)
    setError(null)
    try {
      const currentPassword = passwordForm.currentPassword.trim()
      const newPassword = passwordForm.newPassword.trim()
      const confirmPassword = passwordForm.confirmPassword.trim()
      if (!newPassword) {
        throw new Error('New password is required.')
      }
      if (newPassword !== confirmPassword) {
        throw new Error('New password and confirmation do not match.')
      }

      const response = await fetch('/api/client/me/password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          currentPassword: currentPassword || null,
          newPassword,
          revokeOtherSessions: passwordForm.revokeOtherSessions,
        }),
      })
      const payload = (await response.json()) as {
        error?: string
        revokedSessions?: number
      }
      if (!response.ok) {
        throw new Error(payload.error || 'Failed to change password.')
      }

      setPasswordForm({
        currentPassword: '',
        newPassword: '',
        confirmPassword: '',
        revokeOtherSessions: passwordForm.revokeOtherSessions,
      })
      setMessage(
        payload.revokedSessions && payload.revokedSessions > 0
          ? `Password changed. Revoked ${payload.revokedSessions} other session(s).`
          : 'Password changed.',
      )
    } catch (passwordError) {
      setError(passwordError instanceof Error ? passwordError.message : 'Failed to change password.')
    } finally {
      setPasswordBusy(false)
    }
  }

  async function handleAvatarUpload(file: File | null) {
    if (!file) return
    setAvatarBusy(true)
    setMessage(null)
    setError(null)
    try {
      const form = new FormData()
      form.set('avatar', file)
      const response = await fetch('/api/client/avatar', {
        method: 'POST',
        body: form,
      })
      const payload = (await response.json()) as { avatarUrl?: string; error?: string }
      if (!response.ok) {
        throw new Error(payload.error || 'Failed to upload avatar.')
      }
      if (payload.avatarUrl) {
        setProfile((current) =>
          current
            ? {
                ...current,
                avatarUrl: payload.avatarUrl,
              }
            : current,
        )
      }
      setMessage('Avatar updated.')
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : 'Failed to upload avatar.')
    } finally {
      setAvatarBusy(false)
    }
  }

  async function handleRevokeSession(sessionId: string) {
    setSessionsBusy(true)
    setMessage(null)
    setError(null)
    try {
      const response = await fetch(`/api/me/sessions/${sessionId}/revoke`, {
        method: 'POST',
      })
      await readJson<{ ok: true }>(response, 'Failed to revoke session.')
      const current = deviceSessions.find((item) => item.sessionId === sessionId)
      if (current?.isCurrent) {
        window.location.href = '/'
        return
      }
      await loadSecuritySessions()
      setMessage('Session revoked.')
    } catch (revokeError) {
      setError(revokeError instanceof Error ? revokeError.message : 'Failed to revoke session.')
    } finally {
      setSessionsBusy(false)
    }
  }

  async function handleCreateSupportCase(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSupportBusy(true)
    setMessage(null)
    setError(null)

    try {
      const response = await fetch('/api/client/tickets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bookingId: supportForm.bookingId ? Number(supportForm.bookingId) : undefined,
          type: supportForm.type,
          subject: supportForm.subject,
          description: supportForm.description,
        }),
      })
      await readJson(response, 'Failed to create support request.')
      setSupportForm({
        bookingId: '',
        type: 'BOOKING_ISSUE',
        subject: '',
        description: '',
      })
      await loadSupportCases()
      setMessage('Support request created.')
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : 'Failed to create support request.')
    } finally {
      setSupportBusy(false)
    }
  }

  async function handleCreatePrivacyRequest(requestType: 'EXPORT' | 'ANONYMIZE') {
    setPrivacyBusy(true)
    setMessage(null)
    setError(null)

    try {
      const response = await fetch(
        requestType === 'EXPORT' ? '/api/client/privacy/export' : '/api/client/privacy/anonymize',
        {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          otpCode: privacyOtpCode,
          reason:
            requestType === 'EXPORT'
              ? 'Client requested personal data export.'
              : 'Client requested account anonymization.',
        }),
      },
      )
      await readJson(response, 'Failed to create privacy request.')
      await loadPrivacyRequests()
      setPrivacyOtpCode('')
      setMessage(`${requestType} request created.`)
    } catch (privacyError) {
      setError(privacyError instanceof Error ? privacyError.message : 'Failed to create privacy request.')
    } finally {
      setPrivacyBusy(false)
    }
  }

  const filteredBookings = useMemo(() => {
    const fromBoundary = bookingFilters.from ? new Date(`${bookingFilters.from}T00:00:00`) : null
    const toBoundary = bookingFilters.to ? new Date(`${bookingFilters.to}T23:59:59`) : null
    return bookings.filter((booking) => {
      if (bookingFilters.clubId && booking.club?.id !== bookingFilters.clubId) return false
      if (bookingFilters.status !== 'ALL' && booking.status !== bookingFilters.status) return false
      if (bookingFilters.paymentStatus !== 'ALL' && booking.paymentStatus !== bookingFilters.paymentStatus) {
        return false
      }
      const checkIn = new Date(booking.checkIn)
      if (fromBoundary && checkIn < fromBoundary) return false
      if (toBoundary && checkIn > toBoundary) return false
      return true
    })
  }, [bookingFilters, bookings])

  const bookingFilterClubOptions = useMemo(() => {
    const map = new Map<string, string>()
    for (const booking of bookings) {
      if (!booking.club?.id || !booking.club?.name) continue
      map.set(booking.club.id, booking.club.name)
    }
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }))
  }, [bookings])

  const bookingsByTab = useMemo(() => {
    return {
      upcoming: filteredBookings.filter((booking) => bookingBucket(booking) === 'upcoming'),
      past: filteredBookings.filter((booking) => bookingBucket(booking) === 'past'),
      cancelled: filteredBookings.filter((booking) => bookingBucket(booking) === 'cancelled'),
    }
  }, [filteredBookings])

  const profileStats = useMemo(() => {
    const upcomingCount = bookingsByTab.upcoming.length
    const pastCount = bookingsByTab.past.length
    const cancelledCount = bookingsByTab.cancelled.length
    const noShowCount = bookings.filter((booking) => booking.status === 'NO_SHOW').length
    const totalPaidCents = payments
      .filter((payment) => payment.status === 'PAID')
      .reduce((sum, payment) => sum + payment.amountCents, 0)
    const pendingPaymentCount = payments.filter((payment) => payment.status !== 'PAID').length
    const walletBalance = (membershipSnapshot?.entitlements || []).reduce(
      (sum, item) => sum + Math.max(0, item.walletBalance ?? 0),
      0,
    )
    const activeEntitlements = (membershipSnapshot?.entitlements || []).filter(
      (item) => item.status === 'ACTIVE' || item.computedStatus === 'ACTIVE',
    ).length
    const lastVisitIso = bookings
      .map((booking) => booking.checkIn)
      .sort((a, b) => +new Date(b) - +new Date(a))[0]

    const riskLevel =
      noShowCount >= 3 || cancelledCount >= 8
        ? 'HIGH'
        : noShowCount >= 1 || cancelledCount >= 3
          ? 'MEDIUM'
          : 'LOW'

    return {
      upcomingCount,
      pastCount,
      cancelledCount,
      noShowCount,
      totalPaidCents,
      pendingPaymentCount,
      walletBalance,
      activeEntitlements,
      supportOpenCount: supportCases.filter((item) => item.status !== 'RESOLVED' && item.status !== 'CLOSED').length,
      privacyRequestCount: privacyRequests.length,
      deviceCount: deviceSessions.length,
      lastVisitIso: lastVisitIso || null,
      riskLevel,
    }
  }, [bookings, bookingsByTab, deviceSessions.length, membershipSnapshot?.entitlements, payments, privacyRequests.length, supportCases])

  const profileTimeline = useMemo(() => {
    const events: Array<{ id: string; type: string; at: string; title: string; detail: string }> = []

    for (const booking of bookings) {
      events.push({
        id: `booking-${booking.id}-${booking.checkIn}`,
        type: 'BOOKING',
        at: booking.checkIn,
        title: `Booking #${booking.id} ${booking.status}`,
        detail: `${booking.room.name} · ${formatDateRange(booking.checkIn, booking.checkOut)}`,
      })
    }

    for (const payment of payments) {
      events.push({
        id: `payment-${payment.id}-${payment.createdAt}`,
        type: 'PAYMENT',
        at: payment.createdAt,
        title: `Payment ${payment.status}`,
        detail: `${Math.trunc(payment.amountCents)} KZT via ${payment.method} · booking #${payment.bookingId}`,
      })
    }

    for (const item of supportCases) {
      events.push({
        id: `support-${item.disputeId}-${item.updatedAt}`,
        type: 'SUPPORT',
        at: item.updatedAt,
        title: `Support ${item.status}`,
        detail: item.subject || item.type,
      })
    }

    for (const item of privacyRequests) {
      events.push({
        id: `privacy-${item.requestId}-${item.createdAt}`,
        type: 'PRIVACY',
        at: item.createdAt,
        title: `Privacy ${item.requestType}`,
        detail: item.status,
      })
    }

    for (const session of deviceSessions) {
      events.push({
        id: `session-${session.sessionId}-${session.lastSeenAt}`,
        type: 'SECURITY',
        at: session.lastSeenAt,
        title: session.isCurrent ? 'Current device activity' : 'Device activity',
        detail: `${session.deviceName} · IP ${session.ipAddress || 'N/A'}`,
      })
    }

    return events
      .sort((a, b) => +new Date(b.at) - +new Date(a.at))
      .slice(0, 25)
  }, [bookings, deviceSessions, payments, privacyRequests, supportCases])

  if (loading) {
    return <p className="text-sm text-[var(--muted)]">Loading cabinet data...</p>
  }

  if (error) {
    return (
      <div className="space-y-3">
        <h2 className="text-2xl font-semibold">Client Cabinet</h2>
        <article className="panel-strong rounded-lg border-red-400/40 p-4 text-sm text-red-700 dark:text-red-300">
          <p>{error}</p>
          <button
            type="button"
            className="mt-2 rounded-lg border border-[var(--border)] px-3 py-1 text-xs hover:bg-white/10"
            onClick={() => window.location.reload()}
          >
            Retry
          </button>
        </article>
      </div>
    )
  }

  if (!knownSections.has(section)) {
    return (
      <div className="space-y-2">
        <h2 className="text-2xl font-semibold">Access denied</h2>
        <p className="text-sm text-[var(--muted)]">
          This client section is unavailable for your current capabilities.
        </p>
      </div>
    )
  }

  if (section === 'my-bookings') {
    return (
      <div className="space-y-4">
        <h2 className="text-2xl font-semibold">My Bookings</h2>
        {message ? <p className="text-sm text-emerald-700 dark:text-emerald-300">{message}</p> : null}
        <article className="panel-strong grid gap-3 p-3 text-sm md:grid-cols-5">
          <label className="flex flex-col gap-1">
            Club
            <select
              className="rounded-lg border border-[var(--border)] bg-transparent px-3 py-2"
              value={bookingFilters.clubId}
              onChange={(event) =>
                setBookingFilters((current) => ({ ...current, clubId: event.target.value }))
              }
            >
              <option value="">All clubs</option>
              {bookingFilterClubOptions.map((club) => (
                <option key={club.id} value={club.id}>
                  {club.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            Status
            <select
              className="rounded-lg border border-[var(--border)] bg-transparent px-3 py-2"
              value={bookingFilters.status}
              onChange={(event) =>
                setBookingFilters((current) => ({ ...current, status: event.target.value }))
              }
            >
              <option value="ALL">All</option>
              <option value="HELD">Held</option>
              <option value="PENDING">Pending</option>
              <option value="CONFIRMED">Confirmed</option>
              <option value="CHECKED_IN">Checked-in</option>
              <option value="COMPLETED">Completed</option>
              <option value="CANCELED">Canceled</option>
              <option value="NO_SHOW">No-show</option>
            </select>
          </label>
          <label className="flex flex-col gap-1">
            Payment
            <select
              className="rounded-lg border border-[var(--border)] bg-transparent px-3 py-2"
              value={bookingFilters.paymentStatus}
              onChange={(event) =>
                setBookingFilters((current) => ({ ...current, paymentStatus: event.target.value }))
              }
            >
              <option value="ALL">All</option>
              <option value="PAID">Paid</option>
              <option value="PENDING">Pending</option>
              <option value="REFUNDED">Refunded</option>
            </select>
          </label>
          <label className="flex flex-col gap-1">
            From
            <input
              type="date"
              className="rounded-lg border border-[var(--border)] bg-transparent px-3 py-2"
              value={bookingFilters.from}
              onChange={(event) =>
                setBookingFilters((current) => ({ ...current, from: event.target.value }))
              }
            />
          </label>
          <label className="flex flex-col gap-1">
            To
            <input
              type="date"
              className="rounded-lg border border-[var(--border)] bg-transparent px-3 py-2"
              value={bookingFilters.to}
              onChange={(event) =>
                setBookingFilters((current) => ({ ...current, to: event.target.value }))
              }
            />
          </label>
        </article>
        {(['upcoming', 'past', 'cancelled'] as const).map((tab) => (
          <section key={tab} className="space-y-2">
            <h3 className="text-lg font-semibold capitalize">{tab}</h3>
            {bookingsByTab[tab].length === 0 ? (
              <p className="text-sm text-[var(--muted)]">No {tab} bookings.</p>
            ) : (
              bookingsByTab[tab].map((booking) => {
                const detail = bookingDetailsById[booking.id]
                return (
                  <article key={booking.id} className="panel-strong space-y-2 p-3">
                    <p className="font-medium">
                      {booking.club?.name || 'Club'} · Booking #{booking.id}
                    </p>
                    <p className="text-sm text-[var(--muted)]">
                      {formatDateRange(booking.checkIn, booking.checkOut)}
                    </p>
                    <p className="text-xs text-[var(--muted)]">
                      Seat: {booking.seatLabelSnapshot || booking.seatId || 'N/A'} · Type:{' '}
                      {booking.seatSegment?.segmentName || booking.seatSegment?.segmentId || 'N/A'} · Room:{' '}
                      {normalizeRoomName(booking.room.name)}
                    </p>
                    <p className="text-xs">
                      Status: {booking.status} · Payment: {booking.paymentStatus}
                    </p>
                    {typeof booking.priceTotalCents === 'number' ? (
                      <p className="text-xs text-[var(--muted)]">
                        Total: {formatMoney(booking.priceTotalCents, booking.priceCurrency || 'KZT')}
                      </p>
                    ) : null}
                    {booking.notes ? (
                      <p className="text-xs text-[var(--muted)]">Notes: {booking.notes}</p>
                    ) : null}

                    <div className="flex flex-wrap gap-2">
                      <Link
                        href={`/me/bookings/${booking.id}`}
                        className="rounded-lg border border-[var(--border)] px-3 py-1 text-xs hover:bg-white/10"
                      >
                        Open full page
                      </Link>
                      <button
                        type="button"
                        className="rounded-lg border border-[var(--border)] px-3 py-1 text-xs hover:bg-white/10 disabled:opacity-50"
                        disabled={loadingBookingDetailId === booking.id}
                        onClick={() => void handleLoadBookingDetails(booking.id)}
                      >
                        {detail ? 'Hide details' : loadingBookingDetailId === booking.id ? 'Loading...' : 'View details'}
                      </button>

                      {tab === 'upcoming' &&
                      ['HELD', 'PENDING', 'CONFIRMED', 'CHECKED_IN'].includes(booking.status) ? (
                        <button
                          type="button"
                          className="rounded-lg border border-[var(--border)] px-3 py-1 text-xs hover:bg-white/10 disabled:opacity-50"
                          disabled={busyBookingId === booking.id}
                          onClick={() => void handleCancelBooking(booking.id)}
                        >
                          {busyBookingId === booking.id ? 'Cancelling...' : 'Cancel booking'}
                        </button>
                      ) : null}
                    </div>

                    {detail ? (
                      <article className="rounded-lg border border-[var(--border)] bg-black/10 p-3 text-xs">
                        <p>Guest: {detail.guestName} ({detail.guestEmail})</p>
                        <p>Seat: {detail.seatLabelSnapshot || 'N/A'}</p>
                        <p>Seat type: {detail.seatSegment?.segmentName || detail.seatSegment?.segmentId || 'N/A'}</p>
                        <p>Room: {normalizeRoomName(detail.room.name)}</p>
                        <p>
                          Slot: {detail.slot ? `${new Date(detail.slot.startAtUtc).toLocaleString()} - ${new Date(detail.slot.endAtUtc).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : 'Legacy booking'}
                        </p>
                        {typeof detail.priceTotalCents === 'number' ? (
                          <p>
                            Total: {formatMoney(detail.priceTotalCents, detail.priceCurrency || 'KZT')}
                          </p>
                        ) : null}
                        <p>
                          Payments: {detail.payments.length === 0
                            ? 'none'
                            : detail.payments
                                .map((item) => `${Math.trunc(item.amountCents)} KZT (${item.status})`)
                                .join(', ')}
                        </p>
                      </article>
                    ) : null}
                  </article>
                )
              })
            )}
          </section>
        ))}
      </div>
    )
  }

  if (section === 'payments') {
    const totalPaidCents = payments
      .filter((payment) => payment.status === 'PAID')
      .reduce((sum, payment) => sum + payment.amountCents, 0)

    return (
      <div className="space-y-3">
        <h2 className="text-2xl font-semibold">Payments & Receipts</h2>
        <p className="text-sm">
          Total paid:{' '}
          <span className="font-semibold">
            {new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(Math.trunc(totalPaidCents))}
          </span>{' '}
          KZT
        </p>
        {payments.length === 0 ? (
          <p className="text-sm text-[var(--muted)]">No payments yet.</p>
        ) : (
          payments.map((payment) => (
            <article key={payment.id} className="panel-strong p-3 text-sm">
              <p>
                {Math.trunc(payment.amountCents)} KZT · {payment.method} · {payment.status}
              </p>
              <p className="text-xs text-[var(--muted)]">
                Booking #{payment.bookingId} · {new Date(payment.createdAt).toLocaleString()}
              </p>
            </article>
          ))
        )}
      </div>
    )
  }

  if (section === 'memberships' || section === 'wallet') {
    const entitlements = membershipSnapshot?.entitlements || []
    const transactions = membershipSnapshot?.transactions || []
    const availablePlans = membershipSnapshot?.availablePlans || []
    const walletBalance = entitlements.reduce(
      (sum, item) => sum + Math.max(0, item.walletBalance ?? 0),
      0,
    )

    return (
      <div className="space-y-4">
        <h2 className="text-2xl font-semibold">Packages & Wallet</h2>
        <article className="panel-strong p-4 text-sm">
          {membershipClubOptions.length > 0 ? (
            <label className="mb-3 flex max-w-md flex-col gap-1 text-xs text-[var(--muted)]">
              Membership club context
              <select
                className="rounded-lg border border-[var(--border)] bg-transparent px-3 py-2 text-sm text-[var(--text)]"
                value={membershipClubId || ''}
                onChange={(event) => {
                  const nextClubId = event.target.value || null
                  setMembershipClubId(nextClubId)
                  if (nextClubId) {
                    void loadMembershipSnapshotForClub(nextClubId)
                  } else {
                    setMembershipSnapshot(null)
                  }
                }}
              >
                {membershipClubOptions.map((club) => (
                  <option key={club.id} value={club.id}>
                    {club.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <p className="text-xs text-[var(--muted)]">Wallet balance</p>
          <p className="text-xl font-semibold">
            {formatMoney(walletBalance, membershipSnapshot?.availablePlans?.[0]?.currency || 'KZT')}
          </p>
          <p className="mt-2 text-xs text-[var(--muted)]">
            Top-up online is coming soon. Ask host/admin for offline top-up meanwhile.
          </p>
        </article>

        <section className="space-y-2">
          <h3 className="text-lg font-semibold">Active entitlements</h3>
          {entitlements.length === 0 ? (
            <p className="text-sm text-[var(--muted)]">No entitlements yet.</p>
          ) : (
            entitlements.map((item) => (
              <article key={item.entitlementId} className="panel-strong p-3 text-sm">
                <p className="font-medium">{item.plan?.name || item.type}</p>
                <p className="text-xs text-[var(--muted)]">
                  Status: {item.status}
                  {item.computedStatus ? ` · Computed: ${item.computedStatus}` : ''}
                </p>
                <p className="text-xs text-[var(--muted)]">Valid until: {formatDate(item.validTo)}</p>
                <p className="mt-1 text-xs">
                  Minutes: {item.remainingMinutes ?? '—'} · Sessions: {item.remainingSessions ?? '—'} · Wallet:{' '}
                  {item.walletBalance ?? '—'}
                </p>
              </article>
            ))
          )}
        </section>

        <section className="space-y-2">
          <h3 className="text-lg font-semibold">Available plans</h3>
          {availablePlans.length === 0 ? (
            <p className="text-sm text-[var(--muted)]">No active plans in this club.</p>
          ) : (
            availablePlans.map((plan) => (
              <article key={plan.planId} className="panel-strong p-3 text-sm">
                <p className="font-medium">{plan.name}</p>
                <p className="text-xs text-[var(--muted)]">
                  {plan.type} · {formatMoney(plan.priceAmount, plan.currency)} · value {plan.valueAmount}
                </p>
              </article>
            ))
          )}
        </section>

        <section className="space-y-2">
          <h3 className="text-lg font-semibold">History</h3>
          {transactions.length === 0 ? (
            <p className="text-sm text-[var(--muted)]">No membership transactions yet.</p>
          ) : (
            transactions.slice(0, 30).map((tx) => (
              <article key={tx.txId} className="panel-strong p-3 text-sm">
                <p className="font-medium">
                  {tx.txType} · entitlement {tx.entitlementId}
                </p>
                <p className="text-xs text-[var(--muted)]">
                  amount {tx.amountDelta}, minutes {tx.minutesDelta}, sessions {tx.sessionsDelta}
                </p>
                <p className="text-xs text-[var(--muted)]">
                  {new Date(tx.createdAt).toLocaleString()}
                  {tx.bookingId ? ` · booking #${tx.bookingId}` : ''}
                  {tx.reason ? ` · ${tx.reason}` : ''}
                </p>
              </article>
            ))
          )}
        </section>

        {!activeClubId ? (
          <p className="text-sm text-[var(--muted)]">
            Showing membership data for current context when available. Club-specific details can vary.
          </p>
        ) : null}
      </div>
    )
  }

  if (section === 'profile') {
    return (
      <div className="space-y-5">
        <h2 className="text-2xl font-semibold">Customer Profile (360)</h2>
        {message ? <p className="text-sm text-emerald-700 dark:text-emerald-300">{message}</p> : null}

        <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          <article className="panel-strong p-3 text-sm">
            <p className="text-xs text-[var(--muted)]">Upcoming bookings</p>
            <p className="mt-1 text-2xl font-semibold">{profileStats.upcomingCount}</p>
          </article>
          <article className="panel-strong p-3 text-sm">
            <p className="text-xs text-[var(--muted)]">Completed/Past</p>
            <p className="mt-1 text-2xl font-semibold">{profileStats.pastCount}</p>
          </article>
          <article className="panel-strong p-3 text-sm">
            <p className="text-xs text-[var(--muted)]">Cancelled / no-show</p>
            <p className="mt-1 text-2xl font-semibold">
              {profileStats.cancelledCount} / {profileStats.noShowCount}
            </p>
          </article>
          <article className="panel-strong p-3 text-sm">
            <p className="text-xs text-[var(--muted)]">Total paid</p>
            <p className="mt-1 text-2xl font-semibold">
              {formatMoney(profileStats.totalPaidCents, membershipSnapshot?.availablePlans?.[0]?.currency || 'KZT')}
            </p>
          </article>
          <article className="panel-strong p-3 text-sm">
            <p className="text-xs text-[var(--muted)]">Risk level</p>
            <p
              className={`mt-1 text-2xl font-semibold ${
                profileStats.riskLevel === 'HIGH'
                  ? 'text-rose-700 dark:text-rose-300'
                  : profileStats.riskLevel === 'MEDIUM'
                    ? 'text-amber-700 dark:text-amber-300'
                    : 'text-emerald-700 dark:text-emerald-300'
              }`}
            >
              {profileStats.riskLevel}
            </p>
          </article>
        </section>

        <section className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <form
            className="panel-strong space-y-3 p-4 text-sm"
            onSubmit={(event) => void handleSaveProfile(event)}
          >
            <h3 className="text-lg font-semibold">Identity & preferences</h3>
            <div className="grid gap-3 md:grid-cols-[96px_minmax(0,1fr)] md:items-center">
              <div className="h-24 w-24 overflow-hidden rounded-full border border-[var(--border)] bg-black/10">
                {profile?.avatarUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={profile.avatarUrl} alt="Avatar" className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-xs text-[var(--muted)]">
                    No avatar
                  </div>
                )}
              </div>
              <label className="flex flex-col gap-1">
                Avatar (PNG/JPG/WEBP, up to 2MB)
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="rounded-lg border border-[var(--border)] bg-transparent px-3 py-2 text-xs"
                  disabled={avatarBusy}
                  onChange={(event) => {
                    const file = event.target.files?.[0] || null
                    void handleAvatarUpload(file)
                    event.currentTarget.value = ''
                  }}
                />
                {avatarBusy ? <span className="text-xs text-[var(--muted)]">Uploading...</span> : null}
              </label>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <label className="flex flex-col gap-1">
                Login
                <input
                  className="rounded-lg border border-[var(--border)] bg-transparent px-3 py-2"
                  value={profileForm.login}
                  onChange={(event) =>
                    setProfileForm((current) => ({ ...current, login: event.target.value }))
                  }
                  placeholder="my_login"
                />
              </label>

              <label className="flex flex-col gap-1">
                Name
                <input
                  className="rounded-lg border border-[var(--border)] bg-transparent px-3 py-2"
                  value={profileForm.name}
                  onChange={(event) =>
                    setProfileForm((current) => ({ ...current, name: event.target.value }))
                  }
                />
              </label>

              <label className="flex flex-col gap-1">
                Preferred language
                <select
                  className="rounded-lg border border-[var(--border)] bg-transparent px-3 py-2"
                  value={profileForm.preferredLanguage}
                  onChange={(event) =>
                    setProfileForm((current) => ({
                      ...current,
                      preferredLanguage: event.target.value,
                    }))
                  }
                >
                  <option value="en">English</option>
                  <option value="ru">Russian</option>
                  <option value="kk">Kazakh</option>
                </select>
              </label>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <label className="flex flex-col gap-1">
                Phone
                <input
                  className="rounded-lg border border-[var(--border)] bg-transparent px-3 py-2"
                  value={profileForm.phone}
                  onChange={(event) =>
                    setProfileForm((current) => ({ ...current, phone: event.target.value }))
                  }
                  placeholder="+77010000000"
                />
              </label>

              <label className="flex flex-col gap-1">
                Email
                <input
                  className="rounded-lg border border-[var(--border)] bg-transparent px-3 py-2"
                  value={profileForm.email}
                  onChange={(event) =>
                    setProfileForm((current) => ({ ...current, email: event.target.value }))
                  }
                  placeholder="name@example.com"
                />
              </label>
            </div>

            <div className="grid gap-3 md:grid-cols-3">
              <label className="flex flex-col gap-1">
                Nickname
                <input
                  className="rounded-lg border border-[var(--border)] bg-transparent px-3 py-2"
                  value={profileForm.nickname}
                  onChange={(event) =>
                    setProfileForm((current) => ({ ...current, nickname: event.target.value }))
                  }
                  placeholder="Optional nickname"
                />
              </label>

              <label className="flex flex-col gap-1">
                Birthday
                <input
                  type="date"
                  className="rounded-lg border border-[var(--border)] bg-transparent px-3 py-2"
                  value={profileForm.birthday}
                  onChange={(event) =>
                    setProfileForm((current) => ({ ...current, birthday: event.target.value }))
                  }
                />
              </label>

              <label className="flex flex-col gap-1">
                City
                <input
                  className="rounded-lg border border-[var(--border)] bg-transparent px-3 py-2"
                  value={profileForm.city}
                  onChange={(event) =>
                    setProfileForm((current) => ({ ...current, city: event.target.value }))
                  }
                  placeholder="City"
                />
              </label>
            </div>

            <div className="grid gap-3 md:grid-cols-3">
              <label className="flex flex-col gap-1">
                Preferred time window
                <input
                  className="rounded-lg border border-[var(--border)] bg-transparent px-3 py-2"
                  value={profileForm.preferredTimeWindow}
                  onChange={(event) =>
                    setProfileForm((current) => ({
                      ...current,
                      preferredTimeWindow: event.target.value,
                    }))
                  }
                  placeholder="morning / evening / night"
                />
              </label>
              <label className="flex flex-col gap-1">
                Favorite segment
                <input
                  className="rounded-lg border border-[var(--border)] bg-transparent px-3 py-2"
                  value={profileForm.favoriteSegment}
                  onChange={(event) =>
                    setProfileForm((current) => ({
                      ...current,
                      favoriteSegment: event.target.value,
                    }))
                  }
                  placeholder="VIP / Regular / Bootcamp"
                />
              </label>
              <label className="flex flex-col gap-1">
                Seat preference
                <input
                  className="rounded-lg border border-[var(--border)] bg-transparent px-3 py-2"
                  value={profileForm.seatPreference}
                  onChange={(event) =>
                    setProfileForm((current) => ({
                      ...current,
                      seatPreference: event.target.value,
                    }))
                  }
                  placeholder="near window / quiet corner"
                />
              </label>
            </div>

            <label className="flex flex-col gap-1">
              Favorite clubs (IDs, comma-separated)
              <input
                className="rounded-lg border border-[var(--border)] bg-transparent px-3 py-2"
                value={profileForm.favoriteClubIdsRaw}
                onChange={(event) =>
                  setProfileForm((current) => ({
                    ...current,
                    favoriteClubIdsRaw: event.target.value,
                  }))
                }
                placeholder="clubA, clubB"
              />
            </label>

            <label className="flex flex-col gap-1">
              OTP code (required for phone/email change)
              <input
                className="rounded-lg border border-[var(--border)] bg-transparent px-3 py-2"
                value={profileOtpCode}
                onChange={(event) => setProfileOtpCode(event.target.value)}
                placeholder="6-digit OTP"
              />
            </label>

            <div className="grid gap-2 md:grid-cols-2">
              <label className="flex items-center gap-2 rounded-lg border border-[var(--border)] px-3 py-2">
                <input
                  type="checkbox"
                  checked={profileForm.transactionalOptIn}
                  onChange={(event) =>
                    setProfileForm((current) => ({
                      ...current,
                      transactionalOptIn: event.target.checked,
                    }))
                  }
                />
                <span>Transactional notifications</span>
              </label>
              <label className="flex items-center gap-2 rounded-lg border border-[var(--border)] px-3 py-2">
                <input
                  type="checkbox"
                  checked={profileForm.marketingOptIn}
                  onChange={(event) =>
                    setProfileForm((current) => ({
                      ...current,
                      marketingOptIn: event.target.checked,
                    }))
                  }
                />
                <span>Marketing notifications</span>
              </label>
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                type="submit"
                className="rounded-lg border border-[var(--border)] px-3 py-1 text-xs hover:bg-white/10 disabled:opacity-50"
                disabled={profileBusy}
              >
                {profileBusy ? 'Saving...' : 'Save profile'}
              </button>
              <button
                type="button"
                className="rounded-lg border border-[var(--border)] px-3 py-1 text-xs hover:bg-white/10"
                onClick={() => {
                  setProfileForm({
                    login: profile?.login || '',
                    name: profile?.name || '',
                    phone: profile?.phone || '',
                    email: profile?.email || '',
                    preferredLanguage: profile?.preferredLanguage || 'en',
                    marketingOptIn: profile?.marketingOptIn ?? false,
                    transactionalOptIn: profile?.transactionalOptIn ?? true,
                    nickname: profile?.nickname || '',
                    birthday: profile?.birthday || '',
                    city: profile?.city || '',
                    preferredTimeWindow: profile?.preferredTimeWindow || '',
                    favoriteSegment: profile?.favoriteSegment || '',
                    seatPreference: profile?.seatPreference || '',
                    favoriteClubIdsRaw: (profile?.favoriteClubIds || []).join(', '),
                  })
                  setProfileOtpCode('')
                }}
              >
                Reset
              </button>
            </div>
          </form>

          <form onSubmit={handleChangePassword} className="panel-strong space-y-3 p-4 text-sm">
            <h3 className="text-base font-semibold">Change Password</h3>
            <div className="grid gap-3 md:grid-cols-3">
              <label className="flex flex-col gap-1">
                Current password
                <input
                  type="password"
                  className="rounded-lg border border-[var(--border)] bg-transparent px-3 py-2"
                  value={passwordForm.currentPassword}
                  onChange={(event) =>
                    setPasswordForm((current) => ({
                      ...current,
                      currentPassword: event.target.value,
                    }))
                  }
                  placeholder="Current password"
                />
              </label>
              <label className="flex flex-col gap-1">
                New password
                <input
                  type="password"
                  className="rounded-lg border border-[var(--border)] bg-transparent px-3 py-2"
                  value={passwordForm.newPassword}
                  onChange={(event) =>
                    setPasswordForm((current) => ({
                      ...current,
                      newPassword: event.target.value,
                    }))
                  }
                  placeholder="At least 8 characters"
                />
              </label>
              <label className="flex flex-col gap-1">
                Confirm password
                <input
                  type="password"
                  className="rounded-lg border border-[var(--border)] bg-transparent px-3 py-2"
                  value={passwordForm.confirmPassword}
                  onChange={(event) =>
                    setPasswordForm((current) => ({
                      ...current,
                      confirmPassword: event.target.value,
                    }))
                  }
                  placeholder="Repeat new password"
                />
              </label>
            </div>

            <label className="flex items-center gap-2 rounded-lg border border-[var(--border)] px-3 py-2">
              <input
                type="checkbox"
                checked={passwordForm.revokeOtherSessions}
                onChange={(event) =>
                  setPasswordForm((current) => ({
                    ...current,
                    revokeOtherSessions: event.target.checked,
                  }))
                }
              />
              <span>Logout other devices after password change</span>
            </label>

            <button
              type="submit"
              className="rounded-lg border border-[var(--border)] px-3 py-1 text-xs hover:bg-white/10 disabled:opacity-50"
              disabled={passwordBusy}
            >
              {passwordBusy ? 'Updating password...' : 'Update password'}
            </button>
          </form>

          <aside className="space-y-3">
            <article className="panel-strong p-4 text-sm">
              <h3 className="text-base font-semibold">Profile snapshot</h3>
              <p className="mt-2 text-xs text-[var(--muted)]">Login</p>
              <p>{profile?.login || 'Not set'}</p>
              <p className="mt-2 text-xs text-[var(--muted)]">Name</p>
              <p>{profile?.name || 'N/A'}</p>
              <p className="mt-2 text-xs text-[var(--muted)]">Nickname</p>
              <p>{profile?.nickname || 'Not set'}</p>
              <p className="mt-2 text-xs text-[var(--muted)]">Phone</p>
              <p>{maskPhone(profile?.phone)}</p>
              <p className="mt-2 text-xs text-[var(--muted)]">Email</p>
              <p>{maskEmail(profile?.email)}</p>
              <p className="mt-2 text-xs text-[var(--muted)]">City</p>
              <p>{profile?.city || 'Not set'}</p>
              <p className="mt-2 text-xs text-[var(--muted)]">Last visit</p>
              <p>{profileStats.lastVisitIso ? formatDateTime(profileStats.lastVisitIso) : 'No visits yet'}</p>
            </article>

            <article className="panel-strong p-4 text-sm">
              <h3 className="text-base font-semibold">Operations summary</h3>
              <p className="mt-2 text-xs text-[var(--muted)]">Open support requests</p>
              <p>{profileStats.supportOpenCount}</p>
              <p className="mt-2 text-xs text-[var(--muted)]">Pending payment items</p>
              <p>{profileStats.pendingPaymentCount}</p>
              <p className="mt-2 text-xs text-[var(--muted)]">Active entitlements</p>
              <p>{profileStats.activeEntitlements}</p>
              <p className="mt-2 text-xs text-[var(--muted)]">Wallet balance</p>
              <p>{formatMoney(profileStats.walletBalance, membershipSnapshot?.availablePlans?.[0]?.currency || 'KZT')}</p>
              <p className="mt-2 text-xs text-[var(--muted)]">Active devices</p>
              <p>{profileStats.deviceCount}</p>
            </article>

            <article className="panel-strong p-4 text-sm">
              <h3 className="text-base font-semibold">Quick actions</h3>
              <div className="mt-3 flex flex-wrap gap-2">
                <Link
                  href="/me/bookings"
                  className="rounded-lg border border-[var(--border)] px-3 py-1 text-xs hover:bg-white/10"
                >
                  Open bookings
                </Link>
                <Link
                  href="/me/invoices"
                  className="rounded-lg border border-[var(--border)] px-3 py-1 text-xs hover:bg-white/10"
                >
                  Open invoices
                </Link>
                <Link
                  href="/me/wallet"
                  className="rounded-lg border border-[var(--border)] px-3 py-1 text-xs hover:bg-white/10"
                >
                  Open wallet
                </Link>
                <Link
                  href="/me/security"
                  className="rounded-lg border border-[var(--border)] px-3 py-1 text-xs hover:bg-white/10"
                >
                  Security settings
                </Link>
              </div>
            </article>
          </aside>
        </section>

        <section className="panel-strong space-y-3 p-4 text-sm">
          <h3 className="text-lg font-semibold">Recent timeline</h3>
          {profileTimeline.length === 0 ? (
            <p className="text-[var(--muted)]">No activity yet.</p>
          ) : (
            <div className="space-y-2">
              {profileTimeline.map((event) => (
                <article key={event.id} className="rounded-lg border border-[var(--border)] p-3">
                  <p className="text-xs uppercase tracking-[0.12em] text-[var(--muted)]">{event.type}</p>
                  <p className="font-medium">{event.title}</p>
                  <p className="text-xs text-[var(--muted)]">{event.detail}</p>
                  <p className="mt-1 text-xs text-[var(--muted)]">{formatDateTime(event.at)}</p>
                </article>
              ))}
            </div>
          )}
        </section>
      </div>
    )
  }

  if (section === 'security') {
    return (
      <div className="space-y-4">
        <h2 className="text-2xl font-semibold">Security & Devices</h2>
        {message ? <p className="text-sm text-emerald-700 dark:text-emerald-300">{message}</p> : null}

        <article className="panel-strong space-y-2 p-4">
          <p className="text-sm font-medium">Session controls</p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="rounded-lg border border-[var(--border)] px-3 py-1 text-xs hover:bg-white/10 disabled:opacity-50"
              disabled={sessionsBusy}
              onClick={() => void handleLogoutAction('logout')}
            >
              Logout current session
            </button>
            <button
              type="button"
              className="rounded-lg border border-[var(--border)] px-3 py-1 text-xs hover:bg-white/10 disabled:opacity-50"
              disabled={sessionsBusy}
              onClick={() => void handleLogoutAction('logout_all')}
            >
              Logout all sessions
            </button>
          </div>
        </article>

        <section className="space-y-2">
          <h3 className="text-lg font-semibold">Active devices</h3>
          {deviceSessions.length === 0 ? (
            <p className="text-sm text-[var(--muted)]">No active sessions.</p>
          ) : (
            deviceSessions.map((session) => (
              <article key={session.sessionId} className="panel-strong p-3 text-sm">
                <p className="font-medium">{session.deviceName}</p>
                <p className="text-xs text-[var(--muted)]">
                  IP: {session.ipAddress || 'N/A'} · Last seen: {new Date(session.lastSeenAt).toLocaleString()}
                </p>
                <p className="text-xs text-[var(--muted)]">
                  Created: {new Date(session.createdAt).toLocaleString()}
                  {session.isCurrent ? ' · current session' : ''}
                </p>
                {!session.isCurrent ? (
                  <button
                    type="button"
                    className="mt-2 rounded-lg border border-[var(--border)] px-3 py-1 text-xs hover:bg-white/10 disabled:opacity-50"
                    disabled={sessionsBusy}
                    onClick={() => void handleRevokeSession(session.sessionId)}
                  >
                    Revoke session
                  </button>
                ) : null}
              </article>
            ))
          )}
        </section>
      </div>
    )
  }

  if (section === 'support') {
    return (
      <div className="space-y-4">
        <h2 className="text-2xl font-semibold">Support</h2>
        {message ? <p className="text-sm text-emerald-700 dark:text-emerald-300">{message}</p> : null}

        <form className="panel-strong space-y-2 p-4 text-sm" onSubmit={(event) => void handleCreateSupportCase(event)}>
          <p className="font-medium">Create support request</p>
          <label className="flex flex-col gap-1">
            Linked booking ID (optional)
            <input
              className="rounded-lg border border-[var(--border)] bg-transparent px-3 py-2"
              value={supportForm.bookingId}
              onChange={(event) =>
                setSupportForm((current) => ({ ...current, bookingId: event.target.value }))
              }
              placeholder="123"
            />
          </label>
          <label className="flex flex-col gap-1">
            Type
            <select
              className="rounded-lg border border-[var(--border)] bg-transparent px-3 py-2"
              value={supportForm.type}
              onChange={(event) =>
                setSupportForm((current) => ({ ...current, type: event.target.value }))
              }
            >
              <option value="BOOKING_ISSUE">Booking Issue</option>
              <option value="PAYMENT_ISSUE">Payment Issue</option>
              <option value="MISCONDUCT">Complaint</option>
              <option value="FRAUD_SUSPECTED">Fraud Suspicion</option>
            </select>
          </label>
          <label className="flex flex-col gap-1">
            Subject
            <input
              className="rounded-lg border border-[var(--border)] bg-transparent px-3 py-2"
              value={supportForm.subject}
              onChange={(event) =>
                setSupportForm((current) => ({ ...current, subject: event.target.value }))
              }
            />
          </label>
          <label className="flex flex-col gap-1">
            Description
            <textarea
              className="min-h-24 rounded-lg border border-[var(--border)] bg-transparent px-3 py-2"
              value={supportForm.description}
              onChange={(event) =>
                setSupportForm((current) => ({ ...current, description: event.target.value }))
              }
            />
          </label>
          <button
            type="submit"
            className="rounded-lg border border-[var(--border)] px-3 py-1 text-xs hover:bg-white/10 disabled:opacity-50"
            disabled={supportBusy}
          >
            {supportBusy ? 'Submitting...' : 'Submit support request'}
          </button>
        </form>

        <section className="space-y-2">
          <h3 className="text-lg font-semibold">My requests</h3>
          {supportCases.length === 0 ? (
            <p className="text-sm text-[var(--muted)]">No support requests yet.</p>
          ) : (
            supportCases.map((item) => (
              <article key={item.disputeId} className="panel-strong p-3 text-sm">
                <p className="font-medium">{item.subject || 'Untitled request'}</p>
                <p className="text-xs text-[var(--muted)]">
                  {item.type} · {item.status} · {new Date(item.createdAt).toLocaleString()}
                </p>
                {item.booking ? (
                  <p className="text-xs text-[var(--muted)]">Booking #{item.booking.id}</p>
                ) : null}
                {item.description ? <p className="mt-1 text-xs">{item.description}</p> : null}
                {item.resolutionSummary ? (
                  <p className="mt-1 text-xs text-emerald-700 dark:text-emerald-300">
                    Resolution: {item.resolutionSummary}
                  </p>
                ) : null}
              </article>
            ))
          )}
        </section>
      </div>
    )
  }

  if (section === 'privacy') {
    return (
      <div className="space-y-4">
        <h2 className="text-2xl font-semibold">Privacy</h2>
        {message ? <p className="text-sm text-emerald-700 dark:text-emerald-300">{message}</p> : null}

        <article className="panel-strong space-y-2 p-4 text-sm">
          <p className="font-medium">Requests</p>
          <p className="text-xs text-[var(--muted)]">
            Create a data export or anonymization request. Support/admin team will process it.
          </p>
          <label className="flex flex-col gap-1">
            OTP Code (step-up required)
            <input
              className="rounded-lg border border-[var(--border)] bg-transparent px-3 py-2"
              value={privacyOtpCode}
              onChange={(event) => setPrivacyOtpCode(event.target.value)}
              placeholder="6-digit OTP"
            />
          </label>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="rounded-lg border border-[var(--border)] px-3 py-1 text-xs hover:bg-white/10 disabled:opacity-50"
              disabled={privacyBusy}
              onClick={() => void handleCreatePrivacyRequest('EXPORT')}
            >
              Request data export
            </button>
            <button
              type="button"
              className="rounded-lg border border-[var(--border)] px-3 py-1 text-xs hover:bg-white/10 disabled:opacity-50"
              disabled={privacyBusy}
              onClick={() => void handleCreatePrivacyRequest('ANONYMIZE')}
            >
              Request anonymization
            </button>
          </div>
        </article>

        <section className="space-y-2">
          <h3 className="text-lg font-semibold">Request history</h3>
          {privacyRequests.length === 0 ? (
            <p className="text-sm text-[var(--muted)]">No privacy requests yet.</p>
          ) : (
            privacyRequests.map((item) => (
              <article key={item.requestId} className="panel-strong p-3 text-sm">
                <p className="font-medium">{item.requestType}</p>
                <p className="text-xs text-[var(--muted)]">
                  {item.status} · {new Date(item.createdAt).toLocaleString()}
                </p>
                {item.reason ? <p className="text-xs text-[var(--muted)]">Reason: {item.reason}</p> : null}
              </article>
            ))
          )}
        </section>
      </div>
    )
  }

  const upcoming = bookings.find((booking) =>
    ['HELD', 'PENDING', 'CONFIRMED', 'CHECKED_IN'].includes(booking.status),
  )

  return (
    <div className="space-y-4">
      <h2 className="text-2xl font-semibold">Client Home</h2>
      {message ? <p className="text-sm text-emerald-700 dark:text-emerald-300">{message}</p> : null}
      {upcoming ? (
        <article className="panel-strong p-4">
          <p className="text-xs uppercase text-[var(--muted)]">Upcoming Booking</p>
          <p className="mt-1 text-lg font-semibold">{upcoming.room.name}</p>
          <p className="text-sm text-[var(--muted)]">
            {formatDateRange(upcoming.checkIn, upcoming.checkOut)}
          </p>
          <p className="mt-2 text-xs">
            Status: {upcoming.status} · Payment: {upcoming.paymentStatus}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Link
              href={upcoming ? `/me/bookings/${upcoming.id}` : '/me/bookings'}
              className="rounded-lg border border-[var(--border)] px-3 py-1 text-xs hover:bg-white/10"
            >
              View booking details
            </Link>
            <Link
              href="/clubs"
              className="rounded-lg border border-[var(--border)] px-3 py-1 text-xs hover:bg-white/10"
            >
              Book again
            </Link>
          </div>
        </article>
      ) : (
        <article className="panel-strong p-4">
          <p className="text-sm text-[var(--muted)]">No upcoming bookings.</p>
          <Link
            href="/clubs"
            className="mt-2 inline-block rounded-lg border border-[var(--border)] px-3 py-1 text-sm"
          >
            Find a Club
          </Link>
        </article>
      )}
    </div>
  )
}
