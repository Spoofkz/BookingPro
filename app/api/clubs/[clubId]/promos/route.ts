import { PromotionType } from '@prisma/client'
import { NextRequest, NextResponse } from 'next/server'
import { AuthorizationError, requirePermissionInClub } from '@/src/lib/authorization'
import { getCabinetContext } from '@/src/lib/cabinetContext'
import {
  createPromotion,
  listPromotions,
  PromoManagementError,
  type PromoWriteInput,
} from '@/src/lib/promoService'
import { PERMISSIONS } from '@/src/lib/rbac'

export const dynamic = 'force-dynamic'

type RouteContext = {
  params: Promise<{ clubId: string }>
}

type PromoPayload = {
  code?: string | null
  name?: string | null
  descriptionPublic?: string | null
  discountType?: 'PERCENT_OFF' | 'FIXED_OFF'
  isAutomatic?: boolean
  type?: string
  value?: number
  activeFromUtc?: string
  activeToUtc?: string
  constraints?: Record<string, unknown> | null
  usage?: Record<string, unknown> | null
  status?: string
}

function parseDate(value: unknown, field: string) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new PromoManagementError('VALIDATION_ERROR', 400, `${field} is required.`)
  }
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) {
    throw new PromoManagementError('VALIDATION_ERROR', 400, `${field} is invalid.`)
  }
  return parsed
}

function parsePromotionType(body: PromoPayload) {
  if (body.type === PromotionType.PROMO_CODE_PERCENT) return PromotionType.PROMO_CODE_PERCENT
  if (body.type === PromotionType.PROMO_CODE_FIXED) return PromotionType.PROMO_CODE_FIXED
  if (body.type === PromotionType.AUTO_TIME_PROMO) return PromotionType.AUTO_TIME_PROMO
  if (body.type === PromotionType.AUTO_FIXED_PROMO) return PromotionType.AUTO_FIXED_PROMO

  const automatic = body.isAutomatic === true
  if (body.discountType === 'PERCENT_OFF') {
    return automatic ? PromotionType.AUTO_TIME_PROMO : PromotionType.PROMO_CODE_PERCENT
  }
  if (body.discountType === 'FIXED_OFF') {
    return automatic ? PromotionType.AUTO_FIXED_PROMO : PromotionType.PROMO_CODE_FIXED
  }
  throw new PromoManagementError('VALIDATION_ERROR', 400, 'Promo type is invalid.')
}

function parseWriteBody(clubId: string, actorUserId: string, payload: PromoPayload): PromoWriteInput {
  const type = parsePromotionType(payload)
  const normalizedStatus = payload.status?.trim().toUpperCase()
  return {
    clubId,
    actorUserId,
    code: payload.code,
    name: payload.name,
    descriptionPublic: payload.descriptionPublic,
    type,
    value: Number(payload.value),
    activeFromUtc: parseDate(payload.activeFromUtc, 'activeFromUtc'),
    activeToUtc: parseDate(payload.activeToUtc, 'activeToUtc'),
    isActive: normalizedStatus === 'PAUSED' ? false : true,
    constraints:
      payload.constraints && typeof payload.constraints === 'object' && !Array.isArray(payload.constraints)
        ? (payload.constraints as PromoWriteInput['constraints'])
        : null,
    usage:
      payload.usage && typeof payload.usage === 'object' && !Array.isArray(payload.usage)
        ? (payload.usage as PromoWriteInput['usage'])
        : null,
  }
}

function errorResponse(error: unknown) {
  if (error instanceof AuthorizationError) {
    return NextResponse.json({ code: error.code, error: error.message }, { status: error.status })
  }
  if (error instanceof PromoManagementError) {
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
  const { clubId } = await routeContext.params
  try {
    const context = await getCabinetContext()
    requirePermissionInClub(context, clubId, PERMISSIONS.PROMO_MANAGE)

    const items = await listPromotions({
      clubId,
      status: request.nextUrl.searchParams.get('status'),
      q: request.nextUrl.searchParams.get('q'),
    })

    return NextResponse.json({ items })
  } catch (error) {
    return errorResponse(error)
  }
}

export async function POST(request: NextRequest, routeContext: RouteContext) {
  const { clubId } = await routeContext.params
  try {
    const context = await getCabinetContext()
    requirePermissionInClub(context, clubId, PERMISSIONS.PROMO_MANAGE)

    let body: PromoPayload
    try {
      body = (await request.json()) as PromoPayload
    } catch {
      return NextResponse.json({ error: 'Invalid JSON payload.' }, { status: 400 })
    }

    const created = await createPromotion(parseWriteBody(clubId, context.userId, body))
    return NextResponse.json(created, { status: 201 })
  } catch (error) {
    return errorResponse(error)
  }
}

