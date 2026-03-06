import { promises as fs } from 'fs'
import path from 'path'
import { NextRequest, NextResponse } from 'next/server'
import { getCabinetContext } from '@/src/lib/cabinetContext'
import { upsertClientProfilePrefs } from '@/src/lib/clientProfilePrefs'
import { prisma } from '@/src/lib/prisma'

export const dynamic = 'force-dynamic'

const MAX_AVATAR_SIZE_BYTES = 2 * 1024 * 1024
const ALLOWED_MIME = new Set(['image/png', 'image/jpeg', 'image/webp'])

function extensionForMime(mime: string) {
  if (mime === 'image/png') return 'png'
  if (mime === 'image/jpeg') return 'jpg'
  if (mime === 'image/webp') return 'webp'
  return null
}

export async function POST(request: NextRequest) {
  try {
    const context = await getCabinetContext({ requireSession: true })
    const form = await request.formData()
    const avatar = form.get('avatar')
    if (!(avatar instanceof File)) {
      return NextResponse.json({ error: 'avatar file is required.' }, { status: 400 })
    }
    if (avatar.size <= 0) {
      return NextResponse.json({ error: 'avatar file is empty.' }, { status: 400 })
    }
    if (avatar.size > MAX_AVATAR_SIZE_BYTES) {
      return NextResponse.json(
        { error: 'avatar file is too large. Maximum size is 2MB.' },
        { status: 400 },
      )
    }
    if (!ALLOWED_MIME.has(avatar.type)) {
      return NextResponse.json(
        { error: 'avatar format is unsupported. Use PNG, JPG, or WEBP.' },
        { status: 400 },
      )
    }

    const ext = extensionForMime(avatar.type)
    if (!ext) {
      return NextResponse.json({ error: 'avatar format is unsupported.' }, { status: 400 })
    }

    const buffer = Buffer.from(await avatar.arrayBuffer())
    const fileName = `${context.userId}-${Date.now()}.${ext}`
    const avatarDir = path.join(process.cwd(), 'public', 'uploads', 'avatars')
    await fs.mkdir(avatarDir, { recursive: true })
    await fs.writeFile(path.join(avatarDir, fileName), buffer)
    const avatarUrl = `/uploads/avatars/${fileName}`

    await upsertClientProfilePrefs({
      userId: context.userId,
      actorUserId: context.userId,
      clubId: context.activeClubId,
      avatarUrl,
    })

    await prisma.auditLog.create({
      data: {
        clubId: context.activeClubId,
        actorUserId: context.userId,
        action: 'client.avatar.uploaded',
        entityType: 'user',
        entityId: context.userId,
        metadata: JSON.stringify({
          avatarUrl,
          contentType: avatar.type,
          sizeBytes: avatar.size,
        }),
      },
    })

    return NextResponse.json({ avatarUrl })
  } catch {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 })
  }
}
