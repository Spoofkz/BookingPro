# Database Migrations & Rollback Strategy (PRD #24)

## Migration principles

Use expand/contract for all non-trivial schema changes:

1. Expand: add new columns/tables/indexes (backward compatible)
2. Dual-write (if needed)
3. Backfill
4. Switch reads
5. Contract: remove legacy fields in a later release

## Required migration checklist

- Migration reviewed for lock risk
- Staging dry-run completed
- Rollback plan documented (app rollback only vs data rollback)
- Monitoring in place for errors/latency spikes post-migration

## Rollback policy

### App rollback (preferred)

- Redeploy previous stable artifact/tag immediately
- Enable kill switches if incident is ongoing:
  - `RELEASE_DISABLE_HOLDS=true`
  - `RELEASE_DISABLE_RESCHEDULE=true`
  - `RELEASE_DISABLE_PROMOS=true`
  - `RELEASE_DISABLE_MEMBERSHIP_APPLY=true`

### Data rollback (rare)

- Use backup restore only for severe data corruption
- Prefer compensating actions and forward fixes over destructive restore

## One-way migrations

If a migration cannot be safely reversed:

- Mark as one-way in release notes
- Require explicit Engineering + Product sign-off
- Confirm app rollback compatibility with post-migration schema before deployment

## Migration verification (staging/prod)

- Schema applied successfully
- Critical endpoints smoke test passes:
  - `/api/pricing/quote`
  - `/api/clubs/{clubId}/availability`
  - `/api/clubs/{clubId}/holds`
  - `/api/bookings`
- Error rate / p95 regression check (15–30 min window)

