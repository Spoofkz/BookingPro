# Release Checklist (PRD #24)

## Before Staging

- [ ] PR CI is green (typecheck, security scan, contract tests, API regressions)
- [ ] Migration reviewed (expand/contract confirmed)
- [ ] Feature flags/defaults reviewed for new features
- [ ] Runbook updates included for changed critical flows

## Before Production Approval

- [ ] Staging deploy successful
- [ ] Staging smoke e2e subset green
- [ ] Contract tests green on staging
- [ ] Load smoke B/C/D passed on staging
- [ ] Dashboards and alerts verified live
- [ ] Rollback plan reviewed (artifact tag + kill switches)
- [ ] Product + Engineering sign-off recorded

## Canary Rollout

- [ ] Deploy 5% canary
- [ ] Observe p95/error metrics (10–15 min)
- [ ] Promote to 25%
- [ ] Observe again
- [ ] Promote to 100%

## Post-Release Verification

- [ ] Booking confirmations stable
- [ ] Availability/quote SLOs within expected range
- [ ] No abnormal 5xx spike
- [ ] Audit logs show expected admin changes only

