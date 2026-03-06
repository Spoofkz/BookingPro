import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'
import test from 'node:test'

const PORT = Number(process.env.RESCHEDULE_TEST_PORT || 3102)
const BASE_URL = `http://127.0.0.1:${PORT}`
const DEV_SERVER_START_TIMEOUT_MS = 120_000
const REQUEST_TIMEOUT_MS = 20_000

/** @type {import('node:child_process').ChildProcessWithoutNullStreams | null} */
let devServer = null
const serverLog = []
const cookies = new Map()

let hostClubId = ''
let secondaryClubId = ''

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
      // continue until booted
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
  assert.equal(
    response.status,
    200,
    `Expected /api/context 200, got ${response.status}: ${response.text}`,
  )
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

async function findUpcomingSlots(clubId, minimumCount = 2) {
  const collected = []
  const seen = new Set()
  for (let dayOffset = 1; dayOffset <= 14; dayOffset += 1) {
    const date = dateInputAfterDays(dayOffset)
    const response = await api(`/api/clubs/${clubId}/slots?date=${date}`, {
      headers: { 'X-Club-Id': clubId },
    })
    assert.equal(response.status, 200, `slots failed: ${response.status} ${response.text}`)
    const items = Array.isArray(response.json?.items) ? response.json.items : []
    for (const slot of items) {
      if (slot.status !== 'PUBLISHED') continue
      if (seen.has(slot.slotId)) continue
      seen.add(slot.slotId)
      collected.push(slot)
      if (collected.length >= minimumCount) return collected
    }
  }
  throw new Error(`Unable to find ${minimumCount} published slots.`)
}

async function ensureScheduleSlots(clubId) {
  const templateGet = await api(`/api/clubs/${clubId}/schedule/template`, {
    headers: { 'X-Club-Id': clubId },
  })
  assert.equal(
    templateGet.status,
    200,
    `schedule template get failed: ${templateGet.status} ${templateGet.text}`,
  )

  if (!templateGet.json?.exists) {
    const template = templateGet.json?.template
    const templatePut = await api(`/api/clubs/${clubId}/schedule/template`, {
      method: 'PUT',
      headers: { 'X-Club-Id': clubId },
      body: JSON.stringify({
        slotDurationMinutes: template.slotDurationMinutes,
        bookingLeadTimeMinutes: template.bookingLeadTimeMinutes,
        maxAdvanceDays: Math.max(30, template.maxAdvanceDays || 30),
        weeklyHours: template.weeklyHours,
        effectiveFrom: null,
      }),
    })
    assert.equal(
      templatePut.status,
      200,
      `schedule template put failed: ${templatePut.status} ${templatePut.text}`,
    )
  }

  const publish = await api(`/api/clubs/${clubId}/schedule/publish`, {
    method: 'POST',
    headers: { 'X-Club-Id': clubId },
    body: JSON.stringify({ horizonDays: 30 }),
  })
  assert.equal(
    publish.status,
    200,
    `schedule publish failed: ${publish.status} ${publish.text}`,
  )
}

async function getSegmentMap(clubId) {
  const response = await api(`/api/clubs/${clubId}/segments`, {
    headers: { 'X-Club-Id': clubId },
  })
  assert.equal(response.status, 200, `segments failed: ${response.status} ${response.text}`)
  const map = new Map()
  for (const segment of response.json || []) {
    map.set(segment.id, segment.name)
  }
  return map
}

async function getSeatCatalog(clubId) {
  const response = await api(`/api/clubs/${clubId}/seats?mapVersion=latest`, {
    headers: { 'X-Club-Id': clubId },
  })
  assert.equal(response.status, 200, `seats failed: ${response.status} ${response.text}`)
  return Array.isArray(response.json?.seats) ? response.json.seats : []
}

