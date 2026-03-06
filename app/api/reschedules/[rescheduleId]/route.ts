import { NextRequest, NextResponse } from 'next/server'
import { getCabinetContext } from '@/src/lib/cabinetContext'
import { resolveIntentRescheduleAccess } from '@/src/lib/rescheduleAccess'
import { getRescheduleIntent, RescheduleFlowError } from '@/src/lib/rescheduleService'

export const dynamic = 'force-dynamic'

type RouteContext = {
  params: Promise<{ rescheduleId: string }>
}

function errorResponse(error: unknown) {
  if (error instanceof RescheduleFlowError) {
    return NextResponse.json(
      {
        code: error.code,
        error: error.message,
        ...(error.details ?? {}),
      },
      { status: error.status },
    )
  }
  throw error
}

export async function GET(request: NextRequest, routeContext: RouteContext) {
  const { rescheduleId } = await routeContext.params
  const normalizedRescheduleId = rescheduleId.trim()
  if (!normalizedRescheduleId) {
    return NextResponse.json({ error: 'Invalid reschedule id.' }, { status: 400 })
  }

  try {
    const context = await getCabinetContext()
    const access = await resolveIntentRescheduleAccess({
      request,
      context,
      rescheduleId: normalizedRescheduleId,
    })

    const intent = await getRescheduleIntent({
      rescheduleId: access.rescheduleId,
      clubId: access.clubId,
    })
    return NextResponse.json(intent)
  } catch (error) {
    return errorResponse(error)
  }
}
