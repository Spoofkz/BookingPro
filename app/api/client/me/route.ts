import { Prisma } from '@prisma/client'
import { NextRequest, NextResponse } from 'next/server'
import { normalizeLogin } from '@/src/lib/authSession'
import { getCabinetContext } from '@/src/lib/cabinetContext'
import {
  getClientProfilePrefs,
  upsertClientProfilePrefs,
} from '@/src/lib/clientProfilePrefs'
import { prisma } from '@/src/lib/prisma'

export const dynamic = 'force-dynamic'

type UpdateBody = {
  login?: string
  name?: string
  preferredLanguage?: string
  marketingOptIn?: boolean
  transactionalOptIn?: boolean
  nickname?: string | null
  birthday?: string | null
  city?: string | null
  preferredTimeWindow?: string | null
  favoriteSegment?: string | null
  seatPreference?: string | null
  favoriteClubIds?: string[]
}

function isUniqueViolation(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'
}

export async function GET() {
  try {
    const context = await getCabinetContext({ requireSession: true })
    const prefs = await getClientProfilePrefs(context.userId)
    return NextResponse.json({
      userId: context.userId,
      activeClubId: context.activeClubId,
      profile: {
        login: context.profile.login || null,
        name: context.profile.name,
        phone: context.profile.phone,
        email: context.profile.email,
        preferredLanguage: prefs.preferredLanguage,
        marketingOptIn: prefs.marketingOptIn,
        transactionalOptIn: prefs.transactionalOptIn,
        avatarUrl: prefs.avatarUrl,
        nickname: prefs.nickname,
        birthday: prefs.birthday,
        city: prefs.city,
        preferredTimeWindow: prefs.preferredTimeWindow,
        favoriteSegment: prefs.favoriteSegment,
        seatPreference: prefs.seatPreference,
        favoriteClubIds: prefs.favoriteClubIds,
      },
    })
  } catch {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 })
  }
}

export async function PATCH(request: NextRequest) {
  let body: UpdateBody
  try {
    body = (await request.json()) as UpdateBody
  } catch {
    return NextResponse.json({ error: 'Invalid JSON payload.' }, { status: 400 })
  }

  try {
    const context = await getCabinetContext({ requireSession: true })
    const login = body.login?.trim()
    const name = body.name?.trim()
    if (body.login !== undefined) {
      const normalizedLogin = normalizeLogin(body.login)
      if (!normalizedLogin) {
        return NextResponse.json(
          {
            error:
              'login must be 3-32 chars and contain only letters, numbers, dot, underscore, or hyphen.',
          },
          { status: 400 },
        )
      }
      await prisma.user.update({
        where: { id: context.userId },
        data: { login: normalizedLogin },
      })
    }
    if (body.name !== undefined && !name) {
      return NextResponse.json({ error: 'name cannot be empty.' }, { status: 400 })
    }

    if (name !== undefined) {
      await prisma.user.update({
        where: { id: context.userId },
        data: { name },
      })
      await prisma.auditLog.create({
        data: {
          clubId: context.activeClubId,
          actorUserId: context.userId,
          action: 'client.profile.updated',
          entityType: 'user',
          entityId: context.userId,
          metadata: JSON.stringify({ nameUpdated: true }),
        },
      })
    }

    const prefs = await upsertClientProfilePrefs({
      userId: context.userId,
      actorUserId: context.userId,
      clubId: context.activeClubId,
      preferredLanguage: body.preferredLanguage,
      marketingOptIn: body.marketingOptIn,
      transactionalOptIn: body.transactionalOptIn,
      nickname: body.nickname,
      birthday: body.birthday,
      city: body.city,
      preferredTimeWindow: body.preferredTimeWindow,
      favoriteSegment: body.favoriteSegment,
      seatPreference: body.seatPreference,
      favoriteClubIds: body.favoriteClubIds,
    })

    const updated = await prisma.user.findUnique({
      where: { id: context.userId },
      select: {
        id: true,
        login: true,
        name: true,
        phone: true,
        email: true,
      },
    })

    return NextResponse.json({
      userId: updated?.id || context.userId,
      activeClubId: context.activeClubId,
      profile: {
        login: updated?.login || context.profile.login || null,
        name: updated?.name || context.profile.name,
        phone: updated?.phone || context.profile.phone,
        email: updated?.email || context.profile.email,
        preferredLanguage: prefs.preferredLanguage,
        marketingOptIn: prefs.marketingOptIn,
        transactionalOptIn: prefs.transactionalOptIn,
        avatarUrl: prefs.avatarUrl,
        nickname: prefs.nickname,
        birthday: prefs.birthday,
        city: prefs.city,
        preferredTimeWindow: prefs.preferredTimeWindow,
        favoriteSegment: prefs.favoriteSegment,
        seatPreference: prefs.seatPreference,
        favoriteClubIds: prefs.favoriteClubIds,
      },
    })
  } catch (error) {
    if (isUniqueViolation(error)) {
      return NextResponse.json(
        { code: 'DUPLICATE_CONTACT', error: 'login, phone, or email already exists.' },
        { status: 409 },
      )
    }
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 })
  }
}
