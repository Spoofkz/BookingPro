import { NextRequest, NextResponse } from 'next/server'
import { Role } from '@prisma/client'
import { canOperateSchedule, hasClubRole } from '@/src/lib/clubAccess'
import { getCabinetContext } from '@/src/lib/cabinetContext'
import { prisma } from '@/src/lib/prisma'

export const dynamic = 'force-dynamic'

type RouteContext = {
  params: Promise<{ exceptionId: string }>
}

export async function DELETE(request: NextRequest, routeContext: RouteContext) {
  const { exceptionId } = await routeContext.params
  const clubId = request.nextUrl.searchParams.get('clubId')?.trim() || ''
  if (!clubId) {
    return NextResponse.json({ error: 'clubId is required.' }, { status: 400 })
  }

  const context = await getCabinetContext()
  if (!canOperateSchedule(context, clubId)) {
    return NextResponse.json({ error: 'Forbidden.' }, { status: 403 })
  }
  const isTech = hasClubRole(context, clubId, Role.TECH_ADMIN)

  const existing = await prisma.scheduleException.findUnique({
    where: { id: exceptionId },
    select: { id: true, clubId: true, type: true, startAt: true, endAt: true, deletedAt: true },
  })
  if (!existing || existing.clubId !== clubId || existing.deletedAt) {
    return NextResponse.json({ error: 'Exception was not found.' }, { status: 404 })
  }
  if (!isTech && existing.startAt < new Date()) {
    return NextResponse.json(
      { error: 'Editing past schedule ranges is blocked by policy.' },
      { status: 409 },
    )
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
      entityId: existing.id,
      metadata: JSON.stringify({
        type: existing.type,
        startAt: existing.startAt.toISOString(),
        endAt: existing.endAt.toISOString(),
      }),
    },
  })

  return NextResponse.json({ ok: true })
}
