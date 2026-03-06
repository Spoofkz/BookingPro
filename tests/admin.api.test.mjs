import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'
import test from 'node:test'

const PORT = Number(process.env.ADMIN_TEST_PORT || 3114)
const BASE_URL = `http://127.0.0.1:${PORT}`
const DEV_SERVER_START_TIMEOUT_MS = 120_000
const REQUEST_TIMEOUT_MS = 20_000

/** @type {import('node:child_process').ChildProcessWithoutNullStreams | null} */
let devServer = null
const serverLog = []
const cookies = new Map()

let hostClubId = ''
let clientUserId = ''
let adminCreatedFeaturedClubId = ''
let adminRoomIds = []

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
    body: JSON.stringify({ horizonDays: 90 }),
  })
  assert.equal(publish.status, 200, `schedule publish failed: ${publish.status} ${publish.text}`)
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
      { headers: { 'X-Club-Id': clubId } },
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

async function findSlotWithAvailableSeat(clubId, excludeSlotIds = []) {
  const excluded = new Set(excludeSlotIds)
  for (let dayOffset = 1; dayOffset <= 90; dayOffset += 1) {
    const date = dateInputAfterDays(dayOffset)
    const slots = await api(`/api/clubs/${clubId}/slots?date=${date}`, {
      headers: { 'X-Club-Id': clubId },
    })
    assert.equal(slots.status, 200, `slots failed: ${slots.status} ${slots.text}`)
    for (const slot of slots.json?.items || []) {
      if (slot.status !== 'PUBLISHED') continue
      if (excluded.has(slot.slotId)) continue
      try {
        const seat = await pickAvailableSeat(clubId, slot.slotId)
        return { slot, seat }
      } catch {
        // try next slot
      }
    }
  }
  throw new Error('Unable to find slot with available seat.')
}

async function createBookingAsClient(clubId) {
  await switchContext('client@example.com', clubId, 'CLIENT')
  assert.ok(Array.isArray(adminRoomIds) && adminRoomIds.length > 0, 'Expected cached admin room ids')

  const candidateOffsets = [96, 120, 144, 168, 192, 216, 240, 264]
  const unique = `${Date.now()}`
  for (const roomId of adminRoomIds) {
    if (!Number.isInteger(roomId)) continue
    for (const startOffset of candidateOffsets) {
      const created = await api('/api/bookings', {
        method: 'POST',
        headers: { 'X-Club-Id': clubId },
        body: JSON.stringify({
          roomId,
          guestName: `Admin Test ${unique}`,
          guestEmail: 'client@example.com',
          guestPhone: `+7701${unique.slice(-7)}`,
          checkIn: isoAfterHours(startOffset),
          checkOut: isoAfterHours(startOffset + 2),
          guests: 1,
          notes: 'admin-test-booking',
        }),
      })

      if (created.status === 201) {
        return { bookingId: created.json.id }
      }

      const errorText = String(created.json?.error || '')
      const roomConflict = created.status === 409 && errorText.includes('already booked')
      const missingSegment = errorText.includes('Segment is required for price quote.')
      if (roomConflict || missingSegment) continue
      assert.fail(`booking create failed for room ${roomId}: ${created.status} ${created.text}`)
    }
  }

  throw new Error('Unable to create client booking for admin test.')
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
  assert.equal(me.status, 200)
  hostClubId = me.json?.activeClubId
  assert.ok(hostClubId, 'Expected active club id')

  await switchContext('tech@example.com', hostClubId, 'TECH_ADMIN')
  await ensureScheduleSlots(hostClubId)
  const rooms = await api('/api/rooms', {
    headers: { 'X-Club-Id': hostClubId },
  })
  assert.equal(rooms.status, 200, `Expected rooms 200, got ${rooms.status}: ${rooms.text}`)
  adminRoomIds = (rooms.json || [])
    .map((room) => room?.id)
    .filter((id) => Number.isInteger(id))
  assert.ok(adminRoomIds.length > 0, 'Expected cached room ids')
  const bootstrapResume = await api(`/api/admin/clubs/${hostClubId}/resume`, { method: 'POST' })
  assert.equal(
    bootstrapResume.status,
    200,
    `Expected bootstrap resume 200, got ${bootstrapResume.status}: ${bootstrapResume.text}`,
  )

  await switchContext('tech@example.com', null, null)
  const users = await api('/api/admin/users?q=client@example.com')
  if (users.status === 200) {
    clientUserId = users.json?.items?.find?.((u) => String(u.email).includes('@'))?.userId || ''
  }
})

test.after(async () => {
  if (!devServer || devServer.killed) return
  const proc = devServer
  proc.kill('SIGTERM')
  await Promise.race([
    new Promise((resolve) => proc.once('exit', resolve)),
    delay(5000),
  ])
  if (!proc.killed) proc.kill('SIGKILL')
})

