import { NextRequest, NextResponse } from 'next/server'
import { canManageClubAsTechAdmin } from '@/src/lib/clubAccess'
import { getCabinetContext } from '@/src/lib/cabinetContext'
import { prisma } from '@/src/lib/prisma'

export const dynamic = 'force-dynamic'

type RouteContext = {
  params: Promise<{ clubId: string; exceptionId: string }>
}

export async function DELETE(_: NextRequest, routeContext: RouteContext) {
  const { clubId, exceptionId } = await routeContext.params
  const context = await getCabinetContext()

  if (!canManageClubAsTechAdmin(context, clubId)) {
    return NextResponse.json({ error: 'Forbidden.' }, { status: 403 })
  }

  const existing = await prisma.scheduleException.findUnique({
    where: { id: exceptionId },
    select: { id: true, clubId: true, type: true, startAt: true, endAt: true, deletedAt: true },
  })

  if (!existing || existing.clubId !== clubId || existing.deletedAt) {
    return NextResponse.json({ error: 'Exception was not found.' }, { status: 404 })
  }

  await prisma.scheduleException.update({
    where: { id: exceptionId },
    data: { deletedAt: new Date() },
  })

  await prisma.auditLog.create({
    data: {
      clubId,
      actorUserId: context.userId,
      action: 'schedule.exception_deleted',
      entityType: 'schedule_exception',
      entityId: exceptionId,
      metadata: JSON.stringify({
        type: existing.type,
        startAt: existing.startAt.toISOString(),
        endAt: existing.endAt.toISOString(),
      }),
    },
  })

  return NextResponse.json({ ok: true })
}
