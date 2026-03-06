import { MembershipStatus, Role, UserStatus } from '@prisma/client'
import crypto from 'crypto'
import { prisma } from '@/src/lib/prisma'
import { globalPermissionsForRole, permissionsForRole, type Permission } from '@/src/lib/rbac'

export const AUTH_SESSION_COOKIE = 'auth_session_token'
const OTP_TTL_MINUTES = 5
const OTP_MAX_ATTEMPTS = 5
const OTP_REQUEST_WINDOW_MINUTES = 15
const OTP_REQUEST_MAX_PER_WINDOW = Math.max(
  1,
  Number(process.env.OTP_REQUEST_MAX_PER_WINDOW || '5'),
)
const OTP_VERIFY_WINDOW_MINUTES = 15
const OTP_VERIFY_MAX_PER_WINDOW = Math.max(
  1,
  Number(process.env.OTP_VERIFY_MAX_PER_WINDOW || '10'),
)
const SESSION_TTL_DAYS = 14
const PASSWORD_MIN_LENGTH = Math.max(
  8,
  Number(process.env.PASSWORD_MIN_LENGTH || '8'),
)
const PASSWORD_SCRYPT_LENGTH = 64
const PASSWORD_SCRYPT_N = 16384
const PASSWORD_SCRYPT_R = 8
const PASSWORD_SCRYPT_P = 1

function getStaticNonProdOtpCode() {
  if (process.env.NODE_ENV === 'production') return null
  const configured = process.env.OTP_STATIC_TEST_CODE?.trim()
  if (!configured) return '8888'
  if (!/^\d{4,8}$/.test(configured)) return null
  return configured
}

export class AuthError extends Error {
  code: string
  status: number

  constructor(code: string, message: string, status = 400) {
    super(message)
    this.code = code
    this.status = status
  }
}

export function isDemoAuthEnabled() {
  if (process.env.ALLOW_DEMO_AUTH === 'true') return true
  if (process.env.ALLOW_DEMO_AUTH === 'false') return false
  return process.env.NODE_ENV !== 'production'
}

export function normalizePhone(input: string) {
  const normalized = input.replace(/[^\d+]/g, '').trim()
  if (!normalized) return null
  if (!/^\+?\d{7,15}$/.test(normalized)) return null
  return normalized.startsWith('+') ? normalized : `+${normalized}`
}

export function normalizeEmail(input: string) {
  const normalized = input.trim().toLowerCase()
  if (!normalized) return null
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) return null
  return normalized
}

export function normalizeLogin(input: string) {
  const normalized = input.trim().toLowerCase()
  if (!normalized) return null
  if (!/^[a-z0-9._-]{3,32}$/.test(normalized)) return null
  return normalized
}

function validatePassword(password: string) {
  if (password.length < PASSWORD_MIN_LENGTH) {
    throw new AuthError(
      'WEAK_PASSWORD',
      `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`,
      400,
    )
  }
}

function hashPassword(password: string) {
  validatePassword(password)
  const salt = crypto.randomBytes(16).toString('hex')
  const digest = crypto
    .scryptSync(password, salt, PASSWORD_SCRYPT_LENGTH, {
      N: PASSWORD_SCRYPT_N,
      r: PASSWORD_SCRYPT_R,
      p: PASSWORD_SCRYPT_P,
    })
    .toString('hex')
  return `s2$${salt}$${digest}`
}

function verifyPassword(password: string, passwordHash: string) {
  const chunks = passwordHash.split('$')
  if (chunks.length !== 3 || chunks[0] !== 's2') return false
  const salt = chunks[1]
  const expectedDigest = chunks[2]
  if (!salt || !expectedDigest) return false
  const actualDigest = crypto
    .scryptSync(password, salt, PASSWORD_SCRYPT_LENGTH, {
      N: PASSWORD_SCRYPT_N,
      r: PASSWORD_SCRYPT_R,
      p: PASSWORD_SCRYPT_P,
    })
    .toString('hex')

  const expectedBuffer = Buffer.from(expectedDigest, 'hex')
  const actualBuffer = Buffer.from(actualDigest, 'hex')
  if (expectedBuffer.length !== actualBuffer.length) return false
  return crypto.timingSafeEqual(expectedBuffer, actualBuffer)
}

function sha256(value: string) {
  return crypto.createHash('sha256').update(value).digest('hex')
}

