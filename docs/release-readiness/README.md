# Release Readiness (PRD #24)

This folder is the operational baseline for shipping safely.

## What is included

- CI/CD workflow templates:
  - `/Users/azamatdossym/booking-app2/booking-app2/.github/workflows/ci.yml`
  - `/Users/azamatdossym/booking-app2/booking-app2/.github/workflows/deploy-staging.yml`
  - `/Users/azamatdossym/booking-app2/booking-app2/.github/workflows/deploy-production.yml`
- CI helper scripts:
  - `/Users/azamatdossym/booking-app2/booking-app2/scripts/ci/run-api-tests.mjs`
  - `/Users/azamatdossym/booking-app2/booking-app2/scripts/ci/security-scan.mjs`
  - `/Users/azamatdossym/booking-app2/booking-app2/scripts/ci/load-smoke.sh`
- API contract schemas + tests:
  - `/Users/azamatdossym/booking-app2/booking-app2/contracts/schemas/`
  - `/Users/azamatdossym/booking-app2/booking-app2/tests/contracts.api.test.mjs`
- Load test profiles (k6):
  - `/Users/azamatdossym/booking-app2/booking-app2/perf/k6/`
- Governance docs and runbooks:
  - `/Users/azamatdossym/booking-app2/booking-app2/docs/release-readiness/*.md`
  - `/Users/azamatdossym/booking-app2/booking-app2/docs/release-readiness/runbooks/*.md`

## Release-critical server kill switches (env-driven)

Implemented in `/Users/azamatdossym/booking-app2/booking-app2/src/lib/featureFlags.ts`

- `RELEASE_DISABLE_HOLDS=true`
- `RELEASE_DISABLE_RESCHEDULE=true`
- `RELEASE_DISABLE_PROMOS=true`
- `RELEASE_DISABLE_MEMBERSHIP_APPLY=true`

These are server-enforced in booking/hold/reschedule/pricing routes and intended for emergency mitigation.

## Known follow-up

- Root `package.json` / `package-lock.json` is missing in the current workspace snapshot, so CI install steps use a fallback and may require repo normalization before GitHub CI is fully runnable end-to-end.

