# Runbook: Booking Conflicts / Double Booking Investigation

## Detection signals

- Spike in booking conflict complaints
- 500s on hold/booking endpoints
- Duplicate booking records for same `(clubId, slotId, seatId)` reported

## Triage

1. Identify affected `clubId`, `slotId`, `seatId`
2. Query bookings + holds + audit logs for the seat/slot window
3. Confirm whether issue is:
   - expected 409 contention
   - duplicate booking data integrity bug
   - stale hold/availability cache

## Mitigation

- Enable `RELEASE_DISABLE_HOLDS=true` if widespread contention bug
- Keep booking reads available
- Clear/invalidate availability cache for affected club/slots
- Apply compensating cancellation/refund actions with audit

## Communication template

- "We identified a booking conflict issue affecting seat reservations in [club/time window]. New holds are temporarily paused while we correct impacted bookings. Existing bookings are being reviewed and customers will be contacted for resolution."

