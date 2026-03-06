# Runbook: Pricing Mismatch Incidents

## Detection signals

- User reports quote total differs from booking total
- Spike in promo/membership complaints
- Audit/payment reconciliation mismatch

## Triage

1. Capture `quoteId`, `bookingId`, `clubId`
2. Compare quote snapshot, booking price snapshot, promo/membership application
3. Verify pricing version effective window and applied rules
4. Check promo status/usage limits and feature flags

## Mitigation

- If promo logic regression: `RELEASE_DISABLE_PROMOS=true`
- If membership apply regression: `RELEASE_DISABLE_MEMBERSHIP_APPLY=true`
- Apply manual adjustments/refunds with audit
- Prepare forward fix and regression tests before re-enabling

## Communication template

- "We identified a pricing calculation inconsistency affecting some bookings. Promotional/member discounts may be temporarily disabled while we validate totals and correct affected transactions."