function randomToken() {
  return crypto.randomBytes(32).toString('hex')
}

function randomOtpCode() {
  const value = crypto.randomInt(0, 1000000)
  return String(value).padStart(6, '0')
}

export function getClientIpFromHeaders(headers: Headers) {
  const forwarded = headers.get('x-forwarded-for')
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim()
    if (first) return first
  }
  return headers.get('x-real-ip') || null
}

export async function requestOtpCode(params: {
  phone: string
  ipAddress: string | null
  userAgent: string | null
}) {
  const normalizedPhone = normalizePhone(params.phone)
  if (!normalizedPhone) {
    throw new AuthError('INVALID_PHONE', 'Phone number is invalid.', 400)
  }

  const windowStart = new Date()
  windowStart.setMinutes(windowStart.getMinutes() - OTP_REQUEST_WINDOW_MINUTES)

  const requestsCount = await prisma.authOtpChallenge.count({
    where: {
      phone: normalizedPhone,
      createdAt: { gte: windowStart },
    },
  })
  if (requestsCount >= OTP_REQUEST_MAX_PER_WINDOW) {
    throw new AuthError('OTP_RATE_LIMITED', 'Too many OTP requests. Try again later.', 429)
  }

  const code = getStaticNonProdOtpCode() ?? randomOtpCode()
  const now = new Date()
  const expiresAt = new Date(now.getTime() + OTP_TTL_MINUTES * 60 * 1000)

  await prisma.authOtpChallenge.create({
    data: {
      phone: normalizedPhone,
      codeHash: sha256(code),
      requestIp: params.ipAddress,
      requestUa: params.userAgent,
      expiresAt,
    },
  })

  await prisma.auditLog.create({
    data: {
      clubId: null,
      actorUserId: null,
      action: 'auth.otp.sent',
      entityType: 'phone',
      entityId: normalizedPhone,
      metadata: JSON.stringify({
        ipAddress: params.ipAddress,
        userAgent: params.userAgent,
      }),
    },
  })

  await prisma.auditLog.create({
    data: {
      clubId: null,
      actorUserId: null,
      action: 'auth.otp_requested',
      entityType: 'phone',
      entityId: normalizedPhone,
      metadata: JSON.stringify({
        ipAddress: params.ipAddress,
        userAgent: params.userAgent,
      }),
    },
  })

  return {
    phone: normalizedPhone,
    expiresAt,
    devCode: process.env.NODE_ENV !== 'production' ? code : undefined,
  }
}

async function consumeOtpChallenge(params: {
  phone: string
  code: string
  ipAddress: string | null
  userAgent: string | null
  mode: 'LOGIN' | 'STEP_UP'
}) {
  const normalizedPhone = normalizePhone(params.phone)
  if (!normalizedPhone) {
    throw new AuthError('INVALID_PHONE', 'Phone number is invalid.', 400)
  }

  const code = params.code.trim()
  const staticOtpCode = getStaticNonProdOtpCode()
  if (!/^\d{6}$/.test(code) && !(staticOtpCode && code === staticOtpCode)) {
    throw new AuthError('INVALID_OTP', 'OTP code format is invalid.', 400)
  }

  const verifyWindowStart = new Date()
  verifyWindowStart.setMinutes(verifyWindowStart.getMinutes() - OTP_VERIFY_WINDOW_MINUTES)
  const failedAttempts = await prisma.auditLog.count({
    where: {
      action: 'auth.otp.failed',
      entityType: 'phone',
      entityId: normalizedPhone,
      createdAt: { gte: verifyWindowStart },
    },
  })
  if (failedAttempts >= OTP_VERIFY_MAX_PER_WINDOW) {
    throw new AuthError('OTP_RATE_LIMITED', 'Too many invalid OTP attempts. Try again later.', 429)
  }

  const challenge = await prisma.authOtpChallenge.findFirst({
    where: {
      phone: normalizedPhone,
      consumedAt: null,
      expiresAt: { gt: new Date() },
    },
    orderBy: { createdAt: 'desc' },
  })

  if (!challenge) {
    throw new AuthError('OTP_NOT_FOUND', 'OTP challenge not found or expired.', 401)
  }

  const expectedHash = sha256(code)
  if (challenge.codeHash !== expectedHash) {
    const attemptsUsed = challenge.attemptsUsed + 1
    await prisma.authOtpChallenge.update({
      where: { id: challenge.id },
      data: {
        attemptsUsed,
        consumedAt: attemptsUsed >= OTP_MAX_ATTEMPTS ? new Date() : null,
      },
    })

    await prisma.auditLog.create({
      data: {
        clubId: null,
        actorUserId: null,
        action: 'auth.otp.failed',
        entityType: 'phone',
        entityId: normalizedPhone,
        metadata: JSON.stringify({
          mode: params.mode,
          reason: 'invalid_otp',
          attemptsUsed,
          ipAddress: params.ipAddress,
          userAgent: params.userAgent,
        }),
      },
    })

    await prisma.auditLog.create({
      data: {
        clubId: null,
        actorUserId: null,
        action: 'auth.login_failed',
        entityType: 'phone',
        entityId: normalizedPhone,
        metadata: JSON.stringify({
          reason: 'invalid_otp',
          attemptsUsed,
          ipAddress: params.ipAddress,
        }),
      },
    })

    throw new AuthError('INVALID_OTP', 'OTP code is invalid.', 401)
  }

  await prisma.authOtpChallenge.update({
    where: { id: challenge.id },
    data: { consumedAt: new Date() },
  })

  return { normalizedPhone }
}

