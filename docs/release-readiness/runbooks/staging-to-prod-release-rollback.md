# Runbook: Staging-to-Prod Release Rollback

## Detection signals

- Canary metrics breach (latency, 5xx, booking conversion drop)
- Business-critical smoke test fails after canary
- Product/Support reports severe regression

## Triage

1. Confirm canary-only vs full rollout impact
2. Compare current vs previous artifact tag
3. Identify feature-specific kill switch mitigation possibility

## Mitigation

1. If isolated feature issue: enable targeted kill switch
2. Roll back to previous stable artifact/tag
3. Re-run smoke checks on critical endpoints
4. Keep canary traffic disabled until root cause is fixed

## Post-rollback actions

- Create incident ticket and timeline
- Add/extend regression test
- Update runbook/checklist if process gap found

## Communication template

- "We detected a regression during rollout and reverted to the previous stable release. Service is stabilizing; some new features may remain disabled while we complete root-cause analysis."

