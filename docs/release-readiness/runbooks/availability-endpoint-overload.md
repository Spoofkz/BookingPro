# Runbook: Availability Endpoint Overload

## Detection signals

- Availability p95 > 400ms
- CPU/memory spike on API nodes
- Error rate increase on `/availability`

## Triage

1. Confirm load pattern (single club/slot vs platform-wide)
2. Check cache hit rate and cache invalidation churn
3. Inspect DB query latency for seat/hold/booking joins
4. Identify abusive polling clients if present

## Mitigation

- Increase cache TTL / optimize invalidation scope
- Rate-limit aggressive polling clients
- Scale app replicas
- Reduce load by pausing discovery surfacing for affected club if necessary

## Communication template

- "We are experiencing elevated load on live seat availability for one or more clubs. Availability updates may be delayed while mitigation is applied."

