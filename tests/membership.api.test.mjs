import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'
import test from 'node:test'

const PORT = Number(process.env.MEMBERSHIP_TEST_PORT || 3103)
const BASE_URL = `http://127.0.0.1:${PORT}`
const DEV_SERVER_START_TIMEOUT_MS = 120_000
const REQUEST_TIMEOUT_MS = 20_000

/** @type {import('node:child_process').ChildProcessWithoutNullStreams | null} */
let devServer = null
const serverLog = []
const cookies = new Map()

let hostClubId = ''
let secondaryClubId = ''
let createdPlanId = ''
let purchasedEntitlementId = ''
let consumedBookingId = null

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

async function ensureScheduleSlots(clubId) {
  const templateGet = await api(`/api/clubs/${clubId}/schedule/template`, {
    headers: { 'X-Club-Id': clubId },
  })
  assert.equal(templateGet.status, 200, `schedule template get failed: ${templateGet.status} ${templateGet.text}`)

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
    assert.equal(templatePut.status, 200, `schedule template put failed: ${templatePut.status} ${templatePut.text}`)
  }

  const publish = await api(`/api/clubs/${clubId}/schedule/publish`, {
    method: 'POST',
    headers: { 'X-Club-Id': clubId },
    body: JSON.stringify({ horizonDays: 30 }),
  })
  assert.equal(publish.status, 200, `schedule publish failed: ${publish.status} ${publish.text}`)
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

async function findFirstSlotWithAvailableSeat(clubId, options = {}) {
  const excludedSlotIds = new Set(options.excludedSlotIds || [])
  for (let dayOffset = 1; dayOffset <= 21; dayOffset += 1) {
    const date = dateInputAfterDays(dayOffset)
    const response = await api(`/api/clubs/${clubId}/slots?date=${date}`, {
      headers: { 'X-Club-Id': clubId },
    })
    assert.equal(response.status, 200, `slots failed: ${response.status} ${response.text}`)
    const items = Array.isArray(response.json?.items) ? response.json.items : []

    for (const slot of items) {
      if (slot.status !== 'PUBLISHED') continue
      if (excludedSlotIds.has(slot.slotId)) continue
      try {
        const seat = await pickAvailableSeat(clubId, slot.slotId)
        return { slot, seat }
      } catch {
        // keep scanning until we find a slot with at least one available seat
      }
    }
  }

  throw new Error('Unable to find a published slot with an available seat.')
}

async function getSeatCatalog(clubId) {
  const response = await api(`/api/clubs/${clubId}/seats?mapVersion=latest`, {
    headers: { 'X-Club-Id': clubId },
  })
  assert.equal(response.status, 200, `seats failed: ${response.status} ${response.text}`)
  return Array.isArray(response.json?.seats) ? response.json.seats : []
}

