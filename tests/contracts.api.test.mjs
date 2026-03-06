import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import test from 'node:test'

const PORT = Number(process.env.CONTRACT_TEST_PORT || 3107)
const BASE_URL = `http://127.0.0.1:${PORT}`
const DEV_SERVER_START_TIMEOUT_MS = 120_000
const REQUEST_TIMEOUT_MS = 20_000

/** @type {import('node:child_process').ChildProcessWithoutNullStreams | null} */
let devServer = null
const serverLog = []
const cookies = new Map()

let clubId = ''
let room = null
let seatCatalog = []

function readSchema(name) {
  const file = path.join(process.cwd(), 'contracts', 'schemas', name)
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

const schemas = {
  basicError: readSchema('errors.basic.schema.json'),
  pricingQuote: readSchema('pricing.quote.response.schema.json'),
  slots: readSchema('clubs.slots.response.schema.json'),
  availability: readSchema('clubs.availability.response.schema.json'),
}

function rememberLog(prefix, chunk) {
  const line = `${prefix}${String(chunk).trim()}`
  if (!line) return
  serverLog.push(line)
  if (serverLog.length > 200) serverLog.splice(0, serverLog.length - 200)
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
    .map(([k, v]) => `${k}=${v}`)
    .join('; ')
}

async function api(urlPath, init = {}) {
  const headers = new Headers(init.headers || {})
  const cookie = cookieHeaderValue()
  if (cookie) headers.set('cookie', cookie)
  if (init.body && !headers.has('content-type')) headers.set('content-type', 'application/json')

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  let response
  try {
    response = await fetch(`${BASE_URL}${urlPath}`, { ...init, headers, signal: controller.signal })
  } finally {
    clearTimeout(timeout)
  }

  storeSetCookies(response)
  const text = await response.text()
  return { status: response.status, ok: response.ok, text, json: parseJsonSafely(text) }
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
  throw new Error(`Dev server did not start.\n${serverLog.slice(-40).join('\n')}`)
}

async function setContext(payload) {
  const response = await api('/api/context', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
  assert.equal(response.status, 200, `Expected /api/context 200, got ${response.status}: ${response.text}`)
}

async function switchContext(userEmail, selectedClubId, role) {
  await setContext({ userEmail })
  const payload = {}
  if (selectedClubId !== undefined) payload.clubId = selectedClubId
  if (role) payload.role = role
  if (Object.keys(payload).length > 0) await setContext(payload)
}

function dateInputAfterDays(days) {
  const date = new Date(Date.now() + days * 24 * 60 * 60 * 1000)
  const year = date.getUTCFullYear()
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  const day = String(date.getUTCDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function isoAfterHours(hours) {
  return new Date(Date.now() + hours * 60 * 60 * 1000).toISOString()
}

async function ensureScheduleSlots(targetClubId) {
  const templateGet = await api(`/api/clubs/${targetClubId}/schedule/template`, {
    headers: { 'X-Club-Id': targetClubId },
  })
  assert.equal(templateGet.status, 200, `schedule template get failed: ${templateGet.status} ${templateGet.text}`)

  if (!templateGet.json?.exists) {
    const template = templateGet.json?.template
    const templatePut = await api(`/api/clubs/${targetClubId}/schedule/template`, {
      method: 'PUT',
      headers: { 'X-Club-Id': targetClubId },
      body: JSON.stringify({
        slotDurationMinutes: template.slotDurationMinutes,
        bookingLeadTimeMinutes: template.bookingLeadTimeMinutes,
        maxAdvanceDays: Math.max(30, template.maxAdvanceDays || 30),
        weeklyHours: template.weeklyHours,
        effectiveFrom: null,
      }),
    })
    assert.equal(templatePut.status, 200, `schedule template put failed: ${templatePut.status} ${templatePut.text}`)
  }

  const publish = await api(`/api/clubs/${targetClubId}/schedule/publish`, {
    method: 'POST',
    headers: { 'X-Club-Id': targetClubId },
    body: JSON.stringify({ horizonDays: 30 }),
  })
  assert.equal(publish.status, 200, `schedule publish failed: ${publish.status} ${publish.text}`)
}

async function getRooms(targetClubId) {
  const response = await api('/api/rooms', { headers: { 'X-Club-Id': targetClubId } })
  assert.equal(response.status, 200, `rooms failed: ${response.status} ${response.text}`)
  const rooms = Array.isArray(response.json) ? response.json : []
  return rooms.filter((item) => item.clubId === targetClubId && item.segmentId)
}

async function getSeatCatalog(targetClubId) {
  const response = await api(`/api/clubs/${targetClubId}/seats?mapVersion=latest`, {
    headers: { 'X-Club-Id': targetClubId },
  })
  assert.equal(response.status, 200, `seats failed: ${response.status} ${response.text}`)
  return Array.isArray(response.json?.seats) ? response.json.seats : []
}

async function findPublishedSlot(targetClubId) {
  for (let dayOffset = 1; dayOffset <= 21; dayOffset += 1) {
    const response = await api(`/api/clubs/${targetClubId}/slots?date=${dateInputAfterDays(dayOffset)}`, {
      headers: { 'X-Club-Id': targetClubId },
    })
    assert.equal(response.status, 200, `slots failed: ${response.status} ${response.text}`)
    const items = Array.isArray(response.json?.items) ? response.json.items : []
    const slot = items.find((item) => item.status === 'PUBLISHED')
    if (slot) return slot
  }
  throw new Error('Unable to find a published slot.')
}

function typeMatches(value, expectedType) {
  if (expectedType === 'null') return value === null
  if (expectedType === 'array') return Array.isArray(value)
  if (expectedType === 'object') return value !== null && typeof value === 'object' && !Array.isArray(value)
  if (expectedType === 'number') return typeof value === 'number' && Number.isFinite(value)
  return typeof value === expectedType
}

function validateSchema(schema, value, pathName = '$') {
  if (schema.anyOf) {
    const matched = schema.anyOf.some((entry) => {
      try {
        validateSchema(entry, value, pathName)
        return true
      } catch {
        return false
      }
    })
    assert.ok(matched, `Value at ${pathName} does not match anyOf`)
    return
  }

  if (schema.type) {
    assert.ok(typeMatches(value, schema.type), `Expected ${pathName} to be ${schema.type}`)
  }

  if (schema.required) {
    for (const key of schema.required) {
      assert.ok(value && Object.prototype.hasOwnProperty.call(value, key), `Missing ${pathName}.${key}`)
    }
  }

  if (schema.properties && value && typeof value === 'object' && !Array.isArray(value)) {
    for (const [key, propertySchema] of Object.entries(schema.properties)) {
      if (!Object.prototype.hasOwnProperty.call(value, key)) continue
      validateSchema(propertySchema, value[key], `${pathName}.${key}`)
    }
  }

  if (schema.items && Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) {
      validateSchema(schema.items, value[i], `${pathName}[${i}]`)
    }
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

  await switchContext('tech@example.com', undefined, undefined)
  const me = await api('/api/me')
  assert.equal(me.status, 200, `me failed: ${me.status} ${me.text}`)
  clubId = me.json?.activeClubId || me.json?.defaultClubId
  assert.ok(clubId, 'Expected active club id.')

  await switchContext('tech@example.com', clubId, 'TECH_ADMIN')
  await ensureScheduleSlots(clubId)
  const rooms = await getRooms(clubId)
  room = rooms[0] || null
  assert.ok(room, 'Expected room with segmentId.')
  seatCatalog = await getSeatCatalog(clubId)
})

test.after(async () => {
  if (devServer && !devServer.killed) {
    devServer.kill('SIGTERM')
    await delay(1000)
    if (!devServer.killed) devServer.kill('SIGKILL')
  }
})

test('contract: /pricing/quote success shape', async () => {
  const response = await api('/api/pricing/quote', {
    method: 'POST',
    headers: { 'X-Club-Id': clubId },
    body: JSON.stringify({
      clubId,
      roomId: room.id,
      segmentId: room.segmentId,
      startAt: isoAfterHours(72),
      endAt: isoAfterHours(74),
      channel: 'ONLINE',
      customerType: 'GUEST',
    }),
  })
  assert.equal(response.status, 200, `quote failed: ${response.status} ${response.text}`)
  validateSchema(schemas.pricingQuote, response.json)
})

test('contract: /pricing/quote promo rejection payload shape', async () => {
  const response = await api('/api/pricing/quote', {
    method: 'POST',
    headers: { 'X-Club-Id': clubId },
    body: JSON.stringify({
      clubId,
      roomId: room.id,
      segmentId: room.segmentId,
      startAt: isoAfterHours(96),
      endAt: isoAfterHours(98),
      promoCode: 'INVALID-CONTRACT-CODE',
    }),
  })
  assert.equal(response.status, 200, `quote failed: ${response.status} ${response.text}`)
  validateSchema(schemas.pricingQuote, response.json)
  assert.equal(response.json?.promotion?.status, 'REJECTED')
  assert.equal(response.json?.promotion?.rejectionReason, 'INVALID_CODE')
})

test('contract: /clubs/{clubId}/slots shape', async () => {
  const response = await api(`/api/clubs/${clubId}/slots?date=${dateInputAfterDays(1)}`, {
    headers: { 'X-Club-Id': clubId },
  })
  assert.equal(response.status, 200, `slots failed: ${response.status} ${response.text}`)
  validateSchema(schemas.slots, response.json)
})

test('contract: /clubs/{clubId}/availability shape', async () => {
  const slot = await findPublishedSlot(clubId)
  const seatWithFloor = seatCatalog.find((item) => item.floorId && !item.isDisabled)
  assert.ok(seatWithFloor, 'Expected at least one enabled seat with floorId.')
  const response = await api(
    `/api/clubs/${clubId}/availability?slotId=${encodeURIComponent(slot.slotId)}&floorId=${encodeURIComponent(seatWithFloor.floorId)}`,
    { headers: { 'X-Club-Id': clubId } },
  )
  assert.equal(response.status, 200, `availability failed: ${response.status} ${response.text}`)
  validateSchema(schemas.availability, response.json)
})

test('contract: error payload shapes remain stable', async () => {
  const holdInvalid = await api(`/api/clubs/${clubId}/holds`, {
    method: 'POST',
    headers: { 'X-Club-Id': clubId },
    body: JSON.stringify({}),
  })
  assert.equal(holdInvalid.status, 400)
  validateSchema(schemas.basicError, holdInvalid.json)

  const bookingInvalid = await api('/api/bookings', {
    method: 'POST',
    headers: { 'X-Club-Id': clubId },
    body: JSON.stringify({ roomId: null }),
  })
  assert.equal(bookingInvalid.status, 400)
  validateSchema(schemas.basicError, bookingInvalid.json)
})

