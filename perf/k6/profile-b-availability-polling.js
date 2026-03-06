import http from 'k6/http'
import { check, sleep } from 'k6'

const BASE_URL = __ENV.BASE_URL || 'http://127.0.0.1:3001'
const CLUB_ID = __ENV.CLUB_ID || ''
const SLOT_ID = __ENV.SLOT_ID || ''
const FLOOR_ID = __ENV.FLOOR_ID || ''
const COOKIE = __ENV.COOKIE || ''

export const options = {
  vus: Number(__ENV.VUS || 200),
  duration: __ENV.DURATION || '2m',
  thresholds: {
    http_req_failed: ['rate<0.005'],
    http_req_duration: ['p(95)<400'],
  },
}

export default function () {
  if (!CLUB_ID || !SLOT_ID || !FLOOR_ID) {
    throw new Error('CLUB_ID, SLOT_ID, FLOOR_ID env vars are required')
  }

  const response = http.get(
    `${BASE_URL}/api/clubs/${CLUB_ID}/availability?slotId=${encodeURIComponent(SLOT_ID)}&floorId=${encodeURIComponent(FLOOR_ID)}`,
    {
      headers: COOKIE ? { Cookie: COOKIE } : {},
      tags: { profile: 'B', endpoint: 'availability' },
    },
  )

  check(response, {
    'availability status is 200': (r) => r.status === 200,
  })

  sleep(Number(__ENV.POLL_INTERVAL_SECONDS || 5))
}

