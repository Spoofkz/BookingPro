import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'
import test from 'node:test'

const PORT = Number(process.env.CLIENT_CABINET_TEST_PORT || 3111)
const BASE_URL = `http://127.0.0.1:${PORT}`
const DEV_SERVER_START_TIMEOUT_MS = 120_000
const REQUEST_TIMEOUT_MS = 20_000

/** @type {import('node:child_process').ChildProcessWithoutNullStreams | null} */
let devServer = null
const serverLog = []
const cookies = new Map()

let hostClubId = ''
let createdHostBookingId = null
let createdClientTicketId = null

function rememberLog(prefix, chunk) {
  const line = `${prefix}${String(chunk).trim()}`
  if (!line) return
  serverLog.push(line)
  if (serverLog.length > 150) {
    serverLog.splice(0, serverLog.length - 150)
  }
}

function parseJsonSafely(raw) {
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

function storeSetCookies(response) {
  const getSetCookie = response.headers.getSetCookie
  const lines = typeof getSetCookie === 'function' ? getSetCookie.call(response.headers) : []
  for (const line of lines) {
    const firstPart = line.split(';', 1)[0] || ''
    const eqIndex = firstPart.indexOf('=')
    if (eqIndex <= 0) continue
    const key = firstPart.slice(0, eqIndex).trim()
    const value = firstPart.slice(eqIndex + 1)
    if (!key) continue
    if (!value) {
      cookies.delete(key)
    } else {
      cookies.set(key, value)
    }
  }
}

function cookieHeaderValue() {
  return Array.from(cookies.entries())
    .map(([key, value]) => `${key}=${value}`)
    .join('; ')
}

function clearCookies() {
  cookies.clear()
}

async function api(path, init = {}) {
  const headers = new Headers(init.headers || {})
  const cookie = cookieHeaderValue()
  if (cookie) {
    headers.set('cookie', cookie)
  }
  if (init.body && !headers.has('content-type')) {
    headers.set('content-type', 'application/json')
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  let response
  try {
    response = await fetch(`${BASE_URL}${path}`, {
      ...init,
      headers,
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timeout)
  }

  storeSetCookies(response)
  const text = await response.text()
  const json = parseJsonSafely(text)
  return { status: response.status, ok: response.ok, text, json }
}

async function waitForServerReady() {
  const startedAt = Date.now()
  while (Date.now() - startedAt < DEV_SERVER_START_TIMEOUT_MS) {
    try {
      const response = await fetch(`${BASE_URL}/api/me`, { redirect: 'manual' })
      if (response.status !== 500 && response.status !== 503) return
    } catch {
      // keep waiting
    }
    await delay(500)
  }
  throw new Error(`Dev server did not start.\n${serverLog.slice(-40).join('\n')}`)
}

async function setContext(payload) {
  const response = await api('/api/context', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
  assert.equal(response.status, 200, `Expected /api/context 200, got ${response.status}: ${response.text}`)
  return response.json
}

async function switchContext(userEmail, clubId, role) {
  await setContext({ userEmail })
  const payload = {}
  if (clubId !== undefined) payload.clubId = clubId
  if (role) payload.role = role
  if (Object.keys(payload).length > 0) {
    await setContext(payload)
  }
}

function dateRangeAfterDays(daysFromNow = 14) {
  const start = new Date(Date.now() + daysFromNow * 24 * 60 * 60 * 1000)
  const end = new Date(start.getTime() + 2 * 60 * 60 * 1000)
  return {
    start: start.toISOString(),
    end: end.toISOString(),
  }
}

async function requestDevOtp(phone) {
  const otpRequest = await api('/api/auth/otp/send', {
    method: 'POST',
    body: JSON.stringify({ phone }),
  })
  assert.equal(otpRequest.status, 200, `Expected otp send 200, got ${otpRequest.status}: ${otpRequest.text}`)
  const devCode = otpRequest.json?.devCode
  assert.ok(devCode, `Expected devCode in non-prod OTP response: ${otpRequest.text}`)
  return devCode
}

async function loginClientSession() {
  await switchContext('client@example.com')
  const me = await api('/api/me')
  assert.equal(me.status, 200, `Expected /api/me 200, got ${me.status}: ${me.text}`)
  const phone = me.json?.profile?.phone
  assert.ok(phone, `Expected client phone for OTP login: ${me.text}`)

  const devCode = await requestDevOtp(phone)
  const otpVerify = await api('/api/auth/otp/verify', {
    method: 'POST',
    body: JSON.stringify({ phone, code: devCode }),
  })
  assert.equal(otpVerify.status, 200, `Expected otp verify 200, got ${otpVerify.status}: ${otpVerify.text}`)
}

async function ensureClientSession() {
  const current = await api('/api/client/me')
  if (current.status === 200) return
  assert.equal(current.status, 401, `Expected /api/client/me 401 without session: ${current.text}`)
  await loginClientSession()
}

test.before(async () => {
  devServer = spawn(
    'npm',
    ['run', 'dev', '--', '--hostname', '127.0.0.1', '--port', String(PORT)],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        NODE_ENV: 'development',
        ALLOW_DEMO_AUTH: 'true',
        OTP_REQUEST_MAX_PER_WINDOW: '25',
        OTP_VERIFY_MAX_PER_WINDOW: '40',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  )

  devServer.stdout.on('data', (chunk) => rememberLog('[dev] ', chunk))
  devServer.stderr.on('data', (chunk) => rememberLog('[dev:err] ', chunk))

  await waitForServerReady()

  await switchContext('host@example.com')
  const me = await api('/api/me')
  assert.equal(me.status, 200, `Expected /api/me 200, got ${me.status}: ${me.text}`)
  hostClubId = me.json?.activeClubId
  assert.ok(hostClubId, `Expected activeClubId in /api/me response: ${me.text}`)

  const bookings = await api('/api/bookings?scope=club&pageSize=50', {
    headers: { 'X-Club-Id': hostClubId },
  })
  assert.equal(bookings.status, 200, `Expected /api/bookings 200, got ${bookings.status}: ${bookings.text}`)
  assert.ok(Array.isArray(bookings.json?.items), `Expected bookings items: ${bookings.text}`)

  const candidate = bookings.json.items.find(
    (item) =>
      item.guestEmail?.toLowerCase?.() !== 'client@example.com' &&
      item.guestEmail?.toLowerCase?.() !== 'azamat@example.com',
  )
  assert.ok(candidate, `Expected at least one non-client booking in host scope: ${bookings.text}`)
  createdHostBookingId = candidate.id
})

test.after(async () => {
  if (devServer) {
    devServer.kill('SIGTERM')
    await delay(500)
  }
})

test('client cannot fetch another user booking by id (404)', async () => {
  assert.ok(createdHostBookingId, 'Expected host booking id.')
  await switchContext('client@example.com')

  const unauthorizedDetail = await api(`/api/bookings/${createdHostBookingId}`)
  assert.equal(
    unauthorizedDetail.status,
    404,
    `Expected booking details 404 for non-owner client, got ${unauthorizedDetail.status}: ${unauthorizedDetail.text}`,
  )
})

test('anonymous user cannot create seat hold (401)', async () => {
  assert.ok(hostClubId, 'Expected host club id.')
  clearCookies()

  const denied = await api(`/api/clubs/${hostClubId}/holds`, {
    method: 'POST',
    body: JSON.stringify({
      slotId: 'slot_anon_test',
      seatId: 'seat_anon_test',
    }),
  })
  assert.equal(
    denied.status,
    401,
    `Expected anonymous hold create 401, got ${denied.status}: ${denied.text}`,
  )
})

test('profile sensitive change requires OTP step-up code', async () => {
  await ensureClientSession()

  const updateWithoutOtp = await api('/api/me/profile', {
    method: 'PATCH',
    body: JSON.stringify({
      email: 'client-stepup-check@example.com',
    }),
  })
  assert.equal(
    updateWithoutOtp.status,
    409,
    `Expected profile update without otp 409, got ${updateWithoutOtp.status}: ${updateWithoutOtp.text}`,
  )
  assert.equal(
    updateWithoutOtp.json?.code,
    'STEP_UP_REQUIRED',
    `Expected STEP_UP_REQUIRED code: ${updateWithoutOtp.text}`,
  )
})

test('client security sessions endpoint returns active device list', async () => {
  await switchContext('client@example.com')

  const meBefore = await api('/api/me')
  assert.equal(meBefore.status, 200, `Expected /api/me 200, got ${meBefore.status}: ${meBefore.text}`)
  const phone = meBefore.json?.profile?.phone
  assert.ok(phone, `Expected client phone for OTP login flow: ${meBefore.text}`)

  const devCode = await requestDevOtp(phone)

  const otpVerify = await api('/api/auth/otp/verify', {
    method: 'POST',
    body: JSON.stringify({ phone, code: devCode }),
  })
  assert.equal(otpVerify.status, 200, `Expected otp verify 200, got ${otpVerify.status}: ${otpVerify.text}`)

  const sessions = await api('/api/auth/sessions')
  assert.equal(sessions.status, 200, `Expected /api/auth/sessions 200, got ${sessions.status}: ${sessions.text}`)
  assert.ok(Array.isArray(sessions.json?.items), `Expected items array: ${sessions.text}`)
  assert.ok(sessions.json.items.length >= 1, `Expected at least one session: ${sessions.text}`)
})

test('client profile endpoint supports preference updates', async () => {
  await ensureClientSession()

  const me = await api('/api/client/me')
  assert.equal(me.status, 200, `Expected /api/client/me 200, got ${me.status}: ${me.text}`)
  assert.ok(me.json?.profile?.name, `Expected profile payload: ${me.text}`)

  const updated = await api('/api/client/me', {
    method: 'PATCH',
    body: JSON.stringify({
      preferredLanguage: 'ru',
      marketingOptIn: true,
      transactionalOptIn: true,
    }),
  })
  assert.equal(updated.status, 200, `Expected /api/client/me PATCH 200, got ${updated.status}: ${updated.text}`)
  assert.equal(updated.json?.profile?.preferredLanguage, 'ru', `Expected language updated: ${updated.text}`)
  assert.equal(updated.json?.profile?.marketingOptIn, true, `Expected marketingOptIn true: ${updated.text}`)
})

test('client booking endpoint denies foreign booking with 404', async () => {
  assert.ok(createdHostBookingId, 'Expected host booking id.')
  await ensureClientSession()

  const unauthorizedDetail = await api(`/api/client/bookings/${createdHostBookingId}`)
  assert.equal(
    unauthorizedDetail.status,
    404,
    `Expected /api/client/bookings/:id 404 for non-owner, got ${unauthorizedDetail.status}: ${unauthorizedDetail.text}`,
  )
})

test('client can create and list support requests', async () => {
  await ensureClientSession()

  const created = await api('/api/client/tickets', {
    method: 'POST',
    body: JSON.stringify({
      subject: 'Need help with booking policy',
      description: 'Please clarify cancellation policy window.',
      type: 'BOOKING_ISSUE',
    }),
  })
  assert.equal(created.status, 201, `Expected tickets create 201, got ${created.status}: ${created.text}`)
  assert.ok(created.json?.id, `Expected dispute id: ${created.text}`)
  createdClientTicketId = created.json.id

  const listed = await api('/api/client/tickets')
  assert.equal(listed.status, 200, `Expected tickets list 200, got ${listed.status}: ${listed.text}`)
  assert.ok(Array.isArray(listed.json?.items), `Expected support items array: ${listed.text}`)
  assert.ok(
    listed.json.items.some((item) => item.id === created.json.id),
    `Expected created support request in list: ${listed.text}`,
  )
})

test('client can add a ticket message thread', async () => {
  assert.ok(createdClientTicketId, 'Expected created ticket id.')
  await ensureClientSession()

  const added = await api(`/api/client/tickets/${createdClientTicketId}/messages`, {
    method: 'POST',
    body: JSON.stringify({
      text: 'Additional details from client side.',
    }),
  })
  assert.equal(added.status, 201, `Expected message create 201, got ${added.status}: ${added.text}`)

  const detail = await api(`/api/client/tickets/${createdClientTicketId}`)
  assert.equal(detail.status, 200, `Expected ticket detail 200, got ${detail.status}: ${detail.text}`)
  assert.ok(Array.isArray(detail.json?.messages), `Expected messages in ticket detail: ${detail.text}`)
  assert.ok(
    detail.json.messages.some((item) => item.text === 'Additional details from client side.'),
    `Expected created message in ticket detail: ${detail.text}`,
  )
})

test('client privacy export requires step-up otp and stores request', async () => {
  await ensureClientSession()
  const me = await api('/api/me')
  assert.equal(me.status, 200, `Expected /api/me 200, got ${me.status}: ${me.text}`)
  const phone = me.json?.profile?.phone
  assert.ok(phone, `Expected profile phone for step-up: ${me.text}`)

  const missingOtp = await api('/api/client/privacy/export', {
    method: 'POST',
    body: JSON.stringify({
      reason: 'Need all my personal data.',
    }),
  })
  assert.equal(missingOtp.status, 409, `Expected missing otp 409, got ${missingOtp.status}: ${missingOtp.text}`)
  assert.equal(missingOtp.json?.code, 'STEP_UP_REQUIRED', `Expected STEP_UP_REQUIRED: ${missingOtp.text}`)

  const devCode = await requestDevOtp(phone)
  const created = await api('/api/client/privacy/export', {
    method: 'POST',
    body: JSON.stringify({
      otpCode: devCode,
      reason: 'Need all my personal data.',
    }),
  })
  assert.equal(created.status, 201, `Expected privacy export 201, got ${created.status}: ${created.text}`)
  assert.equal(created.json?.requestType, 'EXPORT', `Expected EXPORT response: ${created.text}`)

  const listed = await api('/api/client/privacy/requests')
  assert.equal(listed.status, 200, `Expected privacy list 200, got ${listed.status}: ${listed.text}`)
  assert.ok(Array.isArray(listed.json?.items), `Expected privacy items array: ${listed.text}`)
  assert.ok(
    listed.json.items.some((item) => item.requestId === created.json.requestId),
    `Expected created privacy request in list: ${listed.text}`,
  )
})