async function createSession(params: {
  userId: string
  ipAddress: string | null
  userAgent: string | null
}) {
  const now = new Date()
  const expiresAt = new Date(now.getTime() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000)
  const token = randomToken()
  const tokenHash = sha256(token)

  const session = await prisma.authSession.create({
    data: {
      userId: params.userId,
      tokenHash,
      ipAddress: params.ipAddress,
      userAgent: params.userAgent,
      expiresAt,
      lastSeenAt: now,
    },
    select: {
      id: true,
      userId: true,
      expiresAt: true,
      createdAt: true,
    },
  })

  return {
    token,
    session,
  }
}

export async function verifyOtpCode(params: {
  phone: string
  code: string
  ipAddress: string | null
  userAgent: string | null
}) {
  const { normalizedPhone } = await consumeOtpChallenge({
    phone: params.phone,
    code: params.code,
    ipAddress: params.ipAddress,
    userAgent: params.userAgent,
    mode: 'LOGIN',
  })

  let user = await prisma.user.findUnique({
    where: { phone: normalizedPhone },
  })

  if (!user) {
    const suffix = normalizedPhone.slice(-4)
    user = await prisma.user.create({
      data: {
        phone: normalizedPhone,
        name: `User ${suffix}`,
        status: UserStatus.ACTIVE,
      },
    })
  }

  if (user.status !== UserStatus.ACTIVE) {
    throw new AuthError('USER_DISABLED', 'User account is disabled.', 403)
  }

  const { token, session } = await createSession({
    userId: user.id,
    ipAddress: params.ipAddress,
    userAgent: params.userAgent,
  })

  await prisma.auditLog.create({
    data: {
      clubId: null,
      actorUserId: user.id,
      action: 'auth.login',
      entityType: 'session',
      entityId: session.id,
      metadata: JSON.stringify({
        ipAddress: params.ipAddress,
        userAgent: params.userAgent,
      }),
    },
  })

  await prisma.auditLog.create({
    data: {
      clubId: null,
      actorUserId: user.id,
      action: 'auth.login_success',
      entityType: 'session',
      entityId: session.id,
      metadata: JSON.stringify({
        ipAddress: params.ipAddress,
        userAgent: params.userAgent,
      }),
    },
  })

  return {
    token,
    sessionId: session.id,
    expiresAt: session.expiresAt,
    userId: user.id,
  }
}