async function pickAvailableSeat(params) {
  const {
    clubId,
    slotId,
    preferredSegmentName,
    excludeSeatIds = [],
    requireRoomId = false,
  } = params
  const segmentMap = preferredSegmentName ? await getSegmentMap(clubId) : null
  const seats = await getSeatCatalog(clubId)
  const excluded = new Set(excludeSeatIds)

  const candidateSeats = seats.filter((seat) => {
    if (excluded.has(seat.seatId)) return false
    if (seat.isDisabled) return false
    if (requireRoomId) {
      const roomId = Number(seat.roomId)
      if (!Number.isInteger(roomId) || roomId < 1) return false
    }
    if (!preferredSegmentName) return true
    return segmentMap?.get(seat.segmentId) === preferredSegmentName
  })
  assert.ok(candidateSeats.length > 0, `No candidate seats found for segment ${preferredSegmentName || 'ANY'}.`)

  const byFloor = new Map()
  for (const seat of candidateSeats) {
    if (!byFloor.has(seat.floorId)) byFloor.set(seat.floorId, [])
    byFloor.get(seat.floorId).push(seat)
  }

  for (const [floorId, floorSeats] of byFloor.entries()) {
    const response = await api(
      `/api/clubs/${clubId}/availability?slotId=${encodeURIComponent(slotId)}&floorId=${encodeURIComponent(floorId)}`,
      {
        headers: { 'X-Club-Id': clubId },
      },
    )
    assert.equal(
      response.status,
      200,
      `availability failed for floor ${floorId}: ${response.status} ${response.text}`,
    )
    const seatStatus = new Map()
    for (const item of response.json?.seats || []) {
      seatStatus.set(item.seatId, item.status)
    }
    const available = floorSeats.find((seat) => seatStatus.get(seat.seatId) === 'AVAILABLE')
    if (available) return available
  }

  throw new Error(`No AVAILABLE seat found for slot ${slotId}.`)
}

async function createBookingFromHold(params) {
  const { clubId, slotId, seatId, guestName, guestEmail } = params
  const hold = await api(`/api/clubs/${clubId}/holds`, {
    method: 'POST',
    headers: { 'X-Club-Id': clubId },
    body: JSON.stringify({ slotId, seatId }),
  })
  assert.equal(hold.status, 201, `create hold failed: ${hold.status} ${hold.text}`)

  const confirm = await api(`/api/clubs/${clubId}/holds/${hold.json.holdId}/confirm`, {
    method: 'POST',
    headers: { 'X-Club-Id': clubId },
    body: JSON.stringify({
      guestName,
      guestEmail,
      paymentMode: 'OFFLINE',
    }),
  })
  assert.equal(confirm.status, 201, `confirm hold failed: ${confirm.status} ${confirm.text}`)
  return {
    bookingId: confirm.json.bookingId,
    slotId: confirm.json.slotId,
    seatId: confirm.json.seatId,
  }
}

async function findSlotWithAvailableSeat(clubId, slots, excludeSlotIds = []) {
  const excluded = new Set(excludeSlotIds)
  const seen = new Set()

  async function trySlots(candidateSlots) {
    for (const slot of candidateSlots) {
      if (!slot?.slotId) continue
      if (excluded.has(slot.slotId) || seen.has(slot.slotId)) continue
      seen.add(slot.slotId)
      try {
        const seat = await pickAvailableSeat({ clubId, slotId: slot.slotId })
        return { slot, seat }
      } catch {
        // try next slot
      }
    }
    return null
  }

  const fromSeededList = await trySlots(slots)
  if (fromSeededList) return fromSeededList

  for (let dayOffset = 1; dayOffset <= 30; dayOffset += 1) {
    const date = dateInputAfterDays(dayOffset)
    const response = await api(`/api/clubs/${clubId}/slots?date=${date}`, {
      headers: { 'X-Club-Id': clubId },
    })
    assert.equal(response.status, 200, `slots failed: ${response.status} ${response.text}`)
    const items = Array.isArray(response.json?.items) ? response.json.items : []
    const published = items.filter((item) => item.status === 'PUBLISHED')
    const found = await trySlots(published)
    if (found) return found
  }

  throw new Error('Unable to find slot with available seat.')
}

async function findDistinctSlotsWithAvailableSeats(clubId, count) {
  const picked = []
  const excluded = new Set()
  for (let i = 0; i < count; i += 1) {
    const next = await findSlotWithAvailableSeat(clubId, [], Array.from(excluded))
    picked.push(next)
    excluded.add(next.slot.slotId)
  }
  return picked
}

