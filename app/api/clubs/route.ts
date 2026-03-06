import { Role } from '@prisma/client'
import { NextRequest, NextResponse } from 'next/server'
import { CLUB_STATUSES } from '@/src/lib/clubLifecycle'
import { getCabinetContext } from '@/src/lib/cabinetContext'
import { prisma } from '@/src/lib/prisma'

export const dynamic = 'force-dynamic'

type ContactsPayload = {
  phone?: string
  whatsapp?: string
  email?: string
}

type CreateClubPayload = {
  name: string
  timezone?: string
  currency?: string
  contacts?: ContactsPayload
  address?: string
  city?: string
  area?: string
  amenities?: string[]
  geo?: {
    lat?: number
    lng?: number
  }
}

function slugify(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function isValidPhone(value: string) {
  return /^[+0-9()\-\s]{6,25}$/.test(value)
}

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
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

function sanitizeContacts(input: ContactsPayload | undefined) {
  if (!input) return null
  const phone = input.phone?.trim() || ''
  const whatsapp = input.whatsapp?.trim() || ''
  const email = input.email?.trim().toLowerCase() || ''

  if (phone && !isValidPhone(phone)) {
    throw new Error('Phone format is invalid.')
  }
  if (whatsapp && !isValidPhone(whatsapp)) {
    throw new Error('WhatsApp format is invalid.')
  }
  if (email && !isValidEmail(email)) {
    throw new Error('Email format is invalid.')
  }

  if (!phone && !whatsapp && !email) return null

  return { phone, whatsapp, email }
}

async function makeUniqueSlug(base: string) {
  const baseSlug = slugify(base)
  if (!baseSlug) return null

  let slug = baseSlug
  let index = 2
  for (;;) {
    const existing = await prisma.club.findUnique({
      where: { slug },
      select: { id: true },
    })
    if (!existing) return slug
    slug = `${baseSlug}-${index}`
    index += 1
  }
}

export async function GET(request: NextRequest) {
  const scope = request.nextUrl.searchParams.get('scope') ?? 'mine'

  if (scope === 'public') {
    const clubs = await prisma.club.findMany({
      where: { status: CLUB_STATUSES.PUBLISHED },
      orderBy: [{ name: 'asc' }],
      select: {
        id: true,
        name: true,
        slug: true,
        status: true,
        timezone: true,
        currency: true,
        address: true,
        city: true,
        area: true,
        amenitiesJson: true,
        logoUrl: true,
      },
    })
    return NextResponse.json(clubs)
  }

  const context = await getCabinetContext()

  const memberships = await prisma.clubMembership.findMany({
    where: { userId: context.userId, status: 'ACTIVE' },
    include: {
      club: {
        select: {
          id: true,
          name: true,
          slug: true,
          status: true,
          timezone: true,
          currency: true,
          address: true,
          updatedAt: true,
        },
      },
    },
    orderBy: [{ createdAt: 'asc' }],
  })

  const aggregated = new Map<
    string,
    {
      id: string
      name: string
      slug: string
      status: string
      timezone: string
      currency: string
      address: string | null
      updatedAt: Date
      roles: Role[]
    }
  >()

  for (const membership of memberships) {
    const existing = aggregated.get(membership.clubId)
    if (existing) {
      if (!existing.roles.includes(membership.role)) {
        existing.roles.push(membership.role)
      }
      continue
    }
    aggregated.set(membership.clubId, {
      id: membership.club.id,
      name: membership.club.name,
      slug: membership.club.slug,
      status: membership.club.status,
      timezone: membership.club.timezone,
      currency: membership.club.currency,
      address: membership.club.address,
      updatedAt: membership.club.updatedAt,
      roles: [membership.role],
    })
  }

  return NextResponse.json({
    items: Array.from(aggregated.values()).sort((a, b) => a.name.localeCompare(b.name)),
  })
}

export async function POST(request: NextRequest) {
  const context = await getCabinetContext()

  const canCreate =
    context.roles.some((role) => role.role === Role.TECH_ADMIN) || context.memberships.length === 0
  if (!canCreate) {
    return NextResponse.json({ error: 'Only TECH_ADMIN can create clubs.' }, { status: 403 })
  }

  let payload: CreateClubPayload
  try {
    payload = (await request.json()) as CreateClubPayload
  } catch {
    return NextResponse.json({ error: 'Invalid JSON payload.' }, { status: 400 })
  }

  const name = sanitizeText(payload.name || '')
  const validationErrors: Array<{ field: string; message: string }> = []
  if (!name) validationErrors.push({ field: 'name', message: 'name is required.' })

  const timezone = payload.timezone?.trim() || 'Asia/Almaty'
  if (!isValidTimeZone(timezone)) {
    validationErrors.push({ field: 'timezone', message: 'timezone must be a valid IANA timezone.' })
  }

  const currency = payload.currency?.trim().toUpperCase() || 'KZT'
  if (!/^[A-Z]{3}$/.test(currency)) {
    validationErrors.push({ field: 'currency', message: 'currency must be 3-letter ISO code.' })
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

  let contacts: Record<string, string> | null
  try {
    contacts = sanitizeContacts(payload.contacts)
  } catch (error) {
    validationErrors.push({
      field: 'contacts',
      message: error instanceof Error ? error.message : 'contacts are invalid.',
    })
    return NextResponse.json(
      {
        code: 'VALIDATION_ERROR',
        error: 'Validation failed.',
        fields: validationErrors,
      },
      { status: 400 },
    )
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

  const slug = await makeUniqueSlug(name)
  if (!slug) {
    return NextResponse.json({ error: 'name cannot produce a valid slug.' }, { status: 400 })
  }

  const club = await prisma.club.create({
    data: {
      name,
      slug,
      status: CLUB_STATUSES.DRAFT,
      timezone,
      currency,
      address: payload.address ? sanitizeText(payload.address) || null : null,
      city: payload.city ? sanitizeText(payload.city) || null : null,
      area: payload.area ? sanitizeText(payload.area) || null : null,
      amenitiesJson: JSON.stringify(normalizeAmenities(payload.amenities)),
      geoLat: typeof payload.geo?.lat === 'number' ? payload.geo.lat : null,
      geoLng: typeof payload.geo?.lng === 'number' ? payload.geo.lng : null,
      contactsJson: contacts ? JSON.stringify(contacts) : null,
      holdTtlMinutes: 15,
      cancellationPolicyJson: JSON.stringify({
        policy: 'flexible',
        freeCancelMinutesBeforeStart: 120,
      }),
      checkInPolicyJson: JSON.stringify({
        gracePeriodMinutes: 15,
        requireHostConfirmation: true,
      }),
      reschedulePolicyJson: JSON.stringify({
        rescheduleEnabled: true,
        rescheduleCutoffMinutesBeforeStart: 60,
        maxReschedulesPerBooking: 2,
        allowRescheduleAfterStart: false,
        rescheduleHoldTtlMinutes: 10,
        priceDeltaHandling: {
          client: 'NON_NEGATIVE_ONLY',
        },
      }),
    },
    select: {
      id: true,
      status: true,
    },
  })

  await prisma.clubMembership.upsert({
    where: {
      clubId_userId_role: {
        clubId: club.id,
        userId: context.userId,
        role: Role.TECH_ADMIN,
      },
    },
    update: {
      status: 'ACTIVE',
      invitedByUserId: context.userId,
    },
    create: {
      clubId: club.id,
      userId: context.userId,
      role: Role.TECH_ADMIN,
      status: 'ACTIVE',
      invitedByUserId: context.userId,
    },
  })

  await prisma.auditLog.create({
    data: {
      clubId: club.id,
      actorUserId: context.userId,
      action: 'club.created',
      entityType: 'club',
      entityId: club.id,
      metadata: JSON.stringify({
        name,
        timezone,
        currency,
      }),
    },
  })

  return NextResponse.json(
    {
      clubId: club.id,
      status: club.status,
    },
    { status: 201 },
  )
}
