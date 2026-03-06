import { NextRequest, NextResponse } from 'next/server'
import { canAccessClub, canManageClubAsTechAdmin } from '@/src/lib/clubAccess'
import { CLUB_STATUSES, normalizeClubStatus } from '@/src/lib/clubLifecycle'
import { getCabinetContext } from '@/src/lib/cabinetContext'
import { prisma } from '@/src/lib/prisma'

export const dynamic = 'force-dynamic'

type RouteContext = {
  params: Promise<{ clubId: string }>
}

type ContactsPayload = {
  phone?: string
  whatsapp?: string
  email?: string
}

type UpdateClubPayload = {
  name?: string
  description?: string
  timezone?: string
  currency?: string
  address?: string
  city?: string
  area?: string
  amenities?: string[]
  geo?: {
    lat?: number | null
    lng?: number | null
  }
  contacts?: ContactsPayload
  logoUrl?: string | null
  galleryUrls?: string[]
  businessHoursText?: string | null
  holdTtlMinutes?: number | null
  cancellationPolicy?: Record<string, unknown> | null
  checkInPolicy?: Record<string, unknown> | null
  reschedulePolicy?: Record<string, unknown> | null
  schedulePublishedAt?: string | null
  slotsGeneratedUntil?: string | null
}

function asRecord(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function safeParseJson(input: string | null) {
  if (!input) return null
  try {
    return JSON.parse(input) as unknown
  } catch {
    return null
  }
}

function normalizeContacts(input: ContactsPayload | undefined) {
  if (!input) return null
  const phone = input.phone?.trim() || ''
  const whatsapp = input.whatsapp?.trim() || ''
  const email = input.email?.trim().toLowerCase() || ''

  if (phone && !/^[+0-9()\-\s]{6,25}$/.test(phone)) {
    throw new Error('Phone format is invalid.')
  }
  if (whatsapp && !/^[+0-9()\-\s]{6,25}$/.test(whatsapp)) {
    throw new Error('WhatsApp format is invalid.')
  }
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('Email format is invalid.')
  }

  const contacts: Record<string, string> = {}
  if (phone) contacts.phone = phone
  if (whatsapp) contacts.whatsapp = whatsapp
  if (email) contacts.email = email
  return contacts
}

function normalizeDate(input: string | null | undefined) {
  if (input == null) return null
  const date = new Date(input)
  if (Number.isNaN(date.getTime())) return null
  return date
}

function isValidTimeZone(value: string) {
  try {
    Intl.DateTimeFormat('en-US', { timeZone: value }).format(new Date())
    return true
  } catch {
    return false
  }
}

function sanitizeText(value: string) {
  return value.replace(/[<>]/g, '').trim()
}

function normalizeAmenities(values: string[] | undefined) {
  if (!values) return []
  return Array.from(
    new Set(
      values
        .map((item) => sanitizeText(item || '').toLowerCase())
        .filter(Boolean),
    ),
  )
}

export async function GET(_: NextRequest, routeContext: RouteContext) {
  const { clubId } = await routeContext.params
  const context = await getCabinetContext()

  if (!canAccessClub(context, clubId)) {
    return NextResponse.json({ error: 'Forbidden.' }, { status: 403 })
  }

  const club = await prisma.club.findUnique({
    where: { id: clubId },
    select: {
      id: true,
      name: true,
      slug: true,
      status: true,
      timezone: true,
      currency: true,
      description: true,
      address: true,
      city: true,
      area: true,
      contactsJson: true,
      amenitiesJson: true,
      geoLat: true,
      geoLng: true,
      startingFromAmount: true,
      startingFromSegment: true,
      logoUrl: true,
      galleryJson: true,
      businessHoursText: true,
      holdTtlMinutes: true,
      cancellationPolicyJson: true,
      checkInPolicyJson: true,
      reschedulePolicyJson: true,
      schedulePublishedAt: true,
      slotsGeneratedUntil: true,
      pauseReason: true,
      pauseUntil: true,
      publishedAt: true,
      updatedAt: true,
      createdAt: true,
    },
  })

  if (!club) {
    return NextResponse.json({ error: 'Club was not found.' }, { status: 404 })
  }

  return NextResponse.json({
    ...club,
    status: normalizeClubStatus(club.status),
    contacts: asRecord(safeParseJson(club.contactsJson)) ?? {},
    amenities: Array.isArray(safeParseJson(club.amenitiesJson))
      ? (safeParseJson(club.amenitiesJson) as unknown[]).filter(
          (item): item is string => typeof item === 'string',
        )
      : [],
    galleryUrls: Array.isArray(safeParseJson(club.galleryJson))
      ? (safeParseJson(club.galleryJson) as unknown[])
          .filter((item): item is string => typeof item === 'string')
      : [],
    cancellationPolicy: asRecord(safeParseJson(club.cancellationPolicyJson)) ?? null,
    checkInPolicy: asRecord(safeParseJson(club.checkInPolicyJson)) ?? null,
    reschedulePolicy: asRecord(safeParseJson(club.reschedulePolicyJson)) ?? null,
  })
}