async function setReschedulePolicy(clubId, policy) {
  const update = await api(`/api/clubs/${clubId}`, {
    method: 'PUT',
    headers: { 'X-Club-Id': clubId },
    body: JSON.stringify({
      reschedulePolicy: policy,
    }),
  })
  assert.equal(update.status, 200, `policy update failed: ${update.status} ${update.text}`)
  return update.json
}

test.before(async () => {
  devServer = spawn('./node_modules/.bin/next', ['dev', '--hostname', '127.0.0.1', '--port', String(PORT)], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      NODE_ENV: 'development',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  devServer.stdout.on('data', (chunk) => rememberLog('[next:stdout] ', chunk))
  devServer.stderr.on('data', (chunk) => rememberLog('[next:stderr] ', chunk))
  await waitForServerReady()

  await switchContext('host@example.com', null, null)
  const me = await api('/api/me')
  assert.equal(me.status, 200, `Expected /api/me 200, got ${me.status}: ${me.text}`)
  hostClubId = me.json?.activeClubId
  assert.ok(hostClubId, 'Expected host active club id.')
  await switchContext('host@example.com', hostClubId, 'HOST_ADMIN')

  await switchContext('azamat@example.com', null, null)
  const azamatMe = await api('/api/me')
  assert.equal(azamatMe.status, 200, `Expected /api/me 200, got ${azamatMe.status}: ${azamatMe.text}`)
  const clubs = azamatMe.json?.clubs || []
  const second = clubs.find((club) => club.id !== hostClubId)
  assert.ok(second, 'Expected azamat to have a second club.')
  secondaryClubId = second.id

  await switchContext('tech@example.com', hostClubId, 'TECH_ADMIN')
  await ensureScheduleSlots(hostClubId)

  await switchContext('host@example.com', hostClubId, 'HOST_ADMIN')
})

test.after(async () => {
  if (!devServer || devServer.killed) return
  const proc = devServer
  proc.kill('SIGTERM')
  await Promise.race([
    new Promise((resolve) => proc.once('exit', resolve)),
    delay(5000),
  ])
  if (!proc.killed) {
    proc.kill('SIGKILL')
  }
})

test('staff intent locks target and confirm reschedules booking', async () => {
  await switchContext('tech@example.com', hostClubId, 'TECH_ADMIN')
  await setReschedulePolicy(hostClubId, {
    rescheduleEnabled: true,
    rescheduleCutoffMinutesBeforeStart: 60,
    maxReschedulesPerBooking: 3,
    allowRescheduleAfterStart: false,
    rescheduleHoldTtlMinutes: 10,
    priceDeltaHandling: { client: 'NON_NEGATIVE_ONLY' },
  })

  await switchContext('host@example.com', hostClubId, 'HOST_ADMIN')
  const [current, target] = await findDistinctSlotsWithAvailableSeats(hostClubId, 2)

  const booking = await createBookingFromHold({
    clubId: hostClubId,
    slotId: current.slot.slotId,
    seatId: current.seat.seatId,
    guestName: 'Host Reschedule',
    guestEmail: 'host@example.com',
  })

  const intent = await api(`/api/bookings/${booking.bookingId}/reschedule/intents`, {
    method: 'POST',
    headers: { 'X-Club-Id': hostClubId, 'Idempotency-Key': `intent-client-${Date.now()}` },
    body: JSON.stringify({
      newSlotId: target.slot.slotId,
    }),
  })
  assert.equal(intent.status, 201, `intent create failed: ${intent.status} ${intent.text}`)
  assert.ok(intent.json?.rescheduleId, `Expected rescheduleId: ${intent.text}`)

  const targetSeatAvailability = await api(
    `/api/clubs/${hostClubId}/availability/seat?slotId=${encodeURIComponent(target.slot.slotId)}&seatId=${encodeURIComponent(current.seat.seatId)}`,
    {
      headers: { 'X-Club-Id': hostClubId },
    },
  )
  assert.equal(
    targetSeatAvailability.status,
    200,
    `availability seat failed: ${targetSeatAvailability.status} ${targetSeatAvailability.text}`,
  )
  assert.equal(targetSeatAvailability.json?.seat?.status, 'HELD')

  const payMode = intent.json?.requiredAction === 'PAY_EXTRA' ? 'OFFLINE' : 'NONE'
  const confirm = await api(`/api/reschedules/${intent.json.rescheduleId}/confirm`, {
    method: 'POST',
    headers: { 'X-Club-Id': hostClubId, 'Idempotency-Key': `confirm-client-${Date.now()}` },
    body: JSON.stringify({ payMode }),
  })
  assert.equal(confirm.status, 200, `confirm failed: ${confirm.status} ${confirm.text}`)
  assert.equal(confirm.json?.bookingId, booking.bookingId)
  assert.equal(confirm.json?.slotId, target.slot.slotId)
  assert.equal(confirm.json?.seatId, current.seat.seatId)

  const oldSeatAvailability = await api(
    `/api/clubs/${hostClubId}/availability/seat?slotId=${encodeURIComponent(current.slot.slotId)}&seatId=${encodeURIComponent(current.seat.seatId)}`,
    {
      headers: { 'X-Club-Id': hostClubId },
    },
  )
  assert.equal(oldSeatAvailability.status, 200, `old seat availability failed: ${oldSeatAvailability.status} ${oldSeatAvailability.text}`)
  assert.equal(oldSeatAvailability.json?.seat?.status, 'AVAILABLE')
})

test('staff policy block without override; override requires reason and succeeds', async () => {
  await switchContext('tech@example.com', hostClubId, 'TECH_ADMIN')
  await setReschedulePolicy(hostClubId, {
    rescheduleEnabled: true,
    rescheduleCutoffMinutesBeforeStart: 100_000,
    maxReschedulesPerBooking: 2,
    allowRescheduleAfterStart: false,
    rescheduleHoldTtlMinutes: 10,
    priceDeltaHandling: { client: 'NON_NEGATIVE_ONLY' },
  })

  await switchContext('host@example.com', hostClubId, 'HOST_ADMIN')
  const slots = await findUpcomingSlots(hostClubId, 10)
  const current = await findSlotWithAvailableSeat(hostClubId, slots)

  const booking = await createBookingFromHold({
    clubId: hostClubId,
    slotId: current.slot.slotId,
    seatId: current.seat.seatId,
    guestName: 'Policy Host',
    guestEmail: 'host@example.com',
  })

  const blockedHostWithoutOverride = await api(`/api/bookings/${booking.bookingId}/reschedule/intents`, {
    method: 'POST',
    headers: { 'X-Club-Id': hostClubId },
    body: JSON.stringify({
      newSlotId: (await findSlotWithAvailableSeat(hostClubId, slots, [current.slot.slotId])).slot.slotId,
    }),
  })
  assert.equal(
    blockedHostWithoutOverride.status,
    409,
    `Expected host policy block without override: ${blockedHostWithoutOverride.status} ${blockedHostWithoutOverride.text}`,
  )

  const missingReasonTarget = await findSlotWithAvailableSeat(hostClubId, slots, [current.slot.slotId])
  const missingReason = await api(`/api/bookings/${booking.bookingId}/reschedule/intents`, {
    method: 'POST',
    headers: { 'X-Club-Id': hostClubId },
    body: JSON.stringify({
      newSlotId: missingReasonTarget.slot.slotId,
      newSeatId: missingReasonTarget.seat.seatId,
      overridePolicy: true,
    }),
  })
  assert.equal(missingReason.status, 400, `Expected reason-required 400, got ${missingReason.status}: ${missingReason.text}`)
  assert.equal(missingReason.json?.code, 'VALIDATION_ERROR')

  const overrideTarget = await findSlotWithAvailableSeat(hostClubId, slots, [current.slot.slotId])
  const overridden = await api(`/api/bookings/${booking.bookingId}/reschedule/intents`, {
    method: 'POST',
    headers: { 'X-Club-Id': hostClubId },
    body: JSON.stringify({
      newSlotId: overrideTarget.slot.slotId,
      newSeatId: overrideTarget.seat.seatId,
      overridePolicy: true,
      reason: 'Host override for testing',
    }),
  })
  assert.equal(overridden.status, 201, `Expected override success: ${overridden.status} ${overridden.text}`)
  assert.equal(overridden.json?.policyOverrideUsed, true)

  const canceled = await api(`/api/reschedules/${overridden.json.rescheduleId}/cancel`, {
    method: 'POST',
    headers: { 'X-Club-Id': hostClubId },
  })
  assert.equal(canceled.status, 200, `cancel failed: ${canceled.status} ${canceled.text}`)

  await switchContext('tech@example.com', hostClubId, 'TECH_ADMIN')
  await setReschedulePolicy(hostClubId, {
    rescheduleEnabled: true,
    rescheduleCutoffMinutesBeforeStart: 60,
    maxReschedulesPerBooking: 3,
    allowRescheduleAfterStart: false,
    rescheduleHoldTtlMinutes: 10,
    priceDeltaHandling: { client: 'NON_NEGATIVE_ONLY' },
  })
})

test('concurrency: only one intent can lock the same target seat-slot', async () => {
  await switchContext('tech@example.com', hostClubId, 'TECH_ADMIN')
  await setReschedulePolicy(hostClubId, {
    rescheduleEnabled: true,
    rescheduleCutoffMinutesBeforeStart: 60,
    maxReschedulesPerBooking: 3,
    allowRescheduleAfterStart: false,
    rescheduleHoldTtlMinutes: 10,
    priceDeltaHandling: { client: 'NON_NEGATIVE_ONLY' },
  })

  await switchContext('host@example.com', hostClubId, 'HOST_ADMIN')
  const slots = await findUpcomingSlots(hostClubId, 12)
  const firstSource = await findSlotWithAvailableSeat(hostClubId, slots)
  const secondSource = await findSlotWithAvailableSeat(hostClubId, slots, [firstSource.slot.slotId])
  const target = await findSlotWithAvailableSeat(hostClubId, slots, [
    firstSource.slot.slotId,
    secondSource.slot.slotId,
  ])

  const bookingA = await createBookingFromHold({
    clubId: hostClubId,
    slotId: firstSource.slot.slotId,
    seatId: firstSource.seat.seatId,
    guestName: 'Concurrency A',
    guestEmail: 'host@example.com',
  })

  const bookingB = await createBookingFromHold({
    clubId: hostClubId,
    slotId: secondSource.slot.slotId,
    seatId: secondSource.seat.seatId,
    guestName: 'Concurrency B',
    guestEmail: 'host@example.com',
  })

  const first = await api(`/api/bookings/${bookingA.bookingId}/reschedule/intents`, {
    method: 'POST',
    headers: { 'X-Club-Id': hostClubId },
    body: JSON.stringify({
      newSlotId: target.slot.slotId,
      newSeatId: target.seat.seatId,
    }),
  })
  assert.equal(first.status, 201, `First intent failed: ${first.status} ${first.text}`)

  const second = await api(`/api/bookings/${bookingB.bookingId}/reschedule/intents`, {
    method: 'POST',
    headers: { 'X-Club-Id': hostClubId },
    body: JSON.stringify({
      newSlotId: target.slot.slotId,
      newSeatId: target.seat.seatId,
    }),
  })
  assert.equal(second.status, 409, `Second intent should conflict: ${second.status} ${second.text}`)
  assert.equal(second.json?.code, 'TARGET_NOT_AVAILABLE')

  await api(`/api/reschedules/${first.json.rescheduleId}/cancel`, {
    method: 'POST',
    headers: { 'X-Club-Id': hostClubId },
  })
})

test('tenancy: staff in another club cannot reschedule booking outside scope', async () => {
  await switchContext('azamat@example.com', hostClubId, 'TECH_ADMIN')
  const slots = await findUpcomingSlots(hostClubId, 14)
  const current = await findSlotWithAvailableSeat(hostClubId, slots)
  const target = await findSlotWithAvailableSeat(hostClubId, slots, [current.slot.slotId])
  const booking = await createBookingFromHold({
    clubId: hostClubId,
    slotId: current.slot.slotId,
    seatId: current.seat.seatId,
    guestName: 'Tenancy Booking',
    guestEmail: 'azamat@example.com',
  })

  await switchContext('azamat@example.com', secondaryClubId, 'TECH_ADMIN')
  const crossClub = await api(`/api/bookings/${booking.bookingId}/reschedule/intents`, {
    method: 'POST',
    headers: { 'X-Club-Id': secondaryClubId },
    body: JSON.stringify({ newSlotId: target.slot.slotId }),
  })
  assert.equal(crossClub.status, 404, `Expected 404 for cross-club access: ${crossClub.status} ${crossClub.text}`)
})