async function pickAvailableSeat(clubId, slotId) {
  const seats = await getSeatCatalog(clubId)

  const byFloor = new Map()
  for (const seat of seats) {
    if (seat.isDisabled) continue
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
    assert.equal(response.status, 200, `availability failed: ${response.status} ${response.text}`)
    const seatStatus = new Map()
    for (const item of response.json?.seats || []) {
      seatStatus.set(item.seatId, item.status)
    }
    const available = floorSeats.find((seat) => seatStatus.get(seat.seatId) === 'AVAILABLE')
    if (available) return available
  }

  throw new Error(`No AVAILABLE seat found for slot ${slotId}.`)
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

test('plan management RBAC + create + activate', async () => {
  await switchContext('host@example.com', hostClubId, 'HOST_ADMIN')
  const hostBlocked = await api(`/api/clubs/${hostClubId}/membership/plans`, {
    method: 'POST',
    headers: { 'X-Club-Id': hostClubId },
    body: JSON.stringify({
      type: 'TIME_PACK',
      name: 'Host should fail',
      priceAmount: 1000,
      currency: 'KZT',
      valueAmount: 60,
    }),
  })
  assert.equal(hostBlocked.status, 403, `Expected host blocked, got ${hostBlocked.status}: ${hostBlocked.text}`)

  await switchContext('tech@example.com', hostClubId, 'TECH_ADMIN')
  const created = await api(`/api/clubs/${hostClubId}/membership/plans`, {
    method: 'POST',
    headers: { 'X-Club-Id': hostClubId },
    body: JSON.stringify({
      type: 'TIME_PACK',
      name: `10 Hours Pack ${Date.now()}`,
      description: 'Membership test plan',
      priceAmount: 10000,
      currency: 'KZT',
      valueAmount: 600,
      isClientVisible: true,
      isHostVisible: true,
      allowStacking: true,
      expiryPolicyJson: JSON.stringify({ daysAfterPurchase: 60 }),
    }),
  })
  assert.equal(created.status, 201, `Expected plan create 201, got ${created.status}: ${created.text}`)
  assert.equal(created.json?.status, 'DRAFT')
  createdPlanId = created.json?.id
  assert.ok(createdPlanId, 'Expected created plan id')

  const activated = await api(`/api/clubs/${hostClubId}/membership/plans/${createdPlanId}/activate`, {
    method: 'POST',
    headers: { 'X-Club-Id': hostClubId },
  })
  assert.equal(activated.status, 200, `Expected activate 200, got ${activated.status}: ${activated.text}`)
  assert.equal(activated.json?.status, 'ACTIVE')
})

test('client can purchase membership and view snapshot', async () => {
  await switchContext('client@example.com', hostClubId, 'CLIENT')

  const purchase = await api('/api/me/memberships/purchase', {
    method: 'POST',
    body: JSON.stringify({
      clubId: hostClubId,
      planId: createdPlanId,
      paymentMode: 'OFFLINE',
    }),
  })
  assert.equal(purchase.status, 201, `Expected purchase 201, got ${purchase.status}: ${purchase.text}`)
  purchasedEntitlementId = purchase.json?.entitlementId
  assert.ok(purchasedEntitlementId, 'Expected purchased entitlement id')

  const snapshot = await api(`/api/me/memberships?clubId=${encodeURIComponent(hostClubId)}`)
  assert.equal(snapshot.status, 200, `Expected snapshot 200, got ${snapshot.status}: ${snapshot.text}`)
  assert.ok(Array.isArray(snapshot.json?.entitlements), 'Expected entitlements array')
  assert.ok(Array.isArray(snapshot.json?.transactions), 'Expected transactions array')
  assert.ok(snapshot.json.transactions.some((tx) => tx.txType === 'PURCHASE'))
})

test('quote applies membership and lowers totalDue deterministically', async () => {
  await switchContext('client@example.com', hostClubId, 'CLIENT')
  const available = await findFirstSlotWithAvailableSeat(hostClubId)
  const slotId = available.slot.slotId
  const seat = available.seat

  const payload = {
    clubId: hostClubId,
    slotId,
    seatId: seat.seatId,
    membership: {
      entitlementId: purchasedEntitlementId,
      paymentPreference: 'MEMBERSHIP_FIRST',
      useWallet: false,
    },
  }

  const first = await api('/api/pricing/quote', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
  assert.equal(first.status, 200, `Expected quote 200, got ${first.status}: ${first.text}`)
  assert.ok(typeof first.json?.baseTotal === 'number')
  assert.ok(typeof first.json?.totalDue === 'number')
  assert.ok(first.json.totalDue <= first.json.baseTotal)
  assert.ok(Array.isArray(first.json?.membership?.applied), 'Expected membership.applied array')

  const second = await api('/api/pricing/quote', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
  assert.equal(second.status, 200, `Expected quote repeat 200, got ${second.status}: ${second.text}`)
  assert.equal(second.json?.totalDue, first.json?.totalDue)
})

test('hold confirm consumes membership once and cancel reverses', async () => {
  await switchContext('client@example.com', hostClubId, 'CLIENT')
  const firstAvailable = await findFirstSlotWithAvailableSeat(hostClubId)
  const secondAvailable = await findFirstSlotWithAvailableSeat(hostClubId, {
    excludedSlotIds: [firstAvailable.slot.slotId],
  })
  const slotId = secondAvailable.slot.slotId
  const seat = secondAvailable.seat

  const hold = await api(`/api/clubs/${hostClubId}/holds`, {
    method: 'POST',
    headers: { 'X-Club-Id': hostClubId },
    body: JSON.stringify({
      slotId,
      seatId: seat.seatId,
    }),
  })
  assert.equal(hold.status, 201, `Expected hold create 201, got ${hold.status}: ${hold.text}`)

  const confirm = await api(`/api/clubs/${hostClubId}/holds/${hold.json.holdId}/confirm`, {
    method: 'POST',
    headers: { 'X-Club-Id': hostClubId },
    body: JSON.stringify({
      guestName: 'Client Demo',
      guestEmail: 'client@example.com',
      paymentMode: 'OFFLINE',
      membership: {
        entitlementId: purchasedEntitlementId,
        paymentPreference: 'MEMBERSHIP_FIRST',
        useWallet: false,
      },
    }),
  })
  assert.equal(confirm.status, 201, `Expected hold confirm 201, got ${confirm.status}: ${confirm.text}`)
  assert.ok(confirm.json?.membership, `Expected membership in confirm response: ${confirm.text}`)
  consumedBookingId = confirm.json?.bookingId
  assert.ok(consumedBookingId, 'Expected bookingId after hold confirm')

  const beforeCancel = await api(`/api/me/memberships?clubId=${encodeURIComponent(hostClubId)}`)
  assert.equal(beforeCancel.status, 200)
  const consumeTx = beforeCancel.json.transactions.filter(
    (tx) => tx.txType === 'CONSUME' && tx.bookingId === consumedBookingId,
  )
  assert.equal(consumeTx.length, 1, `Expected exactly 1 consume tx, got ${consumeTx.length}`)

  const cancel = await api(`/api/bookings/${consumedBookingId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'cancel' }),
  })
  assert.equal(cancel.status, 200, `Expected cancel 200, got ${cancel.status}: ${cancel.text}`)

  const afterCancel = await api(`/api/me/memberships?clubId=${encodeURIComponent(hostClubId)}`)
  assert.equal(afterCancel.status, 200)
  const refundTx = afterCancel.json.transactions.filter(
    (tx) => tx.txType === 'REFUND' && tx.bookingId === consumedBookingId,
  )
  assert.ok(refundTx.length >= 1, 'Expected refund transaction after cancellation')
})

test('membership adjust requires permission and reason', async () => {
  await switchContext('host@example.com', hostClubId, 'HOST_ADMIN')
  const hostDenied = await api(`/api/clubs/${hostClubId}/memberships/adjust`, {
    method: 'POST',
    headers: { 'X-Club-Id': hostClubId },
    body: JSON.stringify({
      entitlementId: purchasedEntitlementId,
      minutesDelta: 10,
      reason: 'Host should be denied',
    }),
  })
  assert.equal(hostDenied.status, 403, `Expected host denied adjust, got ${hostDenied.status}: ${hostDenied.text}`)

  await switchContext('tech@example.com', hostClubId, 'TECH_ADMIN')
  const missingReason = await api(`/api/clubs/${hostClubId}/memberships/adjust`, {
    method: 'POST',
    headers: { 'X-Club-Id': hostClubId },
    body: JSON.stringify({
      entitlementId: purchasedEntitlementId,
      minutesDelta: 10,
    }),
  })
  assert.equal(missingReason.status, 400, `Expected missing reason 400, got ${missingReason.status}: ${missingReason.text}`)

  const adjusted = await api(`/api/clubs/${hostClubId}/memberships/adjust`, {
    method: 'POST',
    headers: { 'X-Club-Id': hostClubId },
    body: JSON.stringify({
      entitlementId: purchasedEntitlementId,
      minutesDelta: 10,
      reason: 'Compensation minutes',
    }),
  })
  assert.equal(adjusted.status, 200, `Expected adjust 200, got ${adjusted.status}: ${adjusted.text}`)
})