export async function PUT(request: NextRequest, routeContext: RouteContext) {
  const { clubId } = await routeContext.params
  const context = await getCabinetContext()

  if (!canManageClubAsTechAdmin(context, clubId)) {
    return NextResponse.json({ error: 'Forbidden.' }, { status: 403 })
  }

  let payload: UpdateClubPayload
  try {
    payload = (await request.json()) as UpdateClubPayload
  } catch {
    return NextResponse.json({ error: 'Invalid JSON payload.' }, { status: 400 })
  }

  const existing = await prisma.club.findUnique({
    where: { id: clubId },
    select: {
      id: true,
      status: true,
      timezone: true,
      schedulePublishedAt: true,
    },
  })

  if (!existing) {
    return NextResponse.json({ error: 'Club was not found.' }, { status: 404 })
  }

  const nextTimezone = payload.timezone?.trim()
  if (
    nextTimezone &&
    nextTimezone !== existing.timezone &&
    normalizeClubStatus(existing.status) === CLUB_STATUSES.PUBLISHED &&
    existing.schedulePublishedAt
  ) {
    return NextResponse.json(
      {
        error:
          'Timezone change is blocked after publish when schedule is already published. Pause and regenerate schedule first.',
      },
      { status: 409 },
    )
  }

  const validationErrors: Array<{ field: string; message: string }> = []
  if (payload.name !== undefined && !sanitizeText(payload.name || '')) {
    validationErrors.push({ field: 'name', message: 'Name cannot be empty.' })
  }
  if (nextTimezone && !isValidTimeZone(nextTimezone)) {
    validationErrors.push({ field: 'timezone', message: 'Timezone must be a valid IANA timezone.' })
  }
  if (payload.currency && !/^[A-Za-z]{3}$/.test(payload.currency.trim())) {
    validationErrors.push({ field: 'currency', message: 'Currency must be a 3-letter code.' })
  }

  let contacts: Record<string, string> | null = null
  if (payload.contacts !== undefined) {
    try {
      contacts = normalizeContacts(payload.contacts)
    } catch (error) {
      validationErrors.push({
        field: 'contacts',
        message: error instanceof Error ? error.message : 'Invalid contacts.',
      })
    }
  }

  const parsedSchedulePublishedAt =
    payload.schedulePublishedAt === undefined
      ? undefined
      : normalizeDate(payload.schedulePublishedAt)
  if (payload.schedulePublishedAt !== undefined && payload.schedulePublishedAt !== null && !parsedSchedulePublishedAt) {
    validationErrors.push({ field: 'schedulePublishedAt', message: 'schedulePublishedAt is invalid.' })
  }

  const parsedSlotsGeneratedUntil =
    payload.slotsGeneratedUntil === undefined
      ? undefined
      : normalizeDate(payload.slotsGeneratedUntil)
  if (payload.slotsGeneratedUntil !== undefined && payload.slotsGeneratedUntil !== null && !parsedSlotsGeneratedUntil) {
    validationErrors.push({ field: 'slotsGeneratedUntil', message: 'slotsGeneratedUntil is invalid.' })
  }

  if (
    parsedSchedulePublishedAt instanceof Date &&
    parsedSlotsGeneratedUntil instanceof Date &&
    parsedSlotsGeneratedUntil < parsedSchedulePublishedAt
  ) {
    validationErrors.push({
      field: 'slotsGeneratedUntil',
      message: 'slotsGeneratedUntil must be >= schedulePublishedAt.',
    })
  }

  if (payload.holdTtlMinutes !== undefined && payload.holdTtlMinutes !== null) {
    const holdTtlMinutes = Number(payload.holdTtlMinutes)
    if (!Number.isInteger(holdTtlMinutes) || holdTtlMinutes < 1) {
      validationErrors.push({
        field: 'holdTtlMinutes',
        message: 'holdTtlMinutes must be a positive integer.',
      })
    }
  }

  if (validationErrors.length > 0) {
    return NextResponse.json(
      {
        code: 'VALIDATION_ERROR',
        error: 'Validation failed.',
        fields: validationErrors,
      },
      { status: 400 },
    )
  }

  const hasPolicyChanges =
    payload.holdTtlMinutes !== undefined ||
    payload.cancellationPolicy !== undefined ||
    payload.checkInPolicy !== undefined ||
    payload.reschedulePolicy !== undefined

  const updated = await prisma.club.update({
    where: { id: clubId },
    data: {
      name: payload.name !== undefined ? sanitizeText(payload.name || '') : undefined,
      description:
        payload.description === undefined
          ? undefined
          : sanitizeText(payload.description || '') || null,
      timezone: nextTimezone || undefined,
      currency: payload.currency?.trim().toUpperCase() || undefined,
      address:
        payload.address === undefined
          ? undefined
          : sanitizeText(payload.address || '') || null,
      city:
        payload.city === undefined
          ? undefined
          : sanitizeText(payload.city || '') || null,
      area:
        payload.area === undefined
          ? undefined
          : sanitizeText(payload.area || '') || null,
      amenitiesJson:
        payload.amenities === undefined
          ? undefined
          : JSON.stringify(normalizeAmenities(payload.amenities)),
      geoLat: typeof payload.geo?.lat === 'number' ? payload.geo.lat : payload.geo?.lat === null ? null : undefined,
      geoLng: typeof payload.geo?.lng === 'number' ? payload.geo.lng : payload.geo?.lng === null ? null : undefined,
      contactsJson:
        payload.contacts === undefined
          ? undefined
          : contacts && Object.keys(contacts).length > 0
            ? JSON.stringify(contacts)
            : null,
      logoUrl: payload.logoUrl?.trim() || (payload.logoUrl === null ? null : undefined),
      galleryJson:
        payload.galleryUrls === undefined
          ? undefined
          : JSON.stringify(
              payload.galleryUrls
                .map((item) => item.trim())
                .filter(Boolean),
            ),
      businessHoursText:
        payload.businessHoursText === undefined
          ? undefined
          : sanitizeText(payload.businessHoursText || '') || null,
      holdTtlMinutes:
        payload.holdTtlMinutes === undefined ? undefined : payload.holdTtlMinutes ?? null,
      cancellationPolicyJson:
        payload.cancellationPolicy === undefined
          ? undefined
          : payload.cancellationPolicy
            ? JSON.stringify(payload.cancellationPolicy)
            : null,
      checkInPolicyJson:
        payload.checkInPolicy === undefined
          ? undefined
          : payload.checkInPolicy
            ? JSON.stringify(payload.checkInPolicy)
            : null,
      reschedulePolicyJson:
        payload.reschedulePolicy === undefined
          ? undefined
          : payload.reschedulePolicy
            ? JSON.stringify(payload.reschedulePolicy)
            : null,
      schedulePublishedAt: payload.schedulePublishedAt === undefined ? undefined : parsedSchedulePublishedAt,
      slotsGeneratedUntil: payload.slotsGeneratedUntil === undefined ? undefined : parsedSlotsGeneratedUntil,
    },
    select: {
      id: true,
      name: true,
      slug: true,
      status: true,
      timezone: true,
      currency: true,
      description: true,
      address: true,
      city: true,
      area: true,
      contactsJson: true,
      amenitiesJson: true,
      geoLat: true,
      geoLng: true,
      startingFromAmount: true,
      startingFromSegment: true,
      logoUrl: true,
      galleryJson: true,
      businessHoursText: true,
      holdTtlMinutes: true,
      cancellationPolicyJson: true,
      checkInPolicyJson: true,
      reschedulePolicyJson: true,
      schedulePublishedAt: true,
      slotsGeneratedUntil: true,
      pauseReason: true,
      pauseUntil: true,
      publishedAt: true,
      updatedAt: true,
      createdAt: true,
    },
  })

  await prisma.auditLog.create({
    data: {
      clubId,
      actorUserId: context.userId,
      action: 'club.profile_updated',
      entityType: 'club',
      entityId: clubId,
      metadata: JSON.stringify({
        updatedAt: updated.updatedAt.toISOString(),
      }),
    },
  })

  if (hasPolicyChanges) {
    await prisma.auditLog.create({
      data: {
        clubId,
        actorUserId: context.userId,
        action: 'club.policies_updated',
        entityType: 'club',
        entityId: clubId,
      },
    })
  }

  return NextResponse.json({
    ...updated,
    status: normalizeClubStatus(updated.status),
    contacts: asRecord(safeParseJson(updated.contactsJson)) ?? {},
    amenities: Array.isArray(safeParseJson(updated.amenitiesJson))
      ? (safeParseJson(updated.amenitiesJson) as unknown[]).filter(
          (item): item is string => typeof item === 'string',
        )
      : [],
    galleryUrls: Array.isArray(safeParseJson(updated.galleryJson))
      ? (safeParseJson(updated.galleryJson) as unknown[])
          .filter((item): item is string => typeof item === 'string')
      : [],
    cancellationPolicy: asRecord(safeParseJson(updated.cancellationPolicyJson)) ?? null,
    checkInPolicy: asRecord(safeParseJson(updated.checkInPolicyJson)) ?? null,
    reschedulePolicy: asRecord(safeParseJson(updated.reschedulePolicyJson)) ?? null,
  })
}
