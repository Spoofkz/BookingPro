# Emergency Feature Kill Switches (PRD #24)

Server-enforced in `/Users/azamatdossym/booking-app2/booking-app2/src/lib/featureFlags.ts`.

## Flags

- `RELEASE_DISABLE_HOLDS=true`
  - Blocks hold creation and hold confirmation
- `RELEASE_DISABLE_RESCHEDULE=true`
  - Blocks reschedule intent create/confirm/cancel and admin reschedule override
- `RELEASE_DISABLE_PROMOS=true`
  - Blocks explicit promo usage and disables promo evaluation in quote path
- `RELEASE_DISABLE_MEMBERSHIP_APPLY=true`
  - Blocks membership application in quote/booking/hold confirm

## Intended usage

- Use for incident mitigation while keeping the rest of the app online.
- Prefer targeted kill switch over full rollback when the incident is isolated.

## Validation

- Include a release-drill test on staging before major launch:
  - enable a flag
  - confirm endpoint returns expected `409 ..._DISABLED`
  - disable flag
  - confirm normal behavior restored

