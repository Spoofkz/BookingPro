import { NextRequest, NextResponse } from 'next/server'
import { ScheduleTemplateStatus } from '@prisma/client'
import { canManageClubAsTechAdmin } from '@/src/lib/clubAccess'
import { getCabinetContext } from '@/src/lib/cabinetContext'
import { prisma } from '@/src/lib/prisma'

export const dynamic = 'force-dynamic'

type RouteContext = {
  params: Promise<{ id: string }>
}

export async function POST(_: NextRequest, routeContext: RouteContext) {
  const { id } = await routeContext.params
  const context = await getCabinetContext()

  const template = await prisma.scheduleTemplate.findUnique({
    where: { id },
    select: { id: true, clubId: true, status: true },
  })
  if (!template) {
    return NextResponse.json({ error: 'Schedule template was not found.' }, { status: 404 })
  }
  if (!canManageClubAsTechAdmin(context, template.clubId)) {
    return NextResponse.json({ error: 'Forbidden.' }, { status: 403 })
  }

  if (template.status !== ScheduleTemplateStatus.ARCHIVED) {
    await prisma.scheduleTemplate.update({
      where: { id },
      data: { status: ScheduleTemplateStatus.ARCHIVED },
    })
  }

  await prisma.auditLog.create({
    data: {
      clubId: template.clubId,
      actorUserId: context.userId,
      action: 'schedule.template_archived',
      entityType: 'schedule_template',
      entityId: template.id,
    },
  })

  return NextResponse.json({ ok: true, status: ScheduleTemplateStatus.ARCHIVED })
}
