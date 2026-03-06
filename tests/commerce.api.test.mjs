import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { spawn } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'
import test from 'node:test'

const PORT = Number(process.env.COMMERCE_TEST_PORT || 3112)
const BASE_URL = `http://127.0.0.1:${PORT}`
const DEV_SERVER_START_TIMEOUT_MS = 120_000
const REQUEST_TIMEOUT_MS = 20_000
const WEBHOOK_SECRET = process.env.PAYMENT_WEBHOOK_SECRET || 'dev-webhook-secret'

/** @type {import('node:child_process').ChildProcessWithoutNullStreams | null} */
let devServer = null
const serverLog = []
const cookies = new Map()

let hostClubId = ''
let candidateSlotIds = []
let candidateFloors = []
let slotCursor = 0
let seatCursor = 0
let testClientPhone = ''

function rememberLog(prefix, chunk) {
  const line = `${prefix}${String(chunk).trim()}`
  if (!line) return
  serverLog.push(line)
  if (serverLog.length > 200) {
    serverLog.splice(0, serverLog.length - 200)
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

function nextIdempotencyKey(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`
}

function webhookSignature(payload) {
  return crypto.createHmac('sha256', WEBHOOK_SECRET).update(payload).digest('hex')
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
  throw new Error(`Dev server did not start.\n${serverLog.slice(-60).join('\n')}`)
}

async function setContext(payload) {
  const response = await api('/api/context', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
  assert.equal(response.status, 200, `Expected /api/context 200, got ${response.status}: ${response.text}`)
  return response.json
}

async function switchContext(userEmail) {
  await setContext({ userEmail })
}

function dateInputAfterDays(daysFromNow = 2) {
  const date = new Date(Date.now() + daysFromNow * 24 * 60 * 60 * 1000)
  const year = date.getUTCFullYear()
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  const day = String(date.getUTCDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

async function requestDevOtp(phone) {
  const otpRequest = await api('/api/auth/otp/send', {
    method: 'POST',
    body: JSON.stringify({ phone }),
  })
  assert.equal(otpRequest.status, 200, `Expected otp send 200, got ${otpRequest.status}: ${otpRequest.text}`)
  const devCode = otpRequest.json?.devCode
  assert.ok(devCode, `Expected devCode in OTP response: ${otpRequest.text}`)
  return devCode
}

async function loginSessionForUser(userEmail) {
  clearCookies()
  await switchContext(userEmail)
  const me = await api('/api/me')
  assert.equal(me.status, 200, `Expected /api/me 200, got ${me.status}: ${me.text}`)
  const phone = me.json?.profile?.phone
  assert.ok(phone, `Expected ${userEmail} phone for OTP login: ${me.text}`)
  const devCode = await requestDevOtp(phone)
  const verify = await api('/api/auth/otp/verify', {
    method: 'POST',
    body: JSON.stringify({ phone, code: devCode }),
  })
  assert.equal(verify.status, 200, `Expected otp verify 200, got ${verify.status}: ${verify.text}`)
}

async function loginClientSession() {
  clearCookies()
  if (!testClientPhone) {
    const suffix = Math.random().toString().slice(2, 10)
    testClientPhone = `+7999${suffix}`
  }
  await requestDevOtp(testClientPhone)
  const verify = await api('/api/auth/otp/verify', {
    method: 'POST',
    body: JSON.stringify({ phone: testClientPhone, code: '8888' }),
  })
  assert.equal(verify.status, 200, `Expected otp verify 200, got ${verify.status}: ${verify.text}`)
}

async function loginHostSession() {
  await loginSessionForUser('host@example.com')
  const mode = await api('/api/me/mode', {
    method: 'POST',
    body: JSON.stringify({ activeMode: 'STAFF' }),
  })
  assert.equal(mode.status, 200, `Expected STAFF mode switch for host user: ${mode.text}`)
}

async function resolveBookableSlotAndSeats() {
  const publicClubs = await api('/api/clubs/public')
  assert.equal(
    publicClubs.status,
    200,
    `Expected public clubs 200, got ${publicClubs.status}: ${publicClubs.text}`,
  )
  const clubCandidates = [
    ...(publicClubs.json?.featured || []),
    ...(publicClubs.json?.items || []),
  ]
  assert.ok(clubCandidates.length > 0, `Expected at least one public club: ${publicClubs.text}`)

  const dateCandidates = [1, 2, 3, 5, 7, 10, 14, 21]
  for (const candidate of clubCandidates) {
    const clubId = candidate.clubId
    if (!clubId) continue

    const mapResponse = await api(`/api/clubs/${clubId}/map`)
    if (mapResponse.status !== 200) continue
    const floors = Array.isArray(mapResponse.json?.map?.floors) ? mapResponse.json.map.floors : []
    const floorSeatGroups = floors
      .map((floor) => ({
        floorId: floor.floorId,
        seatIds: (Array.isArray(floor.elements) ? floor.elements : [])
          .filter((element) => element?.type === 'seat' && element?.seatId && !element?.isDisabled)
          .map((element) => element.seatId),
      }))
      .filter((floor) => floor.floorId && floor.seatIds.length > 0)
    if (floorSeatGroups.length === 0) continue

    const publishedSlotIds = []
    for (const offset of dateCandidates) {
      const date = dateInputAfterDays(offset)
      const slotsResponse = await api(`/api/clubs/${clubId}/slots?date=${date}`)
      if (slotsResponse.status !== 200) continue
      const slots = slotsResponse.json?.items || []
      for (const slot of slots) {
        if (slot.status !== 'PUBLISHED') continue
        if (!publishedSlotIds.includes(slot.slotId)) {
          publishedSlotIds.push(slot.slotId)
        }
      }
      if (publishedSlotIds.length >= 12) break
    }

    if (publishedSlotIds.length > 0) {
      hostClubId = clubId
      candidateSlotIds = publishedSlotIds
      candidateFloors = floorSeatGroups
      slotCursor = 0
      seatCursor = 0
      return
    }
  }

  throw new Error('Expected at least one published club with map seats and future slots.')
}

async function createClientHoldWithAnySeat() {
  const errors = []
  for (let slotAttempt = 0; slotAttempt < candidateSlotIds.length; slotAttempt += 1) {
    const slotId = candidateSlotIds[(slotCursor + slotAttempt) % candidateSlotIds.length]
    for (let floorAttempt = 0; floorAttempt < candidateFloors.length; floorAttempt += 1) {
      const floor = candidateFloors[(seatCursor + floorAttempt) % candidateFloors.length]
      const availability = await api(
        `/api/clubs/${hostClubId}/availability?slotId=${encodeURIComponent(slotId)}&floorId=${encodeURIComponent(floor.floorId)}`,
      )
      if (availability.status !== 200) {
        errors.push(`availability:${availability.status}`)
        continue
      }

      const availableSeatIds = (availability.json?.seats || [])
        .filter((seat) => seat?.status === 'AVAILABLE' && floor.seatIds.includes(seat.seatId))
        .map((seat) => seat.seatId)
      if (availableSeatIds.length < 1) {
        continue
      }

      const seatId = availableSeatIds[0]
      const hold = await api('/api/client/holds', {
        method: 'POST',
        headers: {
          'idempotency-key': nextIdempotencyKey(`hold-${slotId}-${seatId}`),
        },
        body: JSON.stringify({
          clubId: hostClubId,
          slotId,
          seatId,
        }),
      })
      if (hold.status === 201) {
        slotCursor = (slotCursor + slotAttempt + 1) % candidateSlotIds.length
        seatCursor = (seatCursor + floorAttempt + 1) % candidateFloors.length
        return { hold, seatId, slotId }
      }
      errors.push(`hold:${hold.status}:${hold.json?.code || hold.json?.error || hold.text}`)
    }
  }
  throw new Error(`Unable to create hold on any candidate seat. ${errors.join(' | ')}`)
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
        OTP_REQUEST_MAX_PER_WINDOW: '30',
        OTP_VERIFY_MAX_PER_WINDOW: '50',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  )

  devServer.stdout.on('data', (chunk) => rememberLog('[dev] ', chunk))
  devServer.stderr.on('data', (chunk) => rememberLog('[dev:err] ', chunk))
  await waitForServerReady()

  await resolveBookableSlotAndSeats()
  await loginClientSession()
})

test.after(async () => {
  if (devServer) {
    devServer.kill('SIGTERM')
    await delay(500)
  }
})

test('offline order confirm creates booking and invoice', async () => {
  const { hold } = await createClientHoldWithAnySeat()
  const createKey = nextIdempotencyKey('order-offline')
  const orderCreate = await api('/api/client/orders', {
    method: 'POST',
    headers: { 'idempotency-key': createKey },
    body: JSON.stringify({
      clubId: hostClubId,
      holdId: hold.json?.holdId,
      paymentMode: 'OFFLINE',
    }),
  })
  assert.equal(orderCreate.status, 201, `Expected order create 201, got ${orderCreate.status}: ${orderCreate.text}`)
  const orderId = orderCreate.json?.id
  assert.ok(orderId, `Expected order id: ${orderCreate.text}`)

  const confirmKey = nextIdempotencyKey('confirm-offline')
  const confirm = await api(`/api/client/orders/${orderId}/confirm_offline`, {
    method: 'POST',
    headers: { 'idempotency-key': confirmKey },
    body: JSON.stringify({}),
  })
  assert.equal(confirm.status, 200, `Expected confirm offline 200, got ${confirm.status}: ${confirm.text}`)
  assert.ok(Array.isArray(confirm.json?.bookingIds), `Expected bookingIds: ${confirm.text}`)
  assert.ok(confirm.json.bookingIds.length >= 1, `Expected at least one booking: ${confirm.text}`)
  const invoiceId = confirm.json?.invoiceId
  assert.ok(invoiceId, `Expected invoiceId: ${confirm.text}`)

  const orderDetail = await api(`/api/client/orders/${orderId}`)
  assert.equal(orderDetail.status, 200, `Expected order detail 200, got ${orderDetail.status}: ${orderDetail.text}`)
  assert.ok(orderDetail.json?.status, `Expected order status: ${orderDetail.text}`)

  const invoiceDetail = await api(`/api/client/invoices/${invoiceId}`)
  assert.equal(invoiceDetail.status, 200, `Expected invoice detail 200, got ${invoiceDetail.status}: ${invoiceDetail.text}`)
  assert.equal(invoiceDetail.json?.invoiceId, invoiceId, `Expected matching invoice id: ${invoiceDetail.text}`)
  assert.match(
    String(invoiceDetail.json?.receiptNumber || ''),
    /^INV-[A-Z0-9]+-\d{6}-\d{5}$/,
    `Expected production invoice number format: ${invoiceDetail.text}`,
  )
  const invoicePdf = await api(`/api/client/invoices/${invoiceId}/pdf`)
  assert.equal(invoicePdf.status, 200, `Expected invoice pdf 200, got ${invoicePdf.status}: ${invoicePdf.text}`)
  assert.match(invoicePdf.text, /Booking Receipt|Invoice/i)
})

test('online payment intent + webhook paid completes order', async () => {
  const { hold } = await createClientHoldWithAnySeat()
  const orderCreate = await api('/api/client/orders', {
    method: 'POST',
    headers: { 'idempotency-key': nextIdempotencyKey('order-online') },
    body: JSON.stringify({
      clubId: hostClubId,
      holdId: hold.json?.holdId,
      paymentMode: 'ONLINE',
    }),
  })
  assert.equal(orderCreate.status, 201, `Expected online order create 201, got ${orderCreate.status}: ${orderCreate.text}`)
  const orderId = orderCreate.json?.id
  assert.ok(orderId, `Expected order id: ${orderCreate.text}`)

  const init = await api('/api/client/payments/init', {
    method: 'POST',
    headers: { 'idempotency-key': nextIdempotencyKey('payment-init') },
    body: JSON.stringify({
      orderId,
      mockProviderStatus: 'PENDING',
    }),
  })
  assert.equal(init.status, 200, `Expected payment init 200, got ${init.status}: ${init.text}`)
  const intentId = init.json?.intentId
  assert.ok(intentId, `Expected intentId: ${init.text}`)

  const webhookBody = JSON.stringify({
    intentId,
    status: 'PAID',
  })
  const webhookKey = nextIdempotencyKey('webhook-paid')
  const webhook = await api('/api/payments/webhook/MOCK_PROVIDER', {
    method: 'POST',
    headers: {
      'idempotency-key': webhookKey,
      'x-webhook-signature': webhookSignature(webhookBody),
    },
    body: webhookBody,
  })
  assert.equal(webhook.status, 200, `Expected webhook paid 200, got ${webhook.status}: ${webhook.text}`)

  const webhookReplay = await api('/api/payments/webhook/MOCK_PROVIDER', {
    method: 'POST',
    headers: {
      'idempotency-key': webhookKey,
      'x-webhook-signature': webhookSignature(webhookBody),
    },
    body: webhookBody,
  })
  assert.equal(
    webhookReplay.status,
    200,
    `Expected webhook replay 200, got ${webhookReplay.status}: ${webhookReplay.text}`,
  )

  const orderDetail = await api(`/api/client/orders/${orderId}`)
  assert.equal(orderDetail.status, 200, `Expected order detail 200, got ${orderDetail.status}: ${orderDetail.text}`)
  assert.equal(orderDetail.json?.status, 'COMPLETED', `Expected COMPLETED order: ${orderDetail.text}`)

  const invoiceList = await api('/api/client/invoices?pageSize=100')
  assert.equal(invoiceList.status, 200, `Expected invoice list 200, got ${invoiceList.status}: ${invoiceList.text}`)
  const matching = (invoiceList.json?.items || []).find((item) =>
    item.booking && orderDetail.json?.bookings?.some((booking) => booking.id === item.booking.id),
  )
  assert.ok(matching, `Expected invoice item linked to completed order booking: ${invoiceList.text}`)
})

test('idempotent create order replays same response and blocks mismatched payload reuse', async () => {
  const { hold } = await createClientHoldWithAnySeat()
  const key = nextIdempotencyKey('order-idempotent')
  const createPayload = {
    clubId: hostClubId,
    holdId: hold.json?.holdId,
    paymentMode: 'OFFLINE',
  }

  const first = await api('/api/client/orders', {
    method: 'POST',
    headers: { 'idempotency-key': key },
    body: JSON.stringify(createPayload),
  })
  assert.equal(first.status, 201, `Expected first order create 201, got ${first.status}: ${first.text}`)
  const orderId = first.json?.id
  assert.ok(orderId, `Expected order id in first response: ${first.text}`)

  const second = await api('/api/client/orders', {
    method: 'POST',
    headers: { 'idempotency-key': key },
    body: JSON.stringify(createPayload),
  })
  assert.equal(second.status, 201, `Expected replayed order create 201, got ${second.status}: ${second.text}`)
  assert.equal(second.json?.id, orderId, `Expected same order id replay: ${second.text}`)

  const mismatched = await api('/api/client/orders', {
    method: 'POST',
    headers: { 'idempotency-key': key },
    body: JSON.stringify({
      ...createPayload,
      paymentMode: 'ONLINE',
    }),
  })
  assert.equal(
    mismatched.status,
    409,
    `Expected mismatched payload idempotency 409, got ${mismatched.status}: ${mismatched.text}`,
  )
  assert.equal(mismatched.json?.code, 'IDEMPOTENCY_KEY_REUSED', `Expected key reused code: ${mismatched.text}`)
})

test('order expiry sweeper expires stale orders and releases holds', async () => {
  clearCookies()
  await switchContext('host@example.com')
  const hostExpireDenied = await api('/api/orders/expire', {
    method: 'POST',
    body: JSON.stringify({}),
  })
  assert.equal(hostExpireDenied.status, 401, `Expected host without session blocked: ${hostExpireDenied.text}`)
  await loginClientSession()

  const { hold } = await createClientHoldWithAnySeat()
  const orderCreate = await api('/api/client/orders', {
    method: 'POST',
    headers: { 'idempotency-key': nextIdempotencyKey('order-expire') },
    body: JSON.stringify({
      clubId: hostClubId,
      holdId: hold.json?.holdId,
      paymentMode: 'ONLINE',
    }),
  })
  assert.equal(orderCreate.status, 201, `Expected order create 201, got ${orderCreate.status}: ${orderCreate.text}`)
  const orderId = orderCreate.json?.id
  assert.ok(orderId, `Expected order id for expiry test: ${orderCreate.text}`)

  const intent = await api('/api/client/payments/init', {
    method: 'POST',
    headers: { 'idempotency-key': nextIdempotencyKey('order-expire-intent') },
    body: JSON.stringify({
      orderId,
      expiresInMinutes: 0,
      mockProviderStatus: 'PENDING',
    }),
  })
  assert.equal(intent.status, 200, `Expected payment init 200, got ${intent.status}: ${intent.text}`)

  await loginHostSession()
  const expire = await api('/api/orders/expire', {
    method: 'POST',
    body: JSON.stringify({ limit: 100 }),
  })
  assert.equal(expire.status, 200, `Expected order expire 200, got ${expire.status}: ${expire.text}`)
  assert.ok(
    Array.isArray(expire.json?.orderIds) && expire.json.orderIds.includes(orderId),
    `Expected expired order id to be returned: ${expire.text}`,
  )

  await loginClientSession()
  const detail = await api(`/api/client/orders/${orderId}`)
  assert.equal(detail.status, 200, `Expected order detail 200, got ${detail.status}: ${detail.text}`)
  assert.equal(detail.json?.status, 'EXPIRED', `Expected order status EXPIRED: ${detail.text}`)
})

test('payment reconciliation resolves pending intents idempotently', async () => {
  const { hold } = await createClientHoldWithAnySeat()
  const orderCreate = await api('/api/client/orders', {
    method: 'POST',
    headers: { 'idempotency-key': nextIdempotencyKey('order-reconcile') },
    body: JSON.stringify({
      clubId: hostClubId,
      holdId: hold.json?.holdId,
      paymentMode: 'ONLINE',
    }),
  })
  assert.equal(orderCreate.status, 201, `Expected order create 201, got ${orderCreate.status}: ${orderCreate.text}`)
  const orderId = orderCreate.json?.id
  assert.ok(orderId, `Expected order id for reconcile test: ${orderCreate.text}`)

  const init = await api('/api/client/payments/init', {
    method: 'POST',
    headers: { 'idempotency-key': nextIdempotencyKey('payment-reconcile-init') },
    body: JSON.stringify({
      orderId,
      mockProviderStatus: 'PAID',
    }),
  })
  assert.equal(init.status, 200, `Expected payment init 200, got ${init.status}: ${init.text}`)

  await loginHostSession()
  const reconcile = await api('/api/payments/reconcile', {
    method: 'POST',
    body: JSON.stringify({
      olderThanMinutes: 0,
      limit: 100,
    }),
  })
  assert.equal(reconcile.status, 200, `Expected reconcile 200, got ${reconcile.status}: ${reconcile.text}`)
  assert.ok(
    Number(reconcile.json?.resolved || 0) >= 1,
    `Expected at least one resolved intent from reconcile: ${reconcile.text}`,
  )

  await loginClientSession()
  const orderDetail = await api(`/api/client/orders/${orderId}`)
  assert.equal(orderDetail.status, 200, `Expected order detail 200, got ${orderDetail.status}: ${orderDetail.text}`)
  assert.equal(orderDetail.json?.status, 'COMPLETED', `Expected COMPLETED order after reconcile: ${orderDetail.text}`)
})
