import http from 'k6/http'
import { check } from 'k6'

const BASE_URL = __ENV.BASE_URL || 'http://127.0.0.1:3001'
const CLUB_ID = __ENV.CLUB_ID || ''
const SLOT_ID = __ENV.SLOT_ID || ''
const SEAT_IDS = (__ENV.SEAT_IDS || '').split(',').map((v) => v.trim()).filter(Boolean)
const COOKIE = __ENV.COOKIE || ''

export const options = {
  scenarios: {
    contention: {
      executor: 'constant-vus',
      vus: Number(__ENV.VUS || 200),
      duration: __ENV.DURATION || '90s',
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<600'],
  },
}

function headers() {
  const result = { 'Content-Type': 'application/json' }
  if (COOKIE) result.Cookie = COOKIE
  return result
}

export default function () {
  if (!CLUB_ID || !SLOT_ID || SEAT_IDS.length === 0) {
    throw new Error('CLUB_ID, SLOT_ID, SEAT_IDS env vars are required')
  }

  const seatId = SEAT_IDS[(__VU + __ITER) % SEAT_IDS.length]
  const res = http.post(
    `${BASE_URL}/api/clubs/${CLUB_ID}/holds`,
    JSON.stringify({ slotId: SLOT_ID, seatId }),
    { headers: headers(), tags: { profile: 'C', endpoint: 'holds.create' } },
  )

  check(res, {
    'hold create returns 201 or 409': (r) => r.status === 201 || r.status === 409,
    'no 5xx on hold contention': (r) => r.status < 500,
  })
}