export async function registerWithCredentials(params: {
  login: string
  email: string
  phone: string
  password: string
  ipAddress: string | null
  userAgent: string | null
}) {
  const normalizedLogin = normalizeLogin(params.login)
  const normalizedEmail = normalizeEmail(params.email)
  const normalizedPhone = normalizePhone(params.phone)

  if (!normalizedLogin) {
    throw new AuthError(
      'INVALID_LOGIN',
      'Login must be 3-32 chars and contain only letters, numbers, dot, underscore, or hyphen.',
      400,
    )
  }
  if (!normalizedEmail) {
    throw new AuthError('INVALID_EMAIL', 'Email format is invalid.', 400)
  }
  if (!normalizedPhone) {
    throw new AuthError('INVALID_PHONE', 'Phone number is invalid.', 400)
  }

  const passwordHash = hashPassword(params.password)
  const existing = await prisma.user.findFirst({
    where: {
      OR: [
        { login: normalizedLogin },
        { email: normalizedEmail },
        { phone: normalizedPhone },
      ],
    },
    select: { id: true },
  })
  if (existing) {
    throw new AuthError(
      'ACCOUNT_ALREADY_EXISTS',
      'Account with provided login/email/phone already exists.',
      409,
    )
  }

  const user = await prisma.user.create({
    data: {
      login: normalizedLogin,
      name: normalizedLogin,
      email: normalizedEmail,
      phone: normalizedPhone,
      passwordHash,
      status: UserStatus.ACTIVE,
    },
    select: { id: true },
  })

  const { token, session } = await createSession({
    userId: user.id,
    ipAddress: params.ipAddress,
    userAgent: params.userAgent,
  })

  await prisma.auditLog.create({
    data: {
      clubId: null,
      actorUserId: user.id,
      action: 'auth.register',
      entityType: 'user',
      entityId: user.id,
      metadata: JSON.stringify({
        login: normalizedLogin,
        email: normalizedEmail,
        phone: normalizedPhone,
      }),
    },
  })

  await prisma.auditLog.create({
    data: {
      clubId: null,
      actorUserId: user.id,
      action: 'auth.login_success',
      entityType: 'session',
      entityId: session.id,
      metadata: JSON.stringify({
        method: 'password',
        ipAddress: params.ipAddress,
        userAgent: params.userAgent,
      }),
    },
  })

  return {
    token,
    sessionId: session.id,
    expiresAt: session.expiresAt,
    userId: user.id,
    login: normalizedLogin,
    email: normalizedEmail,
    phone: normalizedPhone,
  }
}

export async function loginWithCredentials(params: {
  identifier: string
  password: string
  ipAddress: string | null
  userAgent: string | null
}) {
  const rawIdentifier = params.identifier.trim()
  if (!rawIdentifier) {
    throw new AuthError('INVALID_IDENTIFIER', 'login/email/phone is required.', 400)
  }

  const normalizedEmail = normalizeEmail(rawIdentifier)
  const normalizedPhone = normalizePhone(rawIdentifier)
  const normalizedLogin = normalizeLogin(rawIdentifier)

  const query = normalizedEmail
    ? { email: normalizedEmail }
    : normalizedPhone
      ? { phone: normalizedPhone }
      : normalizedLogin
        ? { login: normalizedLogin }
        : null

  if (!query) {
    throw new AuthError(
      'INVALID_IDENTIFIER',
      'Use a valid login, email, or phone number.',
      400,
    )
  }

  const user = await prisma.user.findFirst({
    where: query,
    select: {
      id: true,
      status: true,
      passwordHash: true,
    },
  })

  if (!user || !user.passwordHash || !verifyPassword(params.password, user.passwordHash)) {
    await prisma.auditLog.create({
      data: {
        clubId: null,
        actorUserId: user?.id || null,
        action: 'auth.login_failed',
        entityType: 'credential',
        entityId: rawIdentifier,
        metadata: JSON.stringify({
          method: 'password',
          ipAddress: params.ipAddress,
          userAgent: params.userAgent,
          reason: 'invalid_credentials',
        }),
      },
    })
    throw new AuthError('INVALID_CREDENTIALS', 'Invalid login credentials.', 401)
  }

  if (user.status !== UserStatus.ACTIVE) {
    throw new AuthError('USER_DISABLED', 'User account is disabled.', 403)
  }

  const { token, session } = await createSession({
    userId: user.id,
    ipAddress: params.ipAddress,
    userAgent: params.userAgent,
  })

  await prisma.auditLog.create({
    data: {
      clubId: null,
      actorUserId: user.id,
      action: 'auth.login',
      entityType: 'session',
      entityId: session.id,
      metadata: JSON.stringify({
        method: 'password',
        ipAddress: params.ipAddress,
        userAgent: params.userAgent,
      }),
    },
  })

  await prisma.auditLog.create({
    data: {
      clubId: null,
      actorUserId: user.id,
      action: 'auth.login_success',
      entityType: 'session',
      entityId: session.id,
      metadata: JSON.stringify({
        method: 'password',
        ipAddress: params.ipAddress,
        userAgent: params.userAgent,
      }),
    },
  })

  return {
    token,
    sessionId: session.id,
    expiresAt: session.expiresAt,
    userId: user.id,
  }
}

