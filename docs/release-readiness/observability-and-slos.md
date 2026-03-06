# Observability Baseline & SLOs (PRD #24)

## Required logs (structured JSON)

Per request/event include:

- `requestId` / correlation id
- endpoint/path
- status code
- latency ms
- error code (if any)
- `clubId` (when applicable)
- user id (masked/hashed)

## Required metrics

- Request count by endpoint
- p50/p95/p99 latency by endpoint
- 4xx/5xx rate by endpoint
- DB query latency (aggregate)
- Availability cache hit rate (if cache enabled)
- Quote cache hit rate (if cache enabled)
- Background jobs:
  - hold expiry success/failure
  - slot generation success/failure

## Initial SLOs

- Booking confirm availability: 99.9% success excluding expected conflicts
- Availability endpoint: p95 < 400ms
- Pricing quote: p95 < 250ms
- 5xx rate on critical endpoints < 0.2%

## Must-have alerts

- 5xx spike on booking/availability/quote endpoints
- Hold expiry job failures
- Slot generation failures
- Sudden drop in booking confirmations
- Repeated failed admin logins (platform admin console)

## Dashboards (minimum)

- Booking funnel (hold create -> confirm)
- Availability latency + cache hit rate
- Quote latency + error codes
- Background jobs health
- Admin actions (suspend/pause/override) audit activity

