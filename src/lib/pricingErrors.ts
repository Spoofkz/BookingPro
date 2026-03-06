export type PricingErrorCode =
  | 'VALIDATION_ERROR'
  | 'CLUB_NOT_FOUND'
  | 'ROOM_NOT_FOUND'
  | 'SEGMENT_REQUIRED'
  | 'INVALID_TIME_RANGE'
  | 'PRICING_NO_ACTIVE_VERSION'
  | 'SEAT_SEGMENT_NOT_COVERED'
  | 'PACKAGE_NOT_ELIGIBLE'
  | 'PACKAGE_CONFIG_INVALID'
  | 'PROMO_INVALID'
  | 'PROMO_INVALID_CODE'
  | 'PROMO_EXPIRED'
  | 'PROMO_NOT_ACTIVE'
  | 'PROMO_NOT_ELIGIBLE'
  | 'PROMO_NOT_ELIGIBLE_SEGMENT'
  | 'PROMO_MIN_SPEND_NOT_MET'
  | 'PROMO_USAGE_LIMIT_REACHED'
  | 'SEAT_DISABLED'
  | 'SEAT_NOT_FOUND'
  | 'SLOT_NOT_FOUND'
  | 'SLOT_NOT_BOOKABLE'

export class PricingError extends Error {
  code: PricingErrorCode
  statusCode: number
  details?: unknown

  constructor(code: PricingErrorCode, message: string, statusCode = 400, details?: unknown) {
    super(message)
    this.code = code
    this.statusCode = statusCode
    this.details = details
  }
}

export function isPricingError(value: unknown): value is PricingError {
  return value instanceof PricingError
}