test('admin routes require platform role and /admin UI is gated', async () => {
  await switchContext('host@example.com', hostClubId, 'HOST_ADMIN')

  const deniedApi = await api('/api/admin/me')
  assert.equal(deniedApi.status, 403, `Expected 403, got ${deniedApi.status}: ${deniedApi.text}`)
  assert.equal(deniedApi.json?.code, 'PLATFORM_FORBIDDEN')

  const deniedPage = await api('/admin')
  assert.equal(deniedPage.status, 200, `Expected 200 HTML gate page, got ${deniedPage.status}`)
  assert.match(deniedPage.text, /Admin Access Required/)

  await switchContext('tech@example.com', hostClubId, 'TECH_ADMIN')
  const me = await api('/api/admin/me')
  assert.equal(me.status, 200, `Expected admin me 200, got ${me.status}: ${me.text}`)
  assert.ok(Array.isArray(me.json?.roles) && me.json.roles.includes('PLATFORM_ADMIN'))
})

test('support cannot suspend clubs or users and sees masked PII', async () => {
  await switchContext('azamat@example.com', hostClubId, 'TECH_ADMIN')

  const listUsers = await api('/api/admin/users?q=client@example.com')
  assert.equal(listUsers.status, 200, `Expected users list 200, got ${listUsers.status}: ${listUsers.text}`)
  const clientRow = (listUsers.json?.items || []).find((item) => item.name?.includes('Client') || String(item.email).includes('***'))
  assert.ok(clientRow, `Expected a client row in users list: ${listUsers.text}`)
  assert.ok(String(clientRow.email).includes('***'), `Expected masked email for support: ${JSON.stringify(clientRow)}`)
  assert.ok(String(clientRow.phone || '').includes('***') || clientRow.phone === null, `Expected masked phone for support: ${JSON.stringify(clientRow)}`)

  const suspendClub = await api(`/api/admin/clubs/${hostClubId}/suspend`, {
    method: 'POST',
    body: JSON.stringify({ reasonCode: 'RISK', reason: 'Support should be blocked' }),
  })
  assert.equal(suspendClub.status, 403, `Expected support club suspend 403, got ${suspendClub.status}: ${suspendClub.text}`)

  const targetUserId = clientRow.userId || clientUserId
  assert.ok(targetUserId, 'Expected client user id for suspend check')
  const suspendUser = await api(`/api/admin/users/${targetUserId}/suspend`, {
    method: 'POST',
    body: JSON.stringify({ reasonCode: 'ABUSE', reason: 'Support should be blocked' }),
  })
  assert.equal(suspendUser.status, 403, `Expected support user suspend 403, got ${suspendUser.status}: ${suspendUser.text}`)
})

test('verification and featured manager work for platform admin', async () => {
  await switchContext('tech@example.com', hostClubId, 'TECH_ADMIN')

  const verify = await api(`/api/admin/clubs/${hostClubId}/verify`, {
    method: 'POST',
    body: JSON.stringify({
      status: 'VERIFIED',
      notes: 'Manual review approved for admin test',
      documents: [{ type: 'business_registration', name: 'reg.pdf' }],
    }),
  })
  assert.equal(verify.status, 200, `Expected verify 200, got ${verify.status}: ${verify.text}`)
  assert.equal(verify.json?.status, 'VERIFIED')
  adminCreatedFeaturedClubId = hostClubId

  const now = Date.now()
  const featured = await api('/api/admin/featured', {
    method: 'POST',
    body: JSON.stringify({
      clubId: hostClubId,
      featuredRank: 10,
      badgeText: 'Verified Pick',
      featuredStartAt: new Date(now - 60_000).toISOString(),
      featuredEndAt: new Date(now + 24 * 60 * 60 * 1000).toISOString(),
    }),
  })
  assert.equal(featured.status, 201, `Expected featured create 201, got ${featured.status}: ${featured.text}`)

  const featuredList = await api('/api/admin/featured')
  assert.equal(featuredList.status, 200)
  assert.ok((featuredList.json?.items || []).some((item) => item.clubId === hostClubId))
})

test('club pause hides from public discovery and blocks new client bookings', async () => {
  await switchContext('tech@example.com', hostClubId, 'TECH_ADMIN')
  const pause = await api(`/api/admin/clubs/${hostClubId}/pause`, {
    method: 'POST',
    body: JSON.stringify({ reason: 'Admin test pause' }),
  })
  assert.equal(pause.status, 200, `Expected pause 200, got ${pause.status}: ${pause.text}`)
  assert.equal(pause.json?.status, 'PAUSED')

  await switchContext('client@example.com', hostClubId, 'CLIENT')
  const publicClubs = await api('/api/clubs/public')
  assert.equal(publicClubs.status, 200)
  const publicItems = Array.isArray(publicClubs.json?.items) ? publicClubs.json.items : []
  assert.ok(!publicItems.some((club) => club.clubId === hostClubId || club.id === hostClubId), 'Paused club should be hidden from public list')

  const targetRoomId = adminRoomIds.find((id) => Number.isInteger(id))
  assert.ok(targetRoomId, 'Expected at least one cached room id')
  const blockedBooking = await api('/api/bookings', {
    method: 'POST',
    headers: { 'X-Club-Id': hostClubId },
    body: JSON.stringify({
      roomId: targetRoomId,
      guestName: 'Paused Club Test',
      guestEmail: 'client@example.com',
      checkIn: isoAfterHours(72),
      checkOut: isoAfterHours(74),
      guests: 1,
    }),
  })
  assert.ok(
    blockedBooking.status === 403 || blockedBooking.status === 404 || blockedBooking.status === 409,
    `Expected booking blocked while paused, got ${blockedBooking.status}: ${blockedBooking.text}`,
  )

  await switchContext('tech@example.com', hostClubId, 'TECH_ADMIN')
  const resume = await api(`/api/admin/clubs/${hostClubId}/resume`, { method: 'POST' })
  assert.equal(resume.status, 200, `Expected resume 200, got ${resume.status}: ${resume.text}`)
  assert.equal(resume.json?.status, 'PUBLISHED')
})

