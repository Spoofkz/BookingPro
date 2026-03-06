# k6 Load Profiles (PRD #24)

This folder contains baseline load profiles required by PRD v2 Release Readiness (#24).

## Profiles implemented

- `profile-b-availability-polling.js` (Availability polling, p95 < 400ms)
- `profile-c-booking-contention.js` (Hold contention, 201/409 only, no 5xx)
- `profile-d-quote-burst.js` (Quote burst, p95 < 250ms)

## How to run

Use the helper:

```bash
BASE_URL=http://127.0.0.1:3001 \
CLUB_ID=... SLOT_ID=... FLOOR_ID=... \
./scripts/ci/load-smoke.sh
```

Or run individual profiles:

```bash
k6 run -e BASE_URL=http://127.0.0.1:3001 -e CLUB_ID=... -e SLOT_ID=... -e FLOOR_ID=... perf/k6/profile-b-availability-polling.js
k6 run -e BASE_URL=http://127.0.0.1:3001 -e CLUB_ID=... -e SLOT_ID=... -e SEAT_IDS=s1,s2,s3 perf/k6/profile-c-booking-contention.js
k6 run -e BASE_URL=http://127.0.0.1:3001 -e CLUB_ID=... -e ROOM_ID=1 -e SEGMENT_ID=seg1 perf/k6/profile-d-quote-burst.js
```

## Notes

- Set `COOKIE` to an authenticated session cookie for staff-only endpoints (e.g. hold contention).
- Profile C intentionally expects `409` conflicts under contention; those are acceptable outcomes.
- The scripts are designed for staging load-smoke validation before production promotion.