export async function changePasswordWithCredentials(params: {
  userId: string
  currentPassword?: string | null
  newPassword: string
  ipAddress: string | null
  userAgent: string | null
}) {
  const user = await prisma.user.findUnique({
    where: { id: params.userId },
    select: {
      id: true,
      status: true,
      passwordHash: true,
    },
  })

  if (!user) {
    throw new AuthError('USER_NOT_FOUND', 'User not found.', 404)
  }
  if (user.status !== UserStatus.ACTIVE) {
    throw new AuthError('USER_DISABLED', 'User account is disabled.', 403)
  }

  const currentPassword = params.currentPassword?.trim() || ''
  if (user.passwordHash) {
    if (!currentPassword) {
      throw new AuthError('CURRENT_PASSWORD_REQUIRED', 'Current password is required.', 400)
    }
    if (!verifyPassword(currentPassword, user.passwordHash)) {
      throw new AuthError('INVALID_CREDENTIALS', 'Current password is invalid.', 401)
    }
  }

  const nextHash = hashPassword(params.newPassword)
  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: nextHash },
  })

  await prisma.auditLog.create({
    data: {
      clubId: null,
      actorUserId: user.id,
      action: 'auth.password.changed',
      entityType: 'user',
      entityId: user.id,
      metadata: JSON.stringify({
        ipAddress: params.ipAddress,
        userAgent: params.userAgent,
      }),
    },
  })

  return { ok: true }
}

export async function verifyOtpStepUp(params: {
  phone: string
  code: string
  actorUserId: string
  ipAddress: string | null
  userAgent: string | null
}) {
  const { normalizedPhone } = await consumeOtpChallenge({
    phone: params.phone,
    code: params.code,
    ipAddress: params.ipAddress,
    userAgent: params.userAgent,
    mode: 'STEP_UP',
  })

  await prisma.auditLog.create({
    data: {
      clubId: null,
      actorUserId: params.actorUserId,
      action: 'auth.step_up_verified',
      entityType: 'phone',
      entityId: normalizedPhone,
      metadata: JSON.stringify({
        ipAddress: params.ipAddress,
        userAgent: params.userAgent,
      }),
    },
  })

  return { phone: normalizedPhone }
}

export async function getSessionUserByToken(token: string | null | undefined) {
  if (!token) return null
  const tokenHash = sha256(token)
  const now = new Date()

  const session = await prisma.authSession.findUnique({
    where: { tokenHash },
    include: {
      user: {
        include: {
          memberships: {
            where: { status: MembershipStatus.ACTIVE },
            include: { club: true },
            orderBy: [{ createdAt: 'asc' }, { role: 'asc' }],
          },
        },
      },
    },
  })

  if (!session) return null
  if (session.revokedAt) return null
  if (session.expiresAt <= now) return null
  if (session.user.status !== UserStatus.ACTIVE) return null

  await prisma.authSession.update({
    where: { id: session.id },
    data: { lastSeenAt: now },
  })

  return session.user
}

export async function revokeSessionByToken(token: string | null | undefined, reason = 'logout') {
  if (!token) return false
  const tokenHash = sha256(token)
  const session = await prisma.authSession.findUnique({
    where: { tokenHash },
    select: { id: true, userId: true, revokedAt: true },
  })

  if (!session || session.revokedAt) return false

  await prisma.authSession.update({
    where: { id: session.id },
    data: {
      revokedAt: new Date(),
      revokedReason: reason,
    },
  })

  await prisma.auditLog.create({
    data: {
      clubId: null,
      actorUserId: session.userId,
      action: 'auth.session.revoked',
      entityType: 'session',
      entityId: session.id,
      metadata: JSON.stringify({ reason }),
    },
  })

  await prisma.auditLog.create({
    data: {
      clubId: null,
      actorUserId: session.userId,
      action: 'auth.logout',
      entityType: 'session',
      entityId: session.id,
      metadata: JSON.stringify({ reason }),
    },
  })

  return true
}

