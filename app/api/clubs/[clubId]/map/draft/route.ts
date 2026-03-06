import { NextRequest, NextResponse } from 'next/server'
import { canManageClubAsTechAdmin } from '@/src/lib/clubAccess'
import { getCabinetContext } from '@/src/lib/cabinetContext'
import { prisma } from '@/src/lib/prisma'
import { parseSeatMapJson, validateSeatMapDocument } from '@/src/lib/seatMapSchema'

export const dynamic = 'force-dynamic'

type RouteContext = {
  params: Promise<{ clubId: string }>
}

function parseIfMatchRevision(value: string | null) {
  if (!value) return null
  const normalized = value.trim().replace(/^W\//, '').replaceAll('"', '')
  const revision = Number(normalized)
  if (!Number.isInteger(revision) || revision <= 0) return null
  return revision
}

function responseWithRevision(payload: unknown, revision: number, status = 200) {
  return NextResponse.json(payload, {
    status,
    headers: {
      ETag: `"${revision}"`,
    },
  })
}

export async function GET(_: NextRequest, routeContext: RouteContext) {
  const { clubId } = await routeContext.params
  const context = await getCabinetContext()

  if (!canManageClubAsTechAdmin(context, clubId)) {
    return NextResponse.json({ error: 'Forbidden.' }, { status: 403 })
  }

  const seatMap = await prisma.seatMap.findUnique({
    where: { clubId },
    select: {
      id: true,
      clubId: true,
      draftJson: true,
      draftRevision: true,
      createdAt: true,
      updatedAt: true,
      updatedByUserId: true,
    },
  })

  if (!seatMap) {
    return NextResponse.json({ error: 'Map draft was not found.' }, { status: 404 })
  }

  const draft = parseSeatMapJson(seatMap.draftJson)
  if (!draft) {
    return NextResponse.json({ error: 'Draft map JSON is corrupted.' }, { status: 500 })
  }

  return responseWithRevision(
    {
      mapId: seatMap.id,
      clubId: seatMap.clubId,
      draftRevision: seatMap.draftRevision,
      createdAt: seatMap.createdAt,
      updatedAt: seatMap.updatedAt,
      updatedByUserId: seatMap.updatedByUserId,
      draft,
    },
    seatMap.draftRevision,
  )
}

export async function PUT(request: NextRequest, routeContext: RouteContext) {
  const { clubId } = await routeContext.params
  const context = await getCabinetContext()

  if (!canManageClubAsTechAdmin(context, clubId)) {
    return NextResponse.json({ error: 'Forbidden.' }, { status: 403 })
  }

  const seatMap = await prisma.seatMap.findUnique({
    where: { clubId },
    select: { id: true, draftRevision: true },
  })

  if (!seatMap) {
    return NextResponse.json({ error: 'Map draft was not found.' }, { status: 404 })
  }

  const ifMatchRevision = parseIfMatchRevision(request.headers.get('if-match'))
  if (ifMatchRevision == null) {
    return responseWithRevision(
      {
        error: 'If-Match draft revision is required.',
        currentRevision: seatMap.draftRevision,
      },
      seatMap.draftRevision,
      428,
    )
  }

  if (ifMatchRevision !== seatMap.draftRevision) {
    return responseWithRevision(
      {
        error: 'Draft revision mismatch.',
        currentRevision: seatMap.draftRevision,
      },
      seatMap.draftRevision,
      409,
    )
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON payload.' }, { status: 400 })
  }

  const draftPayload =
    body && typeof body === 'object' && !Array.isArray(body) && 'draft' in body
      ? (body as { draft: unknown }).draft
      : body

  const validation = validateSeatMapDocument(draftPayload, 'draft')
  if (validation.errors.length > 0 || !validation.document) {
    return NextResponse.json(
      {
        error: 'Draft validation failed.',
        errors: validation.errors,
        warnings: validation.warnings,
      },
      { status: 400 },
    )
  }

  if (validation.document.mapId !== seatMap.id) {
    return NextResponse.json(
      { error: 'draft.mapId must match existing mapId.' },
      { status: 400 },
    )
  }

  const updated = await prisma.seatMap.update({
    where: { id: seatMap.id },
    data: {
      draftJson: JSON.stringify(validation.document),
      draftRevision: { increment: 1 },
      updatedByUserId: context.userId,
    },
    select: {
      id: true,
      clubId: true,
      draftRevision: true,
      createdAt: true,
      updatedAt: true,
      updatedByUserId: true,
      draftJson: true,
    },
  })

  const nextDraft = parseSeatMapJson(updated.draftJson)
  if (!nextDraft) {
    return NextResponse.json({ error: 'Draft map JSON became corrupted.' }, { status: 500 })
  }

  return responseWithRevision(
    {
      mapId: updated.id,
      clubId: updated.clubId,
      draftRevision: updated.draftRevision,
      createdAt: updated.createdAt,
      updatedAt: updated.updatedAt,
      updatedByUserId: updated.updatedByUserId,
      warnings: validation.warnings,
      draft: nextDraft,
    },
    updated.draftRevision,
  )
}
