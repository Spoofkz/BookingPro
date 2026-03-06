import { NextRequest, NextResponse } from 'next/server'
import { getCabinetContext } from '@/src/lib/cabinetContext'
import { resolveBookingRescheduleAccess } from '@/src/lib/rescheduleAccess'
import { getRescheduleEligibility, RescheduleFlowError } from '@/src/lib/rescheduleService'

export const dynamic = 'force-dynamic'

type RouteContext = {
  params: Promise<{ id: string }>
}

function parseBookingId(value: string) {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 1) return null
  return parsed
}

function parseBooleanQuery(input: string | null) {
  if (!input) return false
  const normalized = input.trim().toLowerCase()
  return normalized === '1' || normalized === 'true' || normalized === 'yes'
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
  const { id: rawId } = await routeContext.params
  const bookingId = parseBookingId(rawId)
  if (!bookingId) {
    return NextResponse.json({ error: 'Invalid booking id.' }, { status: 400 })
  }

  try {
    const context = await getCabinetContext()
    const access = await resolveBookingRescheduleAccess({
      request,
      context,
      bookingId,
    })
    const allowStaffOverride =
      access.mode === 'STAFF'
        ? parseBooleanQuery(request.nextUrl.searchParams.get('overridePolicy'))
        : false

    const eligibility = await getRescheduleEligibility({
      bookingId: access.bookingId,
      clubId: access.clubId,
      mode: access.mode,
      allowStaffOverride,
    })

    return NextResponse.json({
      bookingId: access.bookingId,
      clubId: access.clubId,
      mode: access.mode,
      ...eligibility,
    })
  } catch (error) {
    return errorResponse(error)
  }
}
