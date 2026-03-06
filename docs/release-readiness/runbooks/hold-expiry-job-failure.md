# Runbook: Hold Expiry Job Failure

## Detection signals

- Hold expiry job alert firing
- Availability endpoint shows long-lived `HELD` seats beyond TTL
- Drop in booking conversions after hold creation

## Triage

1. Check job logs / scheduler status
2. Inspect count of active holds older than TTL
3. Verify DB time consistency and app server clock drift
4. Confirm whether endpoint-level filtered expiry logic still protects availability responses

## Mitigation

- Restart/repair scheduler
- Run manual expiry cleanup task for stale holds
- If stale holds are causing broad blocking, temporarily disable holds (`RELEASE_DISABLE_HOLDS=true`) while cleanup runs

## Communication template

- "Seat hold expirations are delayed due to a background job issue. We are clearing stale holds and restoring normal seat availability. New reservations may be briefly limited."

