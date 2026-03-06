import { NextRequest, NextResponse } from 'next/server'
import { getCabinetContext } from '@/src/lib/cabinetContext'
import { assertFeatureEnabled, featureErrorResponse } from '@/src/lib/featureFlags'
import { resolveIntentRescheduleAccess } from '@/src/lib/rescheduleAccess'
import { cancelRescheduleIntent, RescheduleFlowError } from '@/src/lib/rescheduleService'

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

export async function POST(request: NextRequest, routeContext: RouteContext) {
  try {
    assertFeatureEnabled('reschedule')
  } catch (error) {
    const response = featureErrorResponse(error)
    if (response) return response
    throw error
  }

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

    const canceled = await cancelRescheduleIntent({
      rescheduleId: access.rescheduleId,
      clubId: access.clubId,
      actorUserId: context.userId,
    })

    return NextResponse.json(canceled)
  } catch (error) {
    return errorResponse(error)
  }
}
