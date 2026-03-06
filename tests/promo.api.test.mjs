import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'
import test from 'node:test'

const PORT = Number(process.env.PROMO_TEST_PORT || 3106)
const BASE_URL = `http://127.0.0.1:${PORT}`
const DEV_SERVER_START_TIMEOUT_MS = 120_000
const REQUEST_TIMEOUT_MS = 20_000

/** @type {import('node:child_process').ChildProcessWithoutNullStreams | null} */
let devServer = null
const serverLog = []
const cookies = new Map()

let techClubId = ''
let roomIds = []
let createdPromoIds = []

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
    if (!value) cookies.delete(key)
    else cookies.set(key, value)
  }
}

function cookieHeaderValue() {
  return Array.from(cookies.entries())
    .map(([key, value]) => `${key}=${value}`)
    .join('; ')
}

async function api(path, init = {}) {
  const headers = new Headers(init.headers || {})
  const cookie = cookieHeaderValue()
  if (cookie) headers.set('cookie', cookie)
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
      // retry
    }
    await delay(500)
  }
  throw new Error(`Dev server did not start.\n${serverLog.slice(-50).join('\n')}`)
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

function dateInputAfterDays(days) {
  const date = new Date(Date.now() + days * 24 * 60 * 60 * 1000)
  const year = date.getUTCFullYear()
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  const day = String(date.getUTCDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

async function getRooms(clubId) {
  const response = await api('/api/rooms', {
    headers: { 'X-Club-Id': clubId },
  })
  assert.equal(response.status, 200, `rooms failed: ${response.status} ${response.text}`)
  const rooms = Array.isArray(response.json) ? response.json : []
  return rooms.filter(
    (room) =>
      Number.isInteger(room.id) &&
      room.clubId === clubId &&
      typeof room.segmentId === 'string' &&
      room.segmentId.length > 0,
  )
}

function isoAfterHours(hours) {
  return new Date(Date.now() + hours * 60 * 60 * 1000).toISOString()
}

async function findBookableRoom(clubId) {
  if (!roomIds.length) {
    const rooms = await getRooms(clubId)
    roomIds = rooms.map((room) => room.id)
  }
  const roomId = roomIds.find((value) => Number.isInteger(value) && value > 0)
  if (!roomId) throw new Error('No bookable room found.')
  return roomId
}

async function createPromo(clubId, body) {
  const response = await api(`/api/clubs/${clubId}/promos`, {
    method: 'POST',
    headers: { 'X-Club-Id': clubId },
    body: JSON.stringify(body),
  })
  assert.equal(response.status, 201, `promo create failed: ${response.status} ${response.text}`)
  createdPromoIds.push(response.json.id)
  return response.json
}

async function getPromoStats(clubId, promoId) {
  const response = await api(`/api/clubs/${clubId}/promos/${promoId}/stats`, {
    headers: { 'X-Club-Id': clubId },
  })
  assert.equal(response.status, 200, `promo stats failed: ${response.status} ${response.text}`)
  return response.json
}

async function quoteWithPromo(clubId, roomId, promoCode, startOffsetHours = 72) {
  return api('/api/pricing/quote', {
    method: 'POST',
    headers: { 'X-Club-Id': clubId },
    body: JSON.stringify({
      clubId,
      roomId,
      startAt: isoAfterHours(startOffsetHours),
      endAt: isoAfterHours(startOffsetHours + 2),
      channel: 'ONLINE',
      customerType: 'GUEST',
      promoCode,
    }),
  })
}

async function createBookingWithPromo(clubId, roomId, promoCode, suffix = '', startOffsetHours = 96) {
  const candidates = Array.isArray(startOffsetHours)
    ? startOffsetHours
    : [startOffsetHours, startOffsetHours + 12, startOffsetHours + 24, startOffsetHours + 36]
  let lastResponse = null
  for (const offset of candidates) {
    const unique = `${Date.now()}${Math.floor(Math.random() * 1000)}`
    const response = await api('/api/bookings', {
      method: 'POST',
      headers: { 'X-Club-Id': clubId },
      body: JSON.stringify({
        roomId,
        guestName: `Promo Test${suffix}`,
        guestEmail: `promo${unique}${suffix}@example.com`,
        guestPhone: `+7701${String(unique).slice(-7)}`,
        guests: 1,
        promoCode,
        checkIn: isoAfterHours(offset),
        checkOut: isoAfterHours(offset + 2),
      }),
    })
    lastResponse = response
    const message = String(response.json?.error || '')
    if (response.status === 409 && message.includes('already booked')) {
      continue
    }
    return response
  }
  return lastResponse
}

function promoWindowBody(overrides = {}) {
  const now = Date.now()
  return {
    activeFromUtc: new Date(now - 60 * 60 * 1000).toISOString(),
    activeToUtc: new Date(now + 7 * 24 * 60 * 60 * 1000).toISOString(),
    ...overrides,
  }
}

test.before(async () => {
  devServer = spawn('./node_modules/.bin/next', ['dev', '--hostname', '127.0.0.1', '--port', String(PORT)], {
    cwd: process.cwd(),
    env: { ...process.env, NODE_ENV: 'development' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  devServer.stdout.on('data', (chunk) => rememberLog('[next:stdout] ', chunk))
  devServer.stderr.on('data', (chunk) => rememberLog('[next:stderr] ', chunk))

  await waitForServerReady()
  await switchContext('tech@example.com', null, null)
  const me = await api('/api/me')
  assert.equal(me.status, 200, `me failed: ${me.status} ${me.text}`)
  techClubId = me.json?.activeClubId || me.json?.defaultClubId
  assert.ok(techClubId, 'Expected active club id for tech user')
  await switchContext('tech@example.com', techClubId, 'TECH_ADMIN')
  roomIds = (await getRooms(techClubId)).map((room) => room.id)
  assert.ok(roomIds.length > 0, 'Expected at least one room in seeded club')
})

test.after(async () => {
  if (devServer && !devServer.killed) {
    devServer.kill('SIGTERM')
    await delay(1000)
    if (!devServer.killed) devServer.kill('SIGKILL')
  }
})

test('client cannot access promo admin endpoints; tech can list promos', async () => {
  await switchContext('client@example.com', techClubId, 'CLIENT')
  const forbidden = await api(`/api/clubs/${techClubId}/promos`, {
    headers: { 'X-Club-Id': techClubId },
  })
  assert.equal(forbidden.status, 403, `expected 403, got ${forbidden.status}: ${forbidden.text}`)

  await switchContext('tech@example.com', techClubId, 'TECH_ADMIN')
  const ok = await api(`/api/clubs/${techClubId}/promos`, {
    headers: { 'X-Club-Id': techClubId },
  })
  assert.equal(ok.status, 200, `expected 200, got ${ok.status}: ${ok.text}`)
  assert.ok(Array.isArray(ok.json?.items), 'Expected items array')
})

test('quote returns promo rejection details for invalid and ineligible promo codes', async () => {
  await switchContext('tech@example.com', techClubId, 'TECH_ADMIN')
  const roomId = await findBookableRoom(techClubId)

  const invalid = await quoteWithPromo(techClubId, roomId, 'NO_SUCH_PROMO')
  assert.equal(invalid.status, 200, `invalid promo quote should still return 200: ${invalid.status} ${invalid.text}`)
  assert.equal(invalid.json?.promotion?.status, 'REJECTED')
  assert.equal(invalid.json?.promotion?.rejectionReason, 'INVALID_CODE')

  const ineligibleCode = `SEGX${Date.now().toString().slice(-6)}`
  await createPromo(techClubId, promoWindowBody({
    code: ineligibleCode,
    name: 'Segment gate',
    discountType: 'FIXED_OFF',
    isAutomatic: false,
    value: 300,
    constraints: { segmentIds: ['segment_nonexistent_for_test'] },
  }))

  const ineligible = await quoteWithPromo(techClubId, roomId, ineligibleCode)
  assert.equal(ineligible.status, 200, `ineligible promo quote should return 200: ${ineligible.status} ${ineligible.text}`)
  assert.equal(ineligible.json?.promotion?.status, 'REJECTED')
  assert.equal(ineligible.json?.promotion?.rejectionReason, 'NOT_ELIGIBLE_SEGMENT')
})

test('quote applies promo but does not consume usage until booking confirmation', async () => {
  await switchContext('tech@example.com', techClubId, 'TECH_ADMIN')
  const code = `QONLY${Date.now().toString().slice(-6)}`
  const promo = await createPromo(techClubId, promoWindowBody({
    code,
    name: 'Quote no consume',
    discountType: 'FIXED_OFF',
    isAutomatic: false,
    value: 500,
    constraints: { minSubtotal: 1000 },
    usage: { maxTotalUses: 10 },
  }))

  let stats = await getPromoStats(techClubId, promo.id)
  assert.equal(stats.uses, 0)
  assert.equal(stats.totalDiscount, 0)

  await switchContext('client@example.com', techClubId, 'CLIENT')
  const roomId = await findBookableRoom(techClubId)
  const quote = await quoteWithPromo(techClubId, roomId, code)
  assert.equal(quote.status, 200, `quote failed: ${quote.status} ${quote.text}`)
  assert.equal(quote.json?.promotion?.status, 'APPLIED')
  assert.equal(quote.json?.promotion?.code, code)
  assert.ok(Number(quote.json?.promotion?.discountAmount) > 0, 'Expected positive discount amount')

  await switchContext('tech@example.com', techClubId, 'TECH_ADMIN')
  stats = await getPromoStats(techClubId, promo.id)
  assert.equal(stats.uses, 0, 'Quote should not create redemption')
  assert.equal(stats.totalDiscount, 0, 'Quote should not accumulate discount stats')
})

test('booking confirmation consumes promo once and records stats', async () => {
  await switchContext('tech@example.com', techClubId, 'TECH_ADMIN')
  const code = `BOOK${Date.now().toString().slice(-6)}`
  const promo = await createPromo(techClubId, promoWindowBody({
    code,
    name: 'Booking consume',
    discountType: 'FIXED_OFF',
    isAutomatic: false,
    value: 400,
    usage: { maxTotalUses: 5 },
  }))

  await switchContext('client@example.com', techClubId, 'CLIENT')
  const roomId = await findBookableRoom(techClubId)
  const created = await createBookingWithPromo(techClubId, roomId, code, '-consume', [120, 132, 144, 156, 168])
  assert.equal(created.status, 201, `booking create failed: ${created.status} ${created.text}`)

  await switchContext('tech@example.com', techClubId, 'TECH_ADMIN')
  const stats = await getPromoStats(techClubId, promo.id)
  assert.equal(stats.uses, 1)
  assert.ok(stats.totalDiscount > 0, 'Expected aggregated discount > 0 after redemption')
})

test('maxTotalUses is enforced at booking confirmation', async () => {
  await switchContext('tech@example.com', techClubId, 'TECH_ADMIN')
  const code = `LIMIT${Date.now().toString().slice(-5)}`
  const promo = await createPromo(techClubId, promoWindowBody({
    code,
    name: 'One-shot promo',
    discountType: 'FIXED_OFF',
    isAutomatic: false,
    value: 250,
    usage: { maxTotalUses: 1 },
  }))
  assert.ok(promo.id)

  await switchContext('client@example.com', techClubId, 'CLIENT')
  const roomId = await findBookableRoom(techClubId)
  const firstBooking = await createBookingWithPromo(techClubId, roomId, code, '-1', [180, 192, 204, 216])
  assert.equal(firstBooking.status, 201, `first booking failed: ${firstBooking.status} ${firstBooking.text}`)

  const secondBooking = await createBookingWithPromo(techClubId, roomId, code, '-2', [228, 240, 252, 264])
  assert.equal(secondBooking.status, 409, `second booking should be blocked: ${secondBooking.status} ${secondBooking.text}`)
  assert.equal(secondBooking.json?.code, 'PROMO_USAGE_LIMIT_REACHED')

  await switchContext('tech@example.com', techClubId, 'TECH_ADMIN')
  const stats = await getPromoStats(techClubId, promo.id)
  assert.equal(stats.uses, 1, 'Only one redemption should be recorded')
})
