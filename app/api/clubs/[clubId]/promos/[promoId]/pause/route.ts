import { NextRequest, NextResponse } from 'next/server'
import { AuthorizationError, requirePermissionInClub } from '@/src/lib/authorization'
import { getCabinetContext } from '@/src/lib/cabinetContext'
import {
  PromoManagementError,
  serializePromotionForApi,
  setPromotionPaused,
} from '@/src/lib/promoService'
import { PERMISSIONS } from '@/src/lib/rbac'

export const dynamic = 'force-dynamic'

type RouteContext = {
  params: Promise<{ clubId: string; promoId: string }>
}

function errorResponse(error: unknown) {
  if (error instanceof AuthorizationError) {
    return NextResponse.json({ code: error.code, error: error.message }, { status: error.status })
  }
  if (error instanceof PromoManagementError) {
    return NextResponse.json({ code: error.code, error: error.message }, { status: error.status })
  }
  throw error
}

export async function POST(_: NextRequest, routeContext: RouteContext) {
  const { clubId, promoId } = await routeContext.params
  try {
    const context = await getCabinetContext()
    requirePermissionInClub(context, clubId, PERMISSIONS.PROMO_MANAGE)
    const updated = await setPromotionPaused({
      clubId,
      actorUserId: context.userId,
      promoId,
      isActive: false,
    })
    return NextResponse.json(serializePromotionForApi(updated))
  } catch (error) {
    return errorResponse(error)
  }
}

