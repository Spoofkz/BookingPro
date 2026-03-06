import { NextResponse } from 'next/server'

export type ReleaseFeatureKey =
  | 'holds'
  | 'reschedule'
  | 'promos'
  | 'membership_apply'

type FlagMap = Record<ReleaseFeatureKey, boolean>

const DEFAULT_FLAGS: FlagMap = {
  holds: true,
  reschedule: true,
  promos: true,
  membership_apply: true,
}

export class FeatureDisabledError extends Error {
  code: string
  status: number
  feature: ReleaseFeatureKey

  constructor(feature: ReleaseFeatureKey, code: string, message: string, status = 409) {
    super(message)
    this.feature = feature
    this.code = code
    this.status = status
  }
}

function parseBoolean(value: string | undefined) {
  if (!value) return null
  const normalized = value.trim().toLowerCase()
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false
  return null
}

function envEnabled(name: string, fallback: boolean) {
  const parsed = parseBoolean(process.env[name])
  return parsed == null ? fallback : parsed
}

export function getReleaseFeatureFlags(): FlagMap {
  return {
    holds: envEnabled('FEATURE_HOLDS_ENABLED', DEFAULT_FLAGS.holds) &&
      !envEnabled('RELEASE_DISABLE_HOLDS', false),
    reschedule: envEnabled('FEATURE_RESCHEDULE_ENABLED', DEFAULT_FLAGS.reschedule) &&
      !envEnabled('RELEASE_DISABLE_RESCHEDULE', false),
    promos: envEnabled('FEATURE_PROMOS_ENABLED', DEFAULT_FLAGS.promos) &&
      !envEnabled('RELEASE_DISABLE_PROMOS', false),
    membership_apply:
      envEnabled('FEATURE_MEMBERSHIP_APPLY_ENABLED', DEFAULT_FLAGS.membership_apply) &&
      !envEnabled('RELEASE_DISABLE_MEMBERSHIP_APPLY', false),
  }
}

export function isFeatureEnabled(feature: ReleaseFeatureKey) {
  return getReleaseFeatureFlags()[feature]
}

export function assertFeatureEnabled(feature: ReleaseFeatureKey) {
  if (isFeatureEnabled(feature)) return

  if (feature === 'holds') {
    throw new FeatureDisabledError('holds', 'HOLDS_DISABLED', 'Holds are temporarily disabled.')
  }
  if (feature === 'reschedule') {
    throw new FeatureDisabledError(
      'reschedule',
      'RESCHEDULE_DISABLED',
      'Reschedule is temporarily disabled.',
    )
  }
  if (feature === 'promos') {
    throw new FeatureDisabledError(
      'promos',
      'PROMOS_DISABLED',
      'Promotions are temporarily disabled.',
    )
  }
  throw new FeatureDisabledError(
    'membership_apply',
    'MEMBERSHIP_APPLY_DISABLED',
    'Membership application is temporarily disabled.',
  )
}

export function featureErrorResponse(error: unknown) {
  if (!(error instanceof FeatureDisabledError)) return null
  return NextResponse.json(
    {
      code: error.code,
      error: error.message,
      feature: error.feature,
    },
    { status: error.status },
  )
}

