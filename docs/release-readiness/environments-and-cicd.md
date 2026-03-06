# Environments & CI/CD (PRD #24)

## Environment model

`ENV-1 Local/Dev`
- Developer workstation.
- Synthetic/demo data allowed.
- Feature flags can be toggled via env vars.

`ENV-2 CI Ephemeral`
- Fresh SQLite/Postgres DB for integration tests.
- Seeded with deterministic minimal data.
- Executes typecheck, security scan, contract tests, and API regressions.

`ENV-3 Staging`
- Mirrors production config (auth mode, DB engine, cache topology where applicable).
- Uses synthetic/anonymized data.
- Runs smoke e2e + load-smoke profiles (B/C/D).

`ENV-4 Production`
- Immutable deployment artifact.
- Alerts/dashboards enabled.
- Manual approval + canary rollout.

## Workflow mapping

- PR checks: `/Users/azamatdossym/booking-app2/booking-app2/.github/workflows/ci.yml`
- Staging deploy: `/Users/azamatdossym/booking-app2/booking-app2/.github/workflows/deploy-staging.yml`
- Production deploy: `/Users/azamatdossym/booking-app2/booking-app2/.github/workflows/deploy-production.yml`

## PR quality gates (enforced in CI)

- Typecheck
- Security scan (secret scan + admin RBAC gate scan + basic SAST patterns)
- Contract tests (canonical endpoint shapes)
- API integration regressions (serial execution to avoid Next dev lock collisions)

## CI implementation notes

- Test suites spawn `next dev`; they must run serially.
- Contract tests are isolated in their own suite (`tests/contracts.api.test.mjs`).
- Database setup uses Prisma client generation + DB reset + seed.

## Staging deploy checklist (minimum)

- Apply migrations in safe mode
- Run smoke e2e subset
- Run contract tests against staging URL
- Run load smoke Profiles B/C/D
- Verify dashboards and alert routes before prod approval