test('dispute can be created, noted, resolved, and audited', async () => {
  await switchContext('tech@example.com', hostClubId, 'TECH_ADMIN')
  const created = await api('/api/admin/disputes', {
    method: 'POST',
    body: JSON.stringify({
      clubId: hostClubId,
      type: 'BOOKING_ISSUE',
      subject: 'Seat issue',
      description: 'Customer reported headset failure',
    }),
  })
  assert.equal(created.status, 201, `Expected dispute create 201, got ${created.status}: ${created.text}`)
  const disputeId = created.json?.id
  assert.ok(disputeId, 'Expected dispute id')

  const note = await api(`/api/admin/disputes/${disputeId}/add-note`, {
    method: 'POST',
    body: JSON.stringify({ text: 'Requested more details from club host.' }),
  })
  assert.equal(note.status, 201, `Expected dispute note 201, got ${note.status}: ${note.text}`)

  const resolved = await api(`/api/admin/disputes/${disputeId}/resolve`, {
    method: 'POST',
    body: JSON.stringify({
      resolutionSummary: 'Manual credit issued and issue acknowledged.',
    }),
  })
  assert.equal(resolved.status, 200, `Expected dispute resolve 200, got ${resolved.status}: ${resolved.text}`)
  assert.equal(resolved.json?.status, 'RESOLVED')

  const disputeDetail = await api(`/api/admin/disputes/${disputeId}`)
  assert.equal(disputeDetail.status, 200)
  assert.equal(disputeDetail.json?.dispute?.status, 'RESOLVED')
  assert.ok((disputeDetail.json?.notes || []).length >= 1, 'Expected dispute notes')

  const audit = await api('/api/admin/audit?action=platform.dispute.resolved&entityType=dispute&pageSize=50')
  assert.equal(audit.status, 200)
  assert.ok((audit.json?.items || []).some((item) => item.entityId === disputeId), 'Expected dispute resolution audit event')
})

test('booking override cancel requires reason and is audited; admin sees unmasked PII', async () => {
  await switchContext('tech@example.com', hostClubId, 'TECH_ADMIN')
  if (!clientUserId) {
    const users = await api('/api/admin/users?q=client@example.com')
    clientUserId = users.json?.items?.[0]?.userId || ''
  }
  assert.ok(clientUserId, 'Expected client user id for user admin checks')
  await ensureScheduleSlots(hostClubId)

  const userList = await api('/api/admin/users?q=client@example.com')
  assert.equal(userList.status, 200)
  const clientRow = (userList.json?.items || []).find((item) => item.userId === clientUserId)
  assert.ok(clientRow, `Expected client row in users list: ${userList.text}`)
  assert.equal(clientRow.email, 'client@example.com', `Expected unmasked email for platform admin: ${JSON.stringify(clientRow)}`)

  const booking = await createBookingAsClient(hostClubId)

  await switchContext('tech@example.com', hostClubId, 'TECH_ADMIN')
  const missingReason = await api(`/api/admin/bookings/${booking.bookingId}/cancel`, {
    method: 'POST',
    body: JSON.stringify({}),
  })
  assert.equal(missingReason.status, 400, `Expected missing reason 400, got ${missingReason.status}: ${missingReason.text}`)

  const canceled = await api(`/api/admin/bookings/${booking.bookingId}/cancel`, {
    method: 'POST',
    body: JSON.stringify({
      reasonCode: 'DISPUTE',
      reason: 'Support override cancellation for test',
    }),
  })
  assert.equal(canceled.status, 200, `Expected cancel override 200, got ${canceled.status}: ${canceled.text}`)
  assert.equal(canceled.json?.status, 'CANCELED')

  const detail = await api(`/api/admin/bookings/${booking.bookingId}`)
  assert.equal(detail.status, 200)
  assert.equal(detail.json?.booking?.status, 'CANCELED')
  assert.ok(
    (detail.json?.timeline?.audit || []).some((item) => item.action === 'platform.booking.canceled_override'),
    'Expected override cancel audit event in booking timeline',
  )

  const revoke = await api(`/api/admin/users/${clientUserId}/revoke-sessions`, {
    method: 'POST',
    body: JSON.stringify({ reasonCode: 'SECURITY', reason: 'Test revoke sessions' }),
  })
  assert.equal(revoke.status, 200, `Expected revoke sessions 200, got ${revoke.status}: ${revoke.text}`)
  assert.equal(revoke.json?.userId, clientUserId)
})