async function getSessionByToken(token: string | null | undefined) {
  if (!token) return null
  const tokenHash = sha256(token)
  return prisma.authSession.findUnique({
    where: { tokenHash },
    select: {
      id: true,
      userId: true,
      revokedAt: true,
      expiresAt: true,
    },
  })
}

export async function getSessionIdByToken(token: string | null | undefined) {
  const session = await getSessionByToken(token)
  if (!session) return null
  if (session.revokedAt) return null
  if (session.expiresAt <= new Date()) return null
  return session.id
}

export async function listUserSessions(userId: string) {
  return prisma.authSession.findMany({
    where: {
      userId,
      revokedAt: null,
      expiresAt: { gt: new Date() },
    },
    select: {
      id: true,
      userAgent: true,
      ipAddress: true,
      createdAt: true,
      lastSeenAt: true,
      expiresAt: true,
    },
    orderBy: [{ lastSeenAt: 'desc' }, { createdAt: 'desc' }],
  })
}

export async function revokeSessionByIdForUser(params: {
  userId: string
  sessionId: string
  reason?: string
}) {
  const session = await prisma.authSession.findFirst({
    where: {
      id: params.sessionId,
      userId: params.userId,
      revokedAt: null,
    },
    select: {
      id: true,
      userId: true,
    },
  })

  if (!session) return false

  const reason = params.reason || 'session_revoked'
  await prisma.authSession.update({
    where: { id: session.id },
    data: {
      revokedAt: new Date(),
      revokedReason: reason,
    },
  })

  await prisma.auditLog.create({
    data: {
      clubId: null,
      actorUserId: session.userId,
      action: 'auth.session.revoked',
      entityType: 'session',
      entityId: session.id,
      metadata: JSON.stringify({ reason }),
    },
  })

  return true
}

export async function revokeOtherUserSessions(params: {
  userId: string
  keepSessionId: string | null
  reason?: string
}) {
  const reason = params.reason || 'logout_other_sessions'
  const where = {
    userId: params.userId,
    revokedAt: null as Date | null,
    ...(params.keepSessionId ? { id: { not: params.keepSessionId } } : {}),
  }

  const sessions = await prisma.authSession.findMany({
    where,
    select: { id: true },
  })

  if (sessions.length === 0) return 0

  const now = new Date()
  await prisma.authSession.updateMany({
    where,
    data: {
      revokedAt: now,
      revokedReason: reason,
    },
  })

  await prisma.auditLog.createMany({
    data: sessions.map((session) => ({
      clubId: null,
      actorUserId: params.userId,
      action: 'auth.session.revoked',
      entityType: 'session',
      entityId: session.id,
      metadata: JSON.stringify({ reason }),
    })),
  })

  return sessions.length
}

export async function revokeAllUserSessions(userId: string, reason = 'logout_all') {
  const now = new Date()
  await prisma.authSession.updateMany({
    where: {
      userId,
      revokedAt: null,
    },
    data: {
      revokedAt: now,
      revokedReason: reason,
    },
  })

  await prisma.auditLog.create({
    data: {
      clubId: null,
      actorUserId: userId,
      action: 'auth.logout_all',
      entityType: 'user',
      entityId: userId,
      metadata: JSON.stringify({ reason }),
    },
  })
}

export type MembershipCapability = {
  clubId: string
  role: Role
  status: MembershipStatus
}

export type CapabilitySnapshot = {
  global: Permission[]
  byClub: Record<string, Permission[]>
}

export function buildCapabilitySnapshot(memberships: MembershipCapability[]): CapabilitySnapshot {
  const globalSet = new Set<Permission>(globalPermissionsForRole(Role.CLIENT))
  const byClubMap = new Map<string, Set<Permission>>()

  for (const membership of memberships) {
    if (membership.status !== MembershipStatus.ACTIVE) continue
    const set = byClubMap.get(membership.clubId) ?? new Set<Permission>()
    for (const permission of permissionsForRole(membership.role)) {
      set.add(permission)
    }
    byClubMap.set(membership.clubId, set)
  }

  const byClub: Record<string, Permission[]> = {}
  for (const [clubId, permissions] of byClubMap.entries()) {
    byClub[clubId] = Array.from(permissions.values()).sort()
  }

  return {
    global: Array.from(globalSet.values()).sort(),
    byClub,
  }
}
